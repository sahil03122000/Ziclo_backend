import { Injectable, NotFoundException } from '@nestjs/common';
import { AttendanceStatus, BookingStatus, LeaveRequestStatus } from '@prisma/client';

import { AttendanceService } from '../attendance/attendance.service';
import { addDaysToDateString, getDayOfWeek, getTodayRange } from '../common/utils/date.util';
import { LEAVE_TYPE_META } from '../leave-request/leave-request.service';
import { LeavePolicyService } from '../leave-policy/leave-policy.service';
import { PrismaService } from '../prisma/prisma.service';

// ─── Session / attendance-record shaping (Worker Panel Home + Attendance screens) ─────────
// Multiple Attendance rows can now exist per day (re-check-in support) — these helpers group
// them into the { date, sessions[], totalHours, status } shape the UI binds to.

type SessionRow = {
  id: string;
  checkInTime: Date;
  checkOutTime: Date | null;
  status: AttendanceStatus;
  checkInLatitude: number;
  checkInLongitude: number;
  checkOutLatitude: number | null;
  checkOutLongitude: number | null;
  photos: { type: 'CHECKIN' | 'CHECKOUT'; imageUrl: string }[];
};

const fmtTime = (d: Date) => d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
const fmtDate = (d: Date) => d.toISOString().split('T')[0];

function toSession(row: SessionRow, sessionNumber: number) {
  const checkInSelfie = row.photos.find((p) => p.type === 'CHECKIN')?.imageUrl ?? null;
  const checkOutSelfie = row.photos.find((p) => p.type === 'CHECKOUT')?.imageUrl ?? null;
  const durationMinutes = row.checkOutTime
    ? Math.round((row.checkOutTime.getTime() - row.checkInTime.getTime()) / 60000)
    : 0;

  return {
    sessionNumber,
    checkIn: fmtTime(row.checkInTime),
    checkOut: row.checkOutTime ? fmtTime(row.checkOutTime) : null,
    checkInEpoch: row.checkInTime.getTime(),
    checkOutEpoch: row.checkOutTime?.getTime() ?? null,
    checkInSelfieUri: checkInSelfie,
    checkOutSelfieUri: checkOutSelfie,
    checkInCoords: { lat: row.checkInLatitude, lng: row.checkInLongitude },
    checkOutCoords:
      row.checkOutLatitude != null && row.checkOutLongitude != null
        ? { lat: row.checkOutLatitude, lng: row.checkOutLongitude }
        : null,
    durationMinutes,
  };
}

const STATUS_TO_UI: Partial<Record<AttendanceStatus, 'present' | 'absent' | 'half-day'>> = {
  [AttendanceStatus.PRESENT]: 'present',
  [AttendanceStatus.HALF_DAY]: 'half-day',
  [AttendanceStatus.ABSENT]: 'absent',
};

