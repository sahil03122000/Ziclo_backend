#!/usr/bin/env node
/**
 * Import scripts/../pincode.csv into the Neon "Pincode" table.
 *
 * Streams the CSV (constant memory regardless of file size), inserts in
 * configurable batches inside transactions, skips duplicates on the unique
 * `pincode` column via ON CONFLICT DO NOTHING, and falls back to row-by-row
 * inserts (using savepoints) whenever a batch fails, so one bad row never
 * aborts the rest of the batch.
 *
 * Usage:
 *   node scripts/import-pincode.js
 *   node scripts/import-pincode.js path/to/other.csv
 *
 * Env:
 *   DATABASE_URL        Neon Postgres connection string (required)
 *   PINCODE_CSV_PATH     Path to the CSV file (default: ./pincode.csv)
 *   IMPORT_BATCH_SIZE    Rows per batch, 500-1000 recommended (default: 500)
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const csvParser = require('csv-parser');
const { Pool } = require('pg');

const CSV_PATH = path.resolve(process.argv[2] || process.env.PINCODE_CSV_PATH || './pincode.csv');
const BATCH_SIZE = Math.max(1, Math.min(1000, Number(process.env.IMPORT_BATCH_SIZE) || 500));
const ERROR_LOG_PATH = path.resolve(process.cwd(), 'import-pincode-errors.log');

const COLUMNS = ['id', 'pincode', 'officeName', 'city', 'district', 'state', 'country', 'isActive', 'createdAt', 'updatedAt'];

// createdAt/updatedAt have no DB-level default on this table (Prisma's
// @default(now())/@updatedAt are enforced client-side, not in Postgres), so
// they must be supplied explicitly or every insert fails with a NOT NULL
// violation on "updatedAt".
const INSERT_ONE_SQL = `
  INSERT INTO "Pincode" (id, pincode, "officeName", city, district, state, country, "isActive", "createdAt", "updatedAt")
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
  ON CONFLICT (pincode) DO NOTHING
  RETURNING pincode
`;

const stats = {
  total: 0,
  inserted: 0,
  skipped: 0,
  failed: 0,
};

let errorLogStream = null;

function logFailure(lineNumber, rawRow, reason) {
  stats.failed += 1;
  const entry = `[line ${lineNumber}] ${reason} | row=${JSON.stringify(rawRow)}\n`;
  process.stderr.write(`  ✖ FAILED line ${lineNumber}: ${reason}\n`);
  if (errorLogStream) errorLogStream.write(entry);
}

function get(raw, ...keys) {
  for (const key of keys) {
    if (raw[key] !== undefined && String(raw[key]).trim() !== '') {
      return String(raw[key]).trim();
    }
  }
  return undefined;
}

/**
 * Normalizes a raw CSV row (tolerant of common header-casing variants) into
 * the exact shape the INSERT needs, or returns { error } if required fields
 * are missing.
 */
function normalizeRow(raw) {
  const pincode = get(raw, 'pincode', 'Pincode', 'PINCODE', 'pin_code', 'PinCode', 'Pin Code');
  const city = get(raw, 'city', 'City', 'CITY');
  const state = get(raw, 'state', 'State', 'STATE');

  if (!pincode) return { error: 'Missing required field: pincode' };
  if (!city) return { error: 'Missing required field: city' };
  if (!state) return { error: 'Missing required field: state' };

  const isActiveRaw = get(raw, 'isActive', 'is_active', 'IsActive', 'ACTIVE', 'active');
  const isActive = isActiveRaw === undefined ? true : !['false', '0', 'no', 'inactive'].includes(isActiveRaw.toLowerCase());

  const now = new Date();

  return {
    row: {
      id: crypto.randomUUID(),
      pincode,
      officeName: get(raw, 'officeName', 'office_name', 'OfficeName', 'Office Name', 'OFFICE_NAME') ?? null,
      city,
      district: get(raw, 'district', 'District', 'DISTRICT') ?? null,
      state,
      country: get(raw, 'country', 'Country', 'COUNTRY') ?? 'India',
      isActive,
      createdAt: now,
      updatedAt: now,
    },
  };
}

/** Single multi-row INSERT for the whole batch. */
async function bulkInsert(client, rows) {
  const values = [];
  const placeholders = rows
    .map((row, i) => {
      const base = i * COLUMNS.length;
      values.push(
        row.id,
        row.pincode,
        row.officeName,
        row.city,
        row.district,
        row.state,
        row.country,
        row.isActive,
        row.createdAt,
        row.updatedAt,
      );
      return `(${COLUMNS.map((_, j) => `$${base + j + 1}`).join(', ')})`;
    })
    .join(', ');

  const sql = `
    INSERT INTO "Pincode" (id, pincode, "officeName", city, district, state, country, "isActive", "createdAt", "updatedAt")
    VALUES ${placeholders}
    ON CONFLICT (pincode) DO NOTHING
    RETURNING pincode
  `;

  const result = await client.query(sql, values);
  return result.rowCount;
}

