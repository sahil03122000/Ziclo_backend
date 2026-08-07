#!/usr/bin/env node
/**
 * Optional, idempotent cleanup for the "PENDING_PAYMENT bookings block slot capacity" bug.
 *
 * No data was actually corrupted by that bug — TimeSlot.isAvailable was never auto-set by
 * the old buggy code (it's a manual admin toggle, or set by the app only via the now-fixed
 * capacity logic), so there is nothing that strictly needs migrating. This script exists for
 * the case where an admin manually disabled a slot (PATCH .../availability) because it showed
 * as "fully booked" under the old bug even though nobody had actually paid for it.
 *
 * It recomputes, for every TimeSlot, how many bookings against it are in an
 * ACTIVE_BOOKING_STATUSES state (PENDING, CONFIRMED, ASSIGNED, IN_PROGRESS — i.e. actually
 * paid) and sets isAvailable = (activeCount < capacity). Safe to run multiple times.
 *
 * Usage:
 *   node scripts/reconcile-slot-availability.js          # apply changes
 *   node scripts/reconcile-slot-availability.js --dry-run # report only, no writes
 */

require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const ACTIVE_BOOKING_STATUSES = ['PENDING', 'CONFIRMED', 'ASSIGNED', 'IN_PROGRESS'];
const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  const prisma = new PrismaClient();
  const slots = await prisma.timeSlot.findMany({
    select: {
      id: true,
      date: true,
      startTime: true,
      capacity: true,
      isAvailable: true,
      _count: { select: { bookings: { where: { status: { in: ACTIVE_BOOKING_STATUSES } } } } },
    },
  });

  let changed = 0;
  for (const slot of slots) {
    const activeCount = slot._count.bookings;
    const shouldBeAvailable = activeCount < slot.capacity;

    if (shouldBeAvailable !== slot.isAvailable) {
      changed += 1;
      console.log(
        `${DRY_RUN ? '[dry-run] would update' : 'Updating'} slot ${slot.id} (${slot.date.toISOString().slice(0, 10)} ${slot.startTime}): ` +
          `isAvailable ${slot.isAvailable} -> ${shouldBeAvailable} (active bookings ${activeCount}/${slot.capacity})`,
      );
      if (!DRY_RUN) {
        await prisma.timeSlot.update({ where: { id: slot.id }, data: { isAvailable: shouldBeAvailable } });
      }
    }
  }

  console.log(`\nChecked ${slots.length} time slots — ${changed} needed a change.`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('FATAL ERROR:', err);
  process.exit(1);
});