@Injectable()
export class WorkerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly attendanceService: AttendanceService,
    private readonly leavePolicyService: LeavePolicyService,
  ) {}

  // ─── Profile (Worker Panel: Profile / Settings) ────────────────────────────────

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true, name: true, email: true, phone: true, profileImage: true,
        workerProfile: {
          select: {
            address: true, aadhaarNumber: true, panNumber: true,
            salaryType: true, salaryAmount: true, commissionPercent: true,
            areaId: true, area: { select: { name: true } }, joiningDate: true,
          },
        },
      },
    });
    if (!user || !user.workerProfile) throw new NotFoundException('Worker profile not found');

    const reportingManager = await this.getReportingManager(user.workerProfile.areaId);

    return {
      success: true,
      data: {
        name: user.name,
        mobile: user.phone,
        email: user.email,
        address: user.workerProfile.address ?? '',
        profilePhotoUri: user.profileImage,
        aadhaarNumber: user.workerProfile.aadhaarNumber ?? '',
        panNumber: user.workerProfile.panNumber ?? '',
        // No rating/review system exists in this schema yet — always 0 rather than a
        // fabricated number.
        rating: 0,
        totalRatings: 0,
        salaryType: user.workerProfile.salaryType === 'COMMISSION' ? 'commission' : 'salary',
        salaryAmount: user.workerProfile.salaryAmount ?? 0,
        commissionPct: user.workerProfile.commissionPercent ?? 0,
        assignedAreaName: user.workerProfile.area?.name ?? '',
        reportingManager,
        joiningDate: user.workerProfile.joiningDate ? fmtDate(user.workerProfile.joiningDate) : null,
      },
    };
  }

  // ─── Leave calendar (Worker Panel: Leave — attendance-aware calendar) ─────────────
  // Aggregates three already-existing, independently-fetchable pieces into one response so the
  // frontend calendar doesn't need three separate round trips: joiningDate (WorkerProfile,
  // same field getProfile() now also returns), per-day attendance status (reuses
  // getAttendanceHistory's exact grouping/outcome logic — not re-derived), and this worker's
  // own leave requests (reuses WorkerLeaveRequest via the existing leave-request read path).
  // No new attendance or leave model — purely a read-side aggregation.
  async getLeaveCalendar(userId: string, days: number) {
    // shiftRef is additive here purely so the calendar UI can compute
    // "Weekly Off" (a day outside Shift.workingDays) honestly — no worker
    // self-endpoint exposed shift before this; nothing else about the shift
    // relation changes.
    const workerProfile = await this.prisma.workerProfile.findUnique({
      where: { userId },
      select: { joiningDate: true, shiftRef: { select: { id: true, name: true, startTime: true, endTime: true, workingDays: true } } },
    });
    if (!workerProfile) throw new NotFoundException('Worker profile not found');

    const [attendanceHistory, leaves] = await Promise.all([
      this.getAttendanceHistory(userId, days),
      this.prisma.workerLeaveRequest.findMany({
        where: { workerId: userId },
        orderBy: { date: 'desc' },
      }),
    ]);

    // 'half-day' has no single PRESENT/ABSENT/LEAVE bucket of its own in the calendar contract
    // requested — treated as PRESENT (the worker did attend), same as how
    // resolveAttendanceOutcome only distinguishes it for payroll/summary purposes, not
    // attendance-vs-absence.
    const attendanceByDate = new Map<string, 'PRESENT' | 'ABSENT' | 'LEAVE'>(
      attendanceHistory.data.map((r) => [r.date, r.status === 'absent' ? 'ABSENT' : 'PRESENT']),
    );
    // Approved-leave dates fill in LEAVE for any day with no attendance row at all (the worker
    // didn't check in — expected, they were on leave). An actual Attendance row always wins if
    // one somehow exists for the same date, since that's a directly-observed fact.
    for (const l of leaves) {
      if (l.status !== LeaveRequestStatus.APPROVED) continue;
      const key = fmtDate(l.date);
      if (!attendanceByDate.has(key)) attendanceByDate.set(key, 'LEAVE');
    }

    // Explicit business rule (there is no EOD/cron job that ever writes an
    // ABSENT Attendance row for a day with zero check-in — see
    // markMissedCheckout, which only ever updates an existing CHECKED_IN
    // row): any day from joiningDate (or the `days` window, whichever is
    // later) through yesterday that still has no attendance row and no
    // approved leave is a genuine no-show — ABSENT. Today is deliberately
    // excluded (still in progress, not yet a completed absence), and no day
    // before joiningDate is ever touched.
    //
    // A day outside the worker's own Shift.workingDays is never synthesized
    // as ABSENT here — it's left out of `attendanceByDate` entirely so the
    // frontend's own (single, shared) Weekly-Off rendering — driven by the
    // same `shift.workingDays` returned below — is the one place that ever
    // decides WO, never duplicated here. Without this, every weekly-off day
    // would already be pinned to ABSENT before the frontend ever got a
    // chance to recognize it as WO.
    const joiningStr = workerProfile.joiningDate ? fmtDate(workerProfile.joiningDate) : null;
    const windowStart = fmtDate(new Date(Date.now() - days * 24 * 60 * 60 * 1000));
    const today = fmtDate(new Date());
    const yesterday = addDaysToDateString(today, -1);
    const workingDays = workerProfile.shiftRef?.workingDays ?? null;
    let cursor = joiningStr && joiningStr > windowStart ? joiningStr : windowStart;
    while (cursor <= yesterday) {
      const isWeeklyOff = workingDays != null && !workingDays.includes(getDayOfWeek(cursor));
      if (!attendanceByDate.has(cursor) && !isWeeklyOff) attendanceByDate.set(cursor, 'ABSENT');
      cursor = addDaysToDateString(cursor, 1);
    }

    return {
      success: true,
      data: {
        joiningDate: workerProfile.joiningDate ? fmtDate(workerProfile.joiningDate) : null,
        attendance: Array.from(attendanceByDate.entries())
          .map(([date, status]) => ({ date, status }))
          .sort((a, b) => b.date.localeCompare(a.date)),
        leaves: leaves.map((l) => ({
          startDate: fmtDate(l.date),
          endDate: fmtDate(l.date),
          leaveType: l.type,
          leaveTypeCode: LEAVE_TYPE_META[l.type].code,
          leaveTypeName: LEAVE_TYPE_META[l.type].name,
          status: l.status,
        })),
        shift: workerProfile.shiftRef
          ? {
              id: workerProfile.shiftRef.id,
              name: workerProfile.shiftRef.name,
              startTime: workerProfile.shiftRef.startTime,
              endTime: workerProfile.shiftRef.endTime,
              workingDays: workerProfile.shiftRef.workingDays,
            }
          : null,
      },
    };
  }

  // ─── Assigned offices (Worker Panel: Check-in geofencing + Profile) ────────────

  async getAssignedOffices(userId: string) {
    const profile = await this.prisma.workerProfile.findUnique({
      where: { userId },
      select: { areaId: true },
    });
    if (!profile) throw new NotFoundException('Worker profile not found');
    if (!profile.areaId) return { success: true, data: [] };

    const offices = await this.prisma.officeLocation.findMany({
      where: { areaId: profile.areaId },
      select: { id: true, name: true, address: true, latitude: true, longitude: true, radius: true, isActive: true },
      orderBy: { name: 'asc' },
    });

    return {
      success: true,
      data: offices.map((o) => ({
        id: o.id,
        name: o.name,
        address: o.address ?? '',
        lat: o.latitude,
        lng: o.longitude,
        radiusMeters: o.radius,
        active: o.isActive,
      })),
    };
  }

  // ─── Dashboard (Worker Panel: Home) ────────────────────────────────────────────

  async getDashboard(userId: string) {
    const [profileResult, todayResult, jobCounts, earningsResult, leaveBalanceResult, attendanceSummaryResult] =
      await Promise.all([
        this.getProfile(userId),
        this.getTodayAttendanceRecord(userId),
        this.getJobCounts(userId),
        this.getEarnings(userId),
        this.leavePolicyService.getBalance(userId),
        this.attendanceService.getMonthlySummary(userId, {}),
      ]);

    return {
      success: true,
      data: {
        workerProfile: profileResult.data,
        todayCheckIn: todayResult.todayCheckIn,
        checkInEpoch: todayResult.checkInEpoch,
        attendance: todayResult.record ? [todayResult.record] : [],
        jobs: jobCounts,
        earnings: earningsResult.data,
        // Backend-computed Available/Used/Remaining per leave type + Leave Without Pay Used —
        // the UI must never derive these itself.
        leaveBalance: leaveBalanceResult.data,
        // Current-calendar-month attendance summary (reuses AttendanceService.getMonthlySummary
        // wholesale — same shape as GET attendance/me/summary).
        attendanceSummary: attendanceSummaryResult.data,
      },
    };
  }

  // ─── Earnings (Worker Panel: Home + Profile) ───────────────────────────────────
  // Derived on the fly from completed Bookings (amount - advanceAmount already collected) —
  // no separate ledger table exists or is needed for this.

  async getEarnings(userId: string) {
    const { start, end } = getTodayRange();
    const weekStart = new Date(start);
    weekStart.setDate(weekStart.getDate() - 6);
    const monthStart = new Date(start.getFullYear(), start.getMonth(), 1);

    const completed = await this.prisma.booking.findMany({
      where: { workerId: userId, status: BookingStatus.COMPLETED },
      select: { completedAt: true, totalAmount: true, advanceAmount: true },
    });

    const earned = (b: { totalAmount: number | null; advanceAmount: number | null }) =>
      (b.totalAmount ?? 0) - (b.advanceAmount ?? 0);

    const inRange = (d: Date | null, from: Date) => d != null && d >= from && d < end;

    const today = completed.filter((b) => inRange(b.completedAt, start)).reduce((s, b) => s + earned(b), 0);
    const thisWeek = completed.filter((b) => inRange(b.completedAt, weekStart)).reduce((s, b) => s + earned(b), 0);
    const thisMonth = completed.filter((b) => inRange(b.completedAt, monthStart)).reduce((s, b) => s + earned(b), 0);
    const total = completed.reduce((s, b) => s + earned(b), 0);

    return { success: true, data: { today, thisWeek, thisMonth, total, currency: 'INR' } };
  }

  // ─── Attendance (Worker Panel: Home + Attendance) — grouped multi-session view ─────────

  async getTodayAttendance(userId: string) {
    const { record, todayCheckIn, checkInEpoch } = await this.getTodayAttendanceRecord(userId);
    return { success: true, data: { record, todayCheckIn, checkInEpoch } };
  }

  async getAttendanceHistory(userId: string, days: number) {
    const end = new Date();
    const start = new Date(end);
    start.setDate(start.getDate() - (days - 1));
    start.setHours(0, 0, 0, 0);

    const rows = await this.prisma.attendance.findMany({
      where: { userId, checkInTime: { gte: start } },
      select: {
        id: true, checkInTime: true, checkOutTime: true, status: true,
        checkInLatitude: true, checkInLongitude: true, checkOutLatitude: true, checkOutLongitude: true,
        photos: { select: { type: true, imageUrl: true } },
      },
      orderBy: { checkInTime: 'asc' },
    });

    const byDate = new Map<string, typeof rows>();
    for (const row of rows) {
      const key = fmtDate(row.checkInTime);
      const list = byDate.get(key) ?? [];
      list.push(row);
      byDate.set(key, list);
    }

    const records = await Promise.all(
      Array.from(byDate.entries()).map(([date, sessionRows]) =>
        this.buildDayRecord(userId, date, sessionRows),
      ),
    );
    records.sort((a, b) => b.date.localeCompare(a.date));

    return { success: true, data: records };
  }

  private async getTodayAttendanceRecord(userId: string) {
    const { data: sessions } = await this.attendanceService.getTodaySessions(userId);
    const today = fmtDate(new Date());
    const record = sessions.length > 0 ? await this.buildDayRecord(userId, today, sessions) : null;

    // status-based, not checkOutTime-based — a missed checkout also leaves checkOutTime null
    // but is a closed/terminal ABSENT session, not an open one.
    const openSession = sessions.find((s) => s.status === AttendanceStatus.CHECKED_IN) ?? null;
    return {
      record,
      todayCheckIn: openSession ? fmtTime(openSession.checkInTime) : null,
      checkInEpoch: openSession ? openSession.checkInTime.getTime() : null,
    };
  }

  private async buildDayRecord(userId: string, date: string, rows: SessionRow[]) {
    const sessions = rows.map((r, i) => toSession(r, i + 1));
    const totalMinutes = sessions.reduce((s, sess) => s + sess.durationMinutes, 0);
    const totalHours = totalMinutes / 60;

    // A currently-open session reads as "present" (day still in progress). A missed checkout
    // is ABSENT (checkOutTime also null, but status is CHECKED_IN only while genuinely open) —
    // this is the fix for "still becomes Present" when checkout was missed.
    const hasOpenSession = rows.some((r) => r.status === AttendanceStatus.CHECKED_IN);
    const status = hasOpenSession
      ? 'present'
      : STATUS_TO_UI[await this.attendanceService.resolveAttendanceOutcome(userId, totalHours)] ?? 'absent';

    return { id: rows[0].id, date, sessions, totalHours, status };
  }

  // ─── Shared helpers ─────────────────────────────────────────────────────────────

  private async getReportingManager(areaId: string | null) {
    if (!areaId) return { name: '', phone: '', email: '' };
    const managerArea = await this.prisma.managerArea.findFirst({
      where: { areaId },
      select: { manager: { select: { user: { select: { name: true, phone: true, email: true } } } } },
    });
    return managerArea
      ? { name: managerArea.manager.user.name, phone: managerArea.manager.user.phone, email: managerArea.manager.user.email }
      : { name: '', phone: '', email: '' };
  }

  // 'assigned' vs 'accepted' are both BookingStatus.ASSIGNED under the hood, split by whether
  // workerAcceptedAt has been set — same distinction toWorkerJobStatus() makes per-booking.
  private async getJobCounts(userId: string) {
    const [assigned, accepted, inProgress, completed, cancelled] = await Promise.all([
      this.prisma.booking.count({ where: { workerId: userId, status: BookingStatus.ASSIGNED, workerAcceptedAt: null } }),
      this.prisma.booking.count({ where: { workerId: userId, status: BookingStatus.ASSIGNED, workerAcceptedAt: { not: null } } }),
      this.prisma.booking.count({ where: { workerId: userId, status: BookingStatus.IN_PROGRESS } }),
      this.prisma.booking.count({ where: { workerId: userId, status: BookingStatus.COMPLETED } }),
      this.prisma.booking.count({ where: { workerId: userId, status: BookingStatus.CANCELLED } }),
    ]);

    return { assigned, accepted, inProgress, completed, cancelled };
  }
}
