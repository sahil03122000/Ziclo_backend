/**
 * Returns midnight-to-midnight for today in server local time.
 * Set TZ=Asia/Kolkata in the environment for IST deployments.
 */
export function getTodayRange(): { start: Date; end: Date } {
  const now = new Date();
  const start = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    0,
    0,
    0,
    0,
  );
  const end = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 1,
    0,
    0,
    0,
    0,
  );
  return { start, end };
}

export function startOfDay(date: Date): Date {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    0,
    0,
    0,
    0,
  );
}

export function endOfDay(date: Date): Date {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    23,
    59,
    59,
    999,
  );
}

// Formats a stored dateOfBirth (or any date-only field) as YYYY-MM-DD for API responses —
// never a full timestamp. Values are persisted from IsDateString input via `new Date(str)`,
// which parses to UTC midnight, so an ISO slice round-trips the original calendar date exactly.
export function toDateOnlyString(date: Date | null | undefined): string | null {
  if (!date) return null;
  return date.toISOString().slice(0, 10);
}

// Adds `days` (may be negative) to a 'YYYY-MM-DD' string, entirely in UTC —
// no local-timezone drift, since the input/output are date-only strings, not
// wall-clock times. Used for gap-filling day-by-day iteration (e.g. the
// leave calendar's "no attendance row" → ABSENT synthesis) where an
// off-by-one from timezone conversion would silently shift the wrong day.
export function addDaysToDateString(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Day of week for a 'YYYY-MM-DD' string, 0=Sunday..6=Saturday — same
// convention as Shift.workingDays. Computed in UTC to match
// addDaysToDateString above (the calendar gap-fill loops that call this
// build/iterate their date strings in UTC too, so this must agree with them
// rather than reintroduce a local-vs-UTC mismatch).
export function getDayOfWeek(dateStr: string): number {
  return new Date(`${dateStr}T00:00:00.000Z`).getUTCDay();
}

export type ReportPeriod = 'today' | 'week' | 'month';

// Resolves a report date filter. Explicit startDate/endDate always win over `period`. `week`
// is the trailing 7 days (today inclusive); `month` is the 1st of the current calendar month
// through today. Returns {} (no filter) when neither is supplied.
export function resolveReportDateRange(
  period?: ReportPeriod,
  startDate?: string,
  endDate?: string,
): { start?: Date; end?: Date } {
  if (startDate || endDate) {
    return {
      start: startDate ? startOfDay(new Date(startDate)) : undefined,
      end: endDate ? endOfDay(new Date(endDate)) : undefined,
    };
  }
  const now = new Date();
  if (period === 'today') {
    return { start: startOfDay(now), end: endOfDay(now) };
  }
  if (period === 'week') {
    const weekAgo = new Date(now);
    weekAgo.setDate(now.getDate() - 6);
    return { start: startOfDay(weekAgo), end: endOfDay(now) };
  }
  if (period === 'month') {
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    return { start: startOfDay(monthStart), end: endOfDay(now) };
  }
  return {};
}
