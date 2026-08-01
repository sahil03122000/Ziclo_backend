/**
 * India PIN Code Seed
 *
 * Source  : GeoNames Postal Code Dataset — https://download.geonames.org/export/zip/IN.zip
 *           (~29,000 unique 6-digit PIN codes, maintained by GeoNames.org since 2006)
 *
 * Run     : npx prisma db seed
 *
 * First run   → downloads IN.zip (~1.7 MB), extracts, imports ~29 k PIN codes (~30-60 s)
 * Re-runs     → CSV already on disk, skips download, idempotent re-import
 * Fresh clone → no manual download required
 *
 * Data file   : prisma/data/pincodes.csv  (tab-separated, GeoNames format)
 *   Col 0 country_code  Col 1 pincode  Col 2 place_name
 *   Col 3 state         Col 5 district
 */

import { PrismaClient } from '@prisma/client';
import * as fs       from 'fs';
import * as path     from 'path';
import * as readline from 'readline';
import * as https    from 'https';
import * as zlib     from 'zlib';

const prisma = new PrismaClient();

// ─── Config ───────────────────────────────────────────────────────────────────

const DATA_DIR    = path.join(__dirname, 'data');
const CSV_PATH    = path.join(DATA_DIR, 'pincodes.csv');  // stored as TSV internally
const ZIP_TMP     = path.join(DATA_DIR, '.geonames_tmp.zip');

const DOWNLOAD_URL = 'https://download.geonames.org/export/zip/IN.zip';
const ZIP_ENTRY    = 'IN.txt';

const BATCH     = 1000;   // rows per createMany call
const LOG_EVERY = 5000;   // progress line every N rows

// ─── Types ────────────────────────────────────────────────────────────────────

interface PincodeRecord {
  pincode:    string;
  officeName: string;
  city:       string;
  district:   string;
  state:      string;
  country:    string;
}

// ─── ZIP extractor (no external packages) ────────────────────────────────────
// Reads sizes from the Central Directory (end of ZIP) rather than Local File Headers
// because some tools write 0 in LFH sizes when using data descriptors (bit 3).

function extractEntryFromZip(zipBuf: Buffer, entryName: string): Buffer {
  const EOCD_SIG = 0x06054b50;
  const CD_SIG   = 0x02014b50;

  // Find End of Central Directory record (scan backwards, skip 22-byte minimum EOCD)
  let eocdPos = -1;
  for (let i = zipBuf.length - 22; i >= 0; i--) {
    if (zipBuf.readUInt32LE(i) === EOCD_SIG) { eocdPos = i; break; }
  }
  if (eocdPos === -1) throw new Error('Not a valid ZIP archive (EOCD not found)');

  const cdOffset = zipBuf.readUInt32LE(eocdPos + 16);
  const cdSize   = zipBuf.readUInt32LE(eocdPos + 12);

  // Scan Central Directory entries
  let pos = cdOffset;
  while (pos < cdOffset + cdSize && pos <= zipBuf.length - 46) {
    if (zipBuf.readUInt32LE(pos) !== CD_SIG) break;

    const compression    = zipBuf.readUInt16LE(pos + 10);
    const compressedSize = zipBuf.readUInt32LE(pos + 20);
    const filenameLen    = zipBuf.readUInt16LE(pos + 28);
    const extraLen       = zipBuf.readUInt16LE(pos + 30);
    const commentLen     = zipBuf.readUInt16LE(pos + 32);
    const lfhOffset      = zipBuf.readUInt32LE(pos + 42);
    const filename       = zipBuf.subarray(pos + 46, pos + 46 + filenameLen).toString('utf8');

    if (filename === entryName) {
      // Navigate to Local File Header, skip its variable-length fields to reach data
      const lfhFilenameLen = zipBuf.readUInt16LE(lfhOffset + 26);
      const lfhExtraLen    = zipBuf.readUInt16LE(lfhOffset + 28);
      const dataStart      = lfhOffset + 30 + lfhFilenameLen + lfhExtraLen;

      const compressed = zipBuf.subarray(dataStart, dataStart + compressedSize);
      if (compression === 0) return compressed;
      if (compression === 8) return zlib.inflateRawSync(compressed);
      throw new Error(`Unsupported ZIP compression method: ${compression}`);
    }

    pos += 46 + filenameLen + extraLen + commentLen;
  }

  throw new Error(`Entry "${entryName}" not found in ZIP archive`);
}

// ─── Download ─────────────────────────────────────────────────────────────────

