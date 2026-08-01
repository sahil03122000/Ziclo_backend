/**
 * Time Slot Seed
 *
 * Populates TimeSlot rows for every active Service across the next N days so the
 * booking flow (GET /api/v1/booking/time-slots) has data to return. Idempotent —
 * uses skipDuplicates against the @@unique([serviceId, date, startTime]) constraint.
 *
 * Run: npx ts-node prisma/seed-time-slots.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const DAYS_AHEAD = 14;
const SLOT_WINDOWS: Array<{ startTime: string; endTime: string }> = [
  { startTime: '09:00', endTime: '11:00' },
  { startTime: '11:00', endTime: '13:00' },
  { startTime: '14:00', endTime: '16:00' },
  { startTime: '16:00', endTime: '18:00' },
];
const CAPACITY = 5;

function dateOnlyUtc(daysFromNow: number): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysFromNow);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

async function main() {
  const services = await prisma.service.findMany({ where: { isActive: true }, select: { id: true, name: true } });
  if (!services.length) {
    console.log('No active services found — nothing to seed.');
    return;
  }

  const rows: { serviceId: string; date: Date; startTime: string; endTime: string; capacity: number }[] = [];

  for (const service of services) {
    for (let day = 1; day <= DAYS_AHEAD; day++) {
      const date = dateOnlyUtc(day);
      for (const window of SLOT_WINDOWS) {
        rows.push({ serviceId: service.id, date, ...window, capacity: CAPACITY });
      }
    }
  }

  const result = await prisma.timeSlot.createMany({ data: rows, skipDuplicates: true });

  console.log(`Services seeded : ${services.map((s) => s.name).join(', ')}`);
  console.log(`Days ahead      : ${DAYS_AHEAD}`);
  console.log(`Rows attempted  : ${rows.length}`);
  console.log(`Rows inserted   : ${result.count}`);

  const total = await prisma.timeSlot.count();
  console.log(`\nVerification: SELECT COUNT(*) FROM "TimeSlot" = ${total}`);
}

main()
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(() => prisma.$disconnect());
