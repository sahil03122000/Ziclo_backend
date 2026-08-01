// The `todayAttendanceStatus` field's full domain is PRESENT | ABSENT | HALF_DAY | LEAVE |
// NO_CHECKIN, but only PRESENT/NO_CHECKIN are derivable from current data — this schema has no
// half-day or leave tracking (AttendanceStatus is only CHECKED_IN/CHECKED_OUT), and "ABSENT"
// (a confirmed non-presence) can't be distinguished from "hasn't checked in yet" without it.
export type TodayAttendanceStatus =
  | 'PRESENT'
  | 'ABSENT'
  | 'HALF_DAY'
  | 'LEAVE'
  | 'NO_CHECKIN';

export function deriveTodayAttendanceStatus(
  hasCheckedInToday: boolean,
): TodayAttendanceStatus {
  return hasCheckedInToday ? 'PRESENT' : 'NO_CHECKIN';
}