function downloadFile(url: string, dest: string, hopCount = 0): Promise<void> {
  return new Promise((resolve, reject) => {
    if (hopCount > 8) return reject(new Error('Too many redirects'));

    const get = url.startsWith('https://') ? https.get : require('http').get;

    get(url, (res: any) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return downloadFile(res.headers.location, dest, hopCount + 1).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} from ${url}`));
      }

      const totalBytes = parseInt(res.headers['content-length'] ?? '0', 10);
      let received = 0;
      let lastPct  = -1;

      const file = fs.createWriteStream(dest);

      res.on('data', (chunk: Buffer) => {
        received += chunk.length;
        if (totalBytes > 0) {
          const pct = Math.floor((received / totalBytes) * 100);
          if (pct !== lastPct && pct % 5 === 0) {
            lastPct = pct;
            const mb    = (received / 1_048_576).toFixed(1);
            const total = (totalBytes / 1_048_576).toFixed(1);
            process.stdout.write(`\r  Progress: ${String(pct).padStart(3)}%  ${mb} / ${total} MB   `);
          }
        }
      });

      res.pipe(file);
      file.on('finish', () => { file.close(); process.stdout.write('\n'); resolve(); });
      file.on('error', (e: Error) => { if (fs.existsSync(dest)) fs.unlinkSync(dest); reject(e); });
    }).on('error', (e: Error) => { if (fs.existsSync(dest)) fs.unlinkSync(dest); reject(e); });
  });
}

async function downloadAndExtract(): Promise<void> {
  fs.mkdirSync(DATA_DIR, { recursive: true });

  if (fs.existsSync(ZIP_TMP)) {
    console.log('Resuming from previously downloaded ZIP...');
  } else {
    console.log(`Downloading: ${DOWNLOAD_URL}`);
    try {
      await downloadFile(DOWNLOAD_URL, ZIP_TMP);
    } catch (err) {
      console.error('');
      console.error('Unable to download India PIN Code dataset.');
      console.error('Please check your internet connection or dataset source.');
      console.error(`  Source : ${DOWNLOAD_URL}`);
      console.error(`  Error  : ${(err as Error).message}`);
      process.exit(1);
    }
  }

  console.log('Extracting dataset...');
  const zipBuf = fs.readFileSync(ZIP_TMP);
  const txtBuf = extractEntryFromZip(zipBuf, ZIP_ENTRY);
  fs.writeFileSync(CSV_PATH, txtBuf);
  fs.unlinkSync(ZIP_TMP);
  console.log(`Dataset saved: ${CSV_PATH}  (${(txtBuf.length / 1_048_576).toFixed(1)} MB)`);
}

// ─── Row count (for progress display) ────────────────────────────────────────

async function countRows(filePath: string): Promise<number> {
  let n = 0;
  const rl = readline.createInterface({ input: fs.createReadStream(filePath, { encoding: 'utf-8' }), crlfDelay: Infinity });
  for await (const line of rl) { if (line.trim()) n++; }
  return n;
}

// ─── Import ───────────────────────────────────────────────────────────────────

async function importDataset(): Promise<void> {
  const totalRows = await countRows(CSV_PATH);
  console.log(`Rows detected: ${totalRows.toLocaleString()}`);
  console.log('');

  if (totalRows === 0) {
    console.error('ERROR: Data file is empty. Delete it and re-run to re-download.');
    process.exit(1);
  }

  let rowsRead     = 0;
  let rowsInvalid  = 0;
  let rowsDupCsv   = 0;
  let insertedNew  = 0;
  let alreadyInDb  = 0;

  const seen  = new Set<string>();
  const batch: PincodeRecord[] = [];

  const flush = async () => {
    if (!batch.length) return;
    const snap = [...batch]; batch.length = 0;
    const r = await prisma.pincode.createMany({ data: snap, skipDuplicates: true });
    insertedNew += r.count;
    alreadyInDb += snap.length - r.count;
  };

  const rl = readline.createInterface({ input: fs.createReadStream(CSV_PATH, { encoding: 'utf-8' }), crlfDelay: Infinity });

  for await (const line of rl) {
    if (!line.trim()) continue;

    // GeoNames TSV: tab-separated, no header
    // col[0]=country  col[1]=pincode  col[2]=place  col[3]=state  col[5]=district
    const cols = line.split('\t');
    if (cols.length < 6) { rowsInvalid++; continue; }

    const pincode  = cols[1]?.trim() ?? '';
    const city     = cols[2]?.trim() ?? '';
    const state    = cols[3]?.trim() ?? '';
    const district = cols[5]?.trim() || city;

    if (!/^\d{6}$/.test(pincode) || !state) { rowsInvalid++; continue; }
    if (seen.has(pincode)) { rowsDupCsv++; continue; }
    seen.add(pincode);

    batch.push({ pincode, officeName: '', city, district, state, country: 'India' });

    if (batch.length >= BATCH) await flush();

    rowsRead++;
    if (rowsRead % LOG_EVERY === 0) {
      console.log(`Imported ${rowsRead.toLocaleString()}...`);
    }
  }

  await flush();

  if (rowsRead % LOG_EVERY !== 0) {
    console.log(`Imported ${rowsRead.toLocaleString()}...`);
  }

  console.log('');
  console.log('Import completed.');
  console.log(`  Rows read            : ${totalRows.toLocaleString()}`);
  console.log(`  Rows skipped invalid : ${rowsInvalid.toLocaleString()}`);
  console.log(`  Rows skipped dup     : ${rowsDupCsv.toLocaleString()}`);
  console.log(`  Unique PIN Codes     : ${seen.size.toLocaleString()}`);
  console.log(`  Inserted (new)       : ${insertedNew.toLocaleString()}`);
  console.log(`  Skipped (in DB)      : ${alreadyInDb.toLocaleString()}`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('Checking local dataset...\n');

  if (fs.existsSync(CSV_PATH)) {
    console.log(`Dataset found: ${CSV_PATH}\n`);
  } else {
    console.log('Dataset not found.');
    console.log('Downloading...\n');
    await downloadAndExtract();
    console.log('\nDownload complete.\n');
  }

  await importDataset();

  const total = await prisma.pincode.count();
  console.log(`\nVerification: SELECT COUNT(*) FROM "Pincode" = ${total.toLocaleString()}`);

  if (total < 1000) {
    console.error(`\nERROR: Only ${total} rows in DB after import. Expected ~29,000.`);
    console.error('The data file may be corrupted. Delete prisma/data/pincodes.csv and re-run.');
    process.exit(1);
  }

  console.log('\nSeed completed successfully.');
}

main()
  .catch(err => { console.error(err); process.exit(1); })
  .finally(() => prisma.$disconnect());
