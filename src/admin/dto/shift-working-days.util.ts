// Normalizes workingDays input to the canonical number[] format (0 = Sunday .. 6 = Saturday)
// stored on the Shift entity. Accepts numbers already in canonical 0-6 form, ISO-style 1-7
// (1 = Monday .. 7 = Sunday, so only 7 needs remapping — 1-6 already match), or day-name
// strings — full name or common 3-letter abbreviation, case-insensitive — e.g. the UI may
// send ["MONDAY", "TUESDAY", ...] or [1..7] instead of [0..6]. Unrecognized values pass
// through unchanged so the existing @IsInt/@Min/@Max validators still report a clear error.
const DAY_NAME_TO_NUMBER: Record<string, number> = {
  SUNDAY: 0,
  SUN: 0,
  MONDAY: 1,
  MON: 1,
  TUESDAY: 2,
  TUE: 2,
  TUES: 2,
  WEDNESDAY: 3,
  WED: 3,
  THURSDAY: 4,
  THU: 4,
  THUR: 4,
  THURS: 4,
  FRIDAY: 5,
  FRI: 5,
  SATURDAY: 6,
  SAT: 6,
};

export function normalizeWorkingDays(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  const days: unknown[] = value as unknown[];
  return days.map((day: unknown): unknown => {
    if (typeof day === 'string') {
      const trimmed = day.trim();
      const key = trimmed.toUpperCase();
      if (key in DAY_NAME_TO_NUMBER) return DAY_NAME_TO_NUMBER[key];
      if (trimmed === '7') return 0; // ISO Sunday -> canonical 0
      return day;
    }
    if (day === 7) return 0; // ISO Sunday (1-7, Mon-Sun) -> canonical 0 (0-6, Sun-Sat)
    return day;
  });
}