/**
 * Row-by-row fallback (each row wrapped in a SAVEPOINT) — used only when the
 * bulk INSERT for a batch throws, so a single malformed row doesn't take the
 * rest of a perfectly good batch down with it.
 */
async function insertRowByRow(client, batch) {
  for (const { lineNumber, row } of batch) {
    try {
      await client.query('SAVEPOINT sp_row');
      const result = await client.query(INSERT_ONE_SQL, [
        row.id,
        row.pincode,
        row.officeName,
        row.city,
        row.district,
        row.state,
        row.country,
        row.isActive,
        row.createdAt,
        row.updatedAt,
      ]);
      await client.query('RELEASE SAVEPOINT sp_row');
      if (result.rowCount > 0) {
        stats.inserted += 1;
      } else {
        stats.skipped += 1;
      }
    } catch (err) {
      await client.query('ROLLBACK TO SAVEPOINT sp_row').catch(() => {});
      logFailure(lineNumber, row, err.message);
    }
  }
}

/** Inserts one batch inside a transaction; falls back to row-by-row on failure. */
async function processBatch(client, batch) {
  await client.query('BEGIN');
  try {
    const insertedCount = await bulkInsert(client, batch.map((b) => b.row));
    await client.query('COMMIT');
    stats.inserted += insertedCount;
    stats.skipped += batch.length - insertedCount;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    process.stderr.write(
      `  ⚠ Batch of ${batch.length} rows failed as a whole (${err.message}) — retrying row-by-row...\n`,
    );
    await client.query('BEGIN');
    await insertRowByRow(client, batch);
    await client.query('COMMIT');
  }
}

function printProgress() {
  process.stdout.write(
    `\rProcessed: ${stats.total} | Inserted: ${stats.inserted} | Skipped (duplicates): ${stats.skipped} | Failed: ${stats.failed}     `,
  );
}

async function run() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set. Add it to your .env file (Neon connection string).');
  }

  if (!fs.existsSync(CSV_PATH)) {
    throw new Error(`CSV file not found: ${CSV_PATH}`);
  }

  errorLogStream = fs.createWriteStream(ERROR_LOG_PATH, { flags: 'w' });
  errorLogStream.write(`Import started: ${new Date().toISOString()}\nSource: ${CSV_PATH}\n\n`);

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 5,
  });

  const client = await pool.connect();
  console.log(`Connected to Neon. Reading ${CSV_PATH} in batches of ${BATCH_SIZE}...\n`);

  let batch = [];

  try {
    const stream = fs.createReadStream(CSV_PATH).pipe(csvParser());

    for await (const raw of stream) {
      stats.total += 1;
      const lineNumber = stats.total + 1; // +1 for the CSV header row

      const { row, error } = normalizeRow(raw);
      if (error) {
        logFailure(lineNumber, raw, error);
        continue;
      }

      batch.push({ lineNumber, row });

      if (batch.length >= BATCH_SIZE) {
        await processBatch(client, batch);
        batch = [];
        printProgress();
      }
    }

    if (batch.length > 0) {
      await processBatch(client, batch);
      printProgress();
    }
  } finally {
    client.release();
    await pool.end();
  }

  process.stdout.write('\n\n');
}

async function main() {
  const startedAt = Date.now();
  try {
    await run();

    const durationSec = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.log('='.repeat(50));
    console.log('IMPORT SUMMARY');
    console.log('='.repeat(50));
    console.log(`Total rows read     : ${stats.total}`);
    console.log(`Inserted            : ${stats.inserted}`);
    console.log(`Skipped (duplicates): ${stats.skipped}`);
    console.log(`Failed              : ${stats.failed}`);
    console.log(`Duration            : ${durationSec}s`);
    console.log('='.repeat(50));

    if (stats.failed > 0) {
      console.log(`See ${ERROR_LOG_PATH} for details on failed rows.`);
    }
    if (errorLogStream) errorLogStream.end();

    // A run is considered a success as long as it completed and processed at
    // least one row successfully. Individual bad rows are logged, not fatal.
    if (stats.total === 0) {
      console.error('No rows were read from the CSV file.');
      process.exit(1);
    }
    if (stats.inserted === 0 && stats.skipped === 0) {
      console.error('No rows were inserted or skipped — every row failed.');
      process.exit(1);
    }

    process.exit(0);
  } catch (err) {
    console.error('\nFATAL ERROR:', err.message);
    if (err.stack) console.error(err.stack);
    if (errorLogStream) {
      errorLogStream.write(`\nFATAL ERROR: ${err.message}\n${err.stack ?? ''}\n`);
      errorLogStream.end();
    }
    process.exit(1);
  }
}

main();
