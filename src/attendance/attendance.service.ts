import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ActivityAction,
  ActivityModule,
  AuditAction,
  AttendanceStatus,
  LeaveRequestStatus,
  MissedCheckoutApprovalLevel,
  MissedCheckoutRequestStatus,
  PhotoType,
  Prisma,
  Role,
} from '@prisma/client';

import { ActivityLogService } from '../activity-log/activity-log.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { getTodayRange } from '../common/utils/date.util';
import { LeavePolicyService } from '../leave-policy/leave-policy.service';
import { PrismaService } from '../prisma/prisma.service';
import { AttendanceSummaryQueryDto } from './dto/attendance-summary-query.dto';
import {
  AttendanceAdminQueryDto,
  AttendanceHistoryQueryDto,
} from './dto/attendance-query.dto';
import { CheckInDto } from './dto/check-in.dto';
import { CheckOutDto } from './dto/check-out.dto';
import { CorrectAttendanceDto } from './dto/correct-attendance.dto';

const PHOTO_SELECT = {
  id: true,
  type: true,
  imageUrl: true,
  createdAt: true,
} satisfies Prisma.AttendancePhotoSelect;
const OFFICE_SELECT = {
  id: true,
  name: true,
} satisfies Prisma.OfficeLocationSelect;
const USER_SELECT = {
  id: true,
  name: true,
  email: true,
  role: true,
} satisfies Prisma.UserSelect;

@Injectable()
export class AttendanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly activityLog: ActivityLogService,
    private readonly leavePolicyService: LeavePolicyService,
  ) {}

  async checkIn(
    userId: string,
    dto: CheckInDto,
    actor?: { name: string; role: Role },
  ) {
    const { start, end } = getTodayRange();

    // Multi-session days are allowed (Worker Panel: re-check-in after a same-day checkout) —
    // only an already-open session blocks a new check-in. A completed session (CHECKED_OUT, or
    // an ABSENT row from a detected missed checkout) does not — ABSENT is a closed/terminal
    // state as far as check-in/out goes; it's resolved independently via the missed-checkout
    // request flow.
    const openSession = await this.prisma.attendance.findFirst({
      where: {
        userId,
        checkInTime: { gte: start, lt: end },
        status: AttendanceStatus.CHECKED_IN,
      },
      select: { id: true },
    });

    if (openSession) {
      throw new BadRequestException('You have already checked in today');
    }

    const officeLocation = await this.prisma.officeLocation.findUnique({
      where: { id: dto.officeLocationId },
    });
    if (!officeLocation)
      throw new NotFoundException('Office location not found');
    if (!officeLocation.isActive)
      throw new BadRequestException('Office location is not active');

    const distanceMeters = this.haversineDistance(
      dto.latitude,
      dto.longitude,
      officeLocation.latitude,
      officeLocation.longitude,
    );
    if (distanceMeters > officeLocation.radius) {
      throw new BadRequestException(
        `You are ${Math.round(distanceMeters)}m from the office. Allowed radius is ${officeLocation.radius}m.`,
      );
    }

    // Additive — only for MANAGER (WORKER check-in behavior is unchanged for backward
    // compatibility). Confirms the office/area are the manager's own assignment and, if a
    // shift is assigned, that check-in falls within it.
    if (actor?.role === Role.MANAGER) {
      await this.validateManagerCheckInAssignment(
        userId,
        dto.officeLocationId,
        officeLocation.areaId,
        new Date(),
      );
    }

    const attendance = await this.prisma.attendance.create({
      data: {
        userId,
        officeLocationId: dto.officeLocationId,
        checkInTime: new Date(),
        checkInLatitude: dto.latitude,
        checkInLongitude: dto.longitude,
        status: AttendanceStatus.CHECKED_IN,
        photos: {
          create: { type: PhotoType.CHECKIN, imageUrl: dto.selfieImageUrl },
        },
      },
      include: {
        photos: { select: PHOTO_SELECT },
        officeLocation: { select: OFFICE_SELECT },
      },
    });

    this.auditLogs
      .log({
        actorId: userId,
        entityType: 'Attendance',
        entityId: attendance.id,
        action: AuditAction.CHECK_IN,
        newValue: {
          officeLocationId: dto.officeLocationId,
          latitude: dto.latitude,
          longitude: dto.longitude,
        },
      })
      .catch(() => {});
    this.activityLog.log({
      action: ActivityAction.WORKER_CHECKIN,
      module: ActivityModule.ATTENDANCE,
      description: `${actor?.name ?? 'Worker'} checked in`,
      actor: {
        id: userId,
        name: actor?.name ?? 'Worker',
        role: actor?.role ?? 'WORKER',
      },
      target: { id: attendance.id, type: 'Attendance' },
      metadata: { officeLocationId: dto.officeLocationId },
    });

    // Additive — reuses getTodayAttendance (not re-derived) so the caller gets an immediately
    // up-to-date "today" view in the same response, without a second round trip.
    const todayResult = await this.getTodayAttendance(userId);

    return {
      success: true,
      message: 'Checked in successfully',
      data: {
        ...attendance,
        attendanceStatus: attendance.status,
        checkInTime: attendance.checkInTime,
        workingDuration: Math.floor(
          (Date.now() - attendance.checkInTime.getTime()) / 1000,
        ),
        todaySummary: todayResult.data,
      },
    };
  }

  async checkOut(
    userId: string,
    dto: CheckOutDto,
    actor?: { name: string; role: Role },
  ) {
    const { start, end } = getTodayRange();

    const openToday = await this.prisma.attendance.findFirst({
      where: {
        userId,
        checkInTime: { gte: start, lt: end },
        status: AttendanceStatus.CHECKED_IN,
      },
      select: { id: true },
    });
    if (openToday) await this.flagIfMissedCheckout(openToday.id);

    const attendance = await this.prisma.attendance.findFirst({
      where: {
        userId,
        checkInTime: { gte: start, lt: end },
        status: AttendanceStatus.CHECKED_IN,
      },
      select: {
        id: true,
        officeLocation: {
          select: { latitude: true, longitude: true, radius: true },
        },
      },
    });

    if (!attendance) {
      if (openToday) {
        throw new BadRequestException(
          'The check-out window for this shift has passed. Please raise a missed checkout request.',
        );
      }
      throw new BadRequestException(
        'No active check-in found for today. Please check in first.',
      );
    }

    // Additive — only for MANAGER (WORKER checkout behavior is unchanged for backward
    // compatibility). Check-in already validates the geofence; checkout re-validates it too,
    // reusing the same haversineDistance helper.
    if (actor?.role === Role.MANAGER && attendance.officeLocation) {
      const distanceMeters = this.haversineDistance(
        dto.latitude,
        dto.longitude,
        attendance.officeLocation.latitude,
        attendance.officeLocation.longitude,
      );
      if (distanceMeters > attendance.officeLocation.radius) {
        throw new BadRequestException(
          `You are ${Math.round(distanceMeters)}m from the office. Allowed radius is ${attendance.officeLocation.radius}m.`,
        );
      }
    }

    const updated = await this.prisma.attendance.update({
      where: { id: attendance.id },
      data: {
        checkOutTime: new Date(),
        checkOutLatitude: dto.latitude,
        checkOutLongitude: dto.longitude,
        status: AttendanceStatus.CHECKED_OUT,
        photos: {
          create: { type: PhotoType.CHECKOUT, imageUrl: dto.selfieImageUrl },
        },
      },
      include: {
        photos: { select: PHOTO_SELECT },
        officeLocation: { select: OFFICE_SELECT },
      },
    });

    this.auditLogs
      .log({
        actorId: userId,
        entityType: 'Attendance',
        entityId: attendance.id,
        action: AuditAction.CHECK_OUT,
        newValue: { latitude: dto.latitude, longitude: dto.longitude },
      })
      .catch(() => {});
    this.activityLog.log({
      action: ActivityAction.WORKER_CHECKOUT,
      module: ActivityModule.ATTENDANCE,
      description: `${actor?.name ?? 'Worker'} checked out`,
      actor: {
        id: userId,
        name: actor?.name ?? 'Worker',
        role: actor?.role ?? 'WORKER',
      },
      target: { id: attendance.id, type: 'Attendance' },
    });

    return {
      success: true,
      message: 'Checked out successfully',
      data: updated,
    };
  }

  // Self-service — scoped to userId only, resolved directly from the JWT.
  async getTodayAttendance(userId: string) {
    const { start, end } = getTodayRange();
    const where: Prisma.AttendanceWhereInput = {
      userId,
      checkInTime: { gte: start, lt: end },
    };

    const openToday = await this.prisma.attendance.findFirst({
      where: { ...where, status: AttendanceStatus.CHECKED_IN },
      select: { id: true },
    });
    if (openToday) await this.flagIfMissedCheckout(openToday.id);

    const attendance = await this.prisma.attendance.findFirst({
      where,
      include: {
        photos: { select: PHOTO_SELECT },
        officeLocation: { select: OFFICE_SELECT },
      },
      // Multi-session days are allowed — always resolve to the most recent session today.
      orderBy: { checkInTime: 'desc' },
    });
    return { success: true, data: attendance ?? null };
  }

  // Worker Panel "Home" / "Attendance" screens — all of today's sessions grouped together
  // (re-check-in support), reusing the same PHOTO_SELECT/OFFICE_SELECT shapes as above.
  async getTodaySessions(userId: string) {
    const { start, end } = getTodayRange();
    const where: Prisma.AttendanceWhereInput = {
      userId,
      checkInTime: { gte: start, lt: end },
    };

    const openSession = await this.prisma.attendance.findFirst({
      where: { ...where, status: AttendanceStatus.CHECKED_IN },
      select: { id: true },
    });
    if (openSession) await this.flagIfMissedCheckout(openSession.id);

    const sessions = await this.prisma.attendance.findMany({
      where,
      include: {
        photos: { select: PHOTO_SELECT },
        officeLocation: { select: OFFICE_SELECT },
      },
      orderBy: { checkInTime: 'asc' },
    });
    return { success: true, data: sessions };
  }

  async getHistory(userId: string, query: AttendanceHistoryQueryDto) {
    const { page = 1, limit = 20, startDate, endDate } = query;
    const skip = (page - 1) * limit;
    const where: Prisma.AttendanceWhereInput = { userId };

    if (startDate || endDate) {
      where.checkInTime = {};
      if (startDate) where.checkInTime.gte = new Date(startDate);
      if (endDate) where.checkInTime.lte = new Date(endDate);
    }

    const [attendances, total] = await this.prisma.$transaction([
      this.prisma.attendance.findMany({
        where,
        include: {
          photos: { select: PHOTO_SELECT },
          officeLocation: { select: OFFICE_SELECT },
        },
        skip,
        take: limit,
        orderBy: { checkInTime: 'desc' },
      }),
      this.prisma.attendance.count({ where }),
    ]);

    return {
      success: true,
      data: {
        attendances,
        meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
      },
    };
  }

  // Admin — all records, filtered only by the query params below.
  async findAll(query: AttendanceAdminQueryDto) {
    const {
      page = 1,
      limit = 20,
      userId,
      pincodeId,
      date,
      startDate,
      endDate,
      status,
    } = query;
    const skip = (page - 1) * limit;
    const where: Prisma.AttendanceWhereInput = {};

    if (userId) where.userId = userId;
    if (status) where.status = status;
    if (pincodeId) where.user = { workerProfile: { pincodeId } };

    if (date) {
      const d = new Date(date);
      where.checkInTime = {
        gte: new Date(d.getFullYear(), d.getMonth(), d.getDate()),
        lt: new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1),
      };
    } else if (startDate || endDate) {
      where.checkInTime = {};
      if (startDate) where.checkInTime.gte = new Date(startDate);
      if (endDate) where.checkInTime.lte = new Date(endDate);
    }

    const [attendances, total] = await this.prisma.$transaction([
      this.prisma.attendance.findMany({
        where,
        include: {
          user: { select: USER_SELECT },
          photos: { select: PHOTO_SELECT },
          officeLocation: { select: OFFICE_SELECT },
        },
        skip,
        take: limit,
        orderBy: { checkInTime: 'desc' },
      }),
      this.prisma.attendance.count({ where }),
    ]);

    return {
      success: true,
      data: {
        attendances,
        meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
      },
    };
  }

  async findOne(id: string) {
    const attendance = await this.prisma.attendance.findUnique({
      where: { id },
      include: {
        user: { select: USER_SELECT },
        photos: { select: PHOTO_SELECT },
        officeLocation: { select: OFFICE_SELECT },
      },
    });
    if (!attendance) throw new NotFoundException('Attendance record not found');
    return { success: true, data: attendance };
  }

  async correct(id: string, dto: CorrectAttendanceDto, actorId: string) {
    const attendance = await this.prisma.attendance.findUnique({
      where: { id },
      select: {
        id: true,
        checkInTime: true,
        checkOutTime: true,
        status: true,
      },
    });
    if (!attendance) throw new NotFoundException('Attendance record not found');

    if (dto.checkInTime && dto.checkOutTime) {
      const cin = new Date(dto.checkInTime);
      const cout = new Date(dto.checkOutTime);
      if (cout <= cin)
        throw new BadRequestException('checkOutTime must be after checkInTime');
    }

    const newStatus = dto.checkOutTime
      ? AttendanceStatus.CHECKED_OUT
      : attendance.status;

    const updated = await this.prisma.attendance.update({
      where: { id },
      data: {
        ...(dto.checkInTime !== undefined && {
          checkInTime: new Date(dto.checkInTime),
        }),
        ...(dto.checkOutTime !== undefined && {
          checkOutTime: new Date(dto.checkOutTime),
          status: AttendanceStatus.CHECKED_OUT,
        }),
        ...(!dto.checkOutTime && { status: newStatus }),
      },
      include: {
        user: { select: USER_SELECT },
        photos: { select: PHOTO_SELECT },
        officeLocation: { select: OFFICE_SELECT },
      },
    });

    this.auditLogs
      .log({
        actorId,
        entityType: 'Attendance',
        entityId: id,
        action: AuditAction.UPDATE,
        oldValue: {
          checkInTime: attendance.checkInTime,
          checkOutTime: attendance.checkOutTime,
        },
        newValue: {
          checkInTime: dto.checkInTime,
          checkOutTime: dto.checkOutTime,
          note: dto.note,
        },
      })
      .catch(() => {});

    return {
      success: true,
      message: 'Attendance corrected successfully',
      data: updated,
    };
  }

  async getMonthlySummary(userId: string, query: AttendanceSummaryQueryDto) {
    const now = new Date();
    const month = query.month ?? now.getMonth() + 1;
    const year = query.year ?? now.getFullYear();
    const isCurrentMonth =
      month === now.getMonth() + 1 && year === now.getFullYear();

    // start/end always bound the query to exactly this calendar month — never a previous or
    // future month, regardless of when this is called.
    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 1);
    // For the current, still-in-progress month only: the working-days denominator (and
    // therefore absentCount/attendancePercentage) must not count days that haven't happened
    // yet — capped at the start of tomorrow so today itself is still included.
    const workingDaysEnd = isCurrentMonth
      ? new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
      : end;

    const recordsWhere: Prisma.AttendanceWhereInput = {
      userId,
      checkInTime: { gte: start, lt: end },
    };

    const [records, shift] = await Promise.all([
      this.prisma.attendance.findMany({
        where: recordsWhere,
        select: { checkInTime: true, checkOutTime: true, status: true },
        orderBy: { checkInTime: 'asc' },
      }),
      this.resolveUserShift(userId),
    ]);

    const { start: todayStart, end: todayEnd } = getTodayRange();
    const fullDayHours = shift?.fullDayHours ?? null;
    const halfDayHours = shift?.halfDayHours ?? null;

    let presentCount = 0;
    let halfDayCount = 0;
    let totalHours = 0;

    for (const r of records) {
      // ABSENT bypasses the threshold recompute below — whether it's a detected missed
      // checkout awaiting/without a resolved request, or a rejected one, it never counts as
      // attended or contributes hours (payroll treats it as an unpaid absence).
      if (r.status === AttendanceStatus.ABSENT) {
        continue;
      }
      // PRESENT / HALF_DAY were already classified by MissedCheckoutService on approval —
      // trust that status directly instead of recomputing against today's shift thresholds.
      if (
        r.status === AttendanceStatus.PRESENT ||
        r.status === AttendanceStatus.HALF_DAY
      ) {
        if (r.checkOutTime) {
          totalHours +=
            (r.checkOutTime.getTime() - r.checkInTime.getTime()) / 3_600_000;
        }
        if (r.status === AttendanceStatus.PRESENT) presentCount++;
        else halfDayCount++;
        continue;
      }

      const isOngoingToday =
        !r.checkOutTime &&
        r.checkInTime >= todayStart &&
        r.checkInTime < todayEnd;

      // Completed attendance contributes its full duration; a still-open session from today
      // contributes its elapsed time so far (the "live session" requirement). An open session
      // left over from a PAST day (never checked out) contributes 0 hours but still counts as
      // attendance below.
      const hoursWorked = r.checkOutTime
        ? (r.checkOutTime.getTime() - r.checkInTime.getTime()) / 3_600_000
        : isOngoingToday
          ? (now.getTime() - r.checkInTime.getTime()) / 3_600_000
          : 0;

      totalHours += hoursWorked;

      if (
        fullDayHours !== null &&
        halfDayHours !== null &&
        (r.checkOutTime || isOngoingToday)
      ) {
        if (hoursWorked >= fullDayHours) presentCount++;
        else if (hoursWorked >= halfDayHours) halfDayCount++;
        else presentCount++; // attended, just short of half-day — still counts as present
      } else {
        // No shift half/full-day thresholds configured — every attendance row counts as
        // present, matching this method's original (pre-half-day) behavior.
        presentCount++;
      }
    }

    // "Attendance Updated" for an approved leave request — rather than inserting a synthetic
    // Attendance row (checkInTime/lat/lng/officeLocationId are all required on that model), an
    // approved leave day is reflected here directly from WorkerLeaveRequest.
    const leaveCount = await this.prisma.workerLeaveRequest.count({
      where: { workerId: userId, status: LeaveRequestStatus.APPROVED, date: { gte: start, lt: end } },
    });

    const totalDays = this.countWorkingDays(
      start,
      workingDaysEnd,
      shift?.workingDays ?? null,
    );
    const absentCount = Math.max(
      0,
      totalDays - presentCount - halfDayCount - leaveCount,
    );
    const attendancePercentage =
      totalDays > 0 ? Math.round((presentCount / totalDays) * 100) : 0;

    return {
      success: true,
      data: {
        month,
        year,
        totalDays,
        presentCount,
        absentCount,
        totalHours: parseFloat(totalHours.toFixed(2)),
        avgHoursPerDay:
          presentCount > 0
            ? parseFloat((totalHours / presentCount).toFixed(2))
            : 0,
        // Additive — the current-month-summary fields this method was missing.
        halfDayCount,
        leaveCount,
        attendancePercentage,
      },
    };
  }

  // Reused by MissedCheckoutService: the moment an open check-in becomes eligible for a missed
  // checkout request — the user's assigned shift end time (falling back to the global
  // AttendanceRule.checkOutBefore when no shift is assigned) plus a 2-hour grace window.
  async getMissedCheckoutDeadline(
    userId: string,
    checkInTime: Date,
  ): Promise<Date> {
    const shift = await this.resolveUserShift(userId);
    let endTime = shift?.endTime;
    if (!endTime) {
      const rule = await this.prisma.attendanceRule.findUnique({
        where: { id: 'singleton' },
        select: { checkOutBefore: true },
      });
      endTime = rule?.checkOutBefore ?? '17:00';
    }
    const [endH, endM] = endTime.split(':').map(Number);
    const deadline = new Date(checkInTime);
    deadline.setHours(endH, endM, 0, 0);
    deadline.setTime(deadline.getTime() + 2 * 60 * 60 * 1000);
    return deadline;
  }

  // Reused by checkOut/getTodayAttendance (lazy, on-demand check) and the Missed Checkout
  // Detection cron (bulk, scheduled sweep) — both funnel through markMissedCheckout below so
  // the outcome is identical either way. No auto-checkout: the record is never auto-completed
  // to CHECKED_OUT/PRESENT — it becomes ABSENT and is only resolved via an approved missed
  // checkout request.
  async flagIfMissedCheckout(attendanceId: string): Promise<void> {
    const attendance = await this.prisma.attendance.findUnique({
      where: { id: attendanceId },
      select: { id: true, userId: true, checkInTime: true, status: true },
    });
    if (!attendance || attendance.status !== AttendanceStatus.CHECKED_IN) return;

    const deadline = await this.getMissedCheckoutDeadline(
      attendance.userId,
      attendance.checkInTime,
    );
    if (new Date() >= deadline) {
      await this.markMissedCheckout(attendance.id, attendance.userId);
    }
  }

  // Missed Checkout Detection job — scans every currently-open (CHECKED_IN) attendance row
  // across all users and marks each one past its own shift-end deadline. Runs on a schedule
  // (AttendanceCronService) in addition to the lazy per-request check above, so a missed
  // checkout is caught even if the worker/manager never triggers another attendance call that
  // day. Returns how many rows were marked, for logging.
  async runMissedCheckoutDetection(): Promise<number> {
    const openRows = await this.prisma.attendance.findMany({
      where: { status: AttendanceStatus.CHECKED_IN },
      select: { id: true, userId: true, checkInTime: true },
    });

    let affected = 0;
    for (const row of openRows) {
      const deadline = await this.getMissedCheckoutDeadline(row.userId, row.checkInTime);
      if (new Date() >= deadline) {
        await this.markMissedCheckout(row.id, row.userId);
        affected++;
      }
    }
    return affected;
  }

  // Single source of truth for "an open check-in is now a missed checkout": status becomes
  // ABSENT (never PRESENT — this is the fix for the previous, incorrect "still becomes
  // Present" behavior), missedCheckout is flagged, the day is counted as an unpaid absence
  // until/unless a later approval resolves it, and a MissedCheckoutRequest is created
  // immediately (PENDING, reason/evidence still empty) — the worker's only remaining action
  // is to fill those in via POST workers/me/missed-checkout/:attendanceId, not to raise the
  // request itself.
  private async markMissedCheckout(attendanceId: string, userId: string): Promise<void> {
    const [user, rule] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { role: true, workerProfile: { select: { areaId: true } } },
      }),
      this.prisma.attendanceRule.findUnique({
        where: { id: 'singleton' },
        select: { requireAdminAttendanceApproval: true },
      }),
    ]);

    // A manager's own missed checkout can't be self-approved — it always goes straight to
    // ADMIN, regardless of the org's requireAdminAttendanceApproval setting.
    const isManagerSelf = user?.role === Role.MANAGER;
    const managerId = isManagerSelf
      ? null
      : await this.resolveManagerUserId(user?.workerProfile?.areaId ?? null);

    await this.prisma.$transaction([
      this.prisma.attendance.update({
        where: { id: attendanceId },
        data: { status: AttendanceStatus.ABSENT, missedCheckout: true },
      }),
      this.prisma.missedCheckoutRequest.create({
        data: {
          attendanceId,
          requestedById: userId,
          managerId,
          adminApprovalRequired: isManagerSelf || Boolean(rule?.requireAdminAttendanceApproval),
          currentLevel: isManagerSelf
            ? MissedCheckoutApprovalLevel.ADMIN
            : MissedCheckoutApprovalLevel.MANAGER,
          status: MissedCheckoutRequestStatus.PENDING,
        },
      }),
    ]);
    await this.leavePolicyService.recordUnpaidAbsence(userId, 1);
  }

  // Same "worker's manager" resolution WorkerService.getReportingManager uses — first
  // ManagerArea match for the worker's assigned area.
  private async resolveManagerUserId(areaId: string | null): Promise<string | null> {
    if (!areaId) return null;
    const managerArea = await this.prisma.managerArea.findFirst({
      where: { areaId },
      select: { manager: { select: { userId: true } } },
    });
    return managerArea?.manager.userId ?? null;
  }

  // Reused by MissedCheckoutService on approval — PRESENT / HALF_DAY / ABSENT from hours worked,
  // against the user's own shift thresholds (falling back to AttendanceRule.minimumWorkingHours
  // as the full-day threshold, halved for half-day, when no shift is assigned).
  async resolveAttendanceOutcome(
    userId: string,
    hoursWorked: number,
  ): Promise<AttendanceStatus> {
    const shift = await this.resolveUserShift(userId);
    let fullDayHours = shift?.fullDayHours ?? null;
    let halfDayHours = shift?.halfDayHours ?? null;

    if (fullDayHours === null || halfDayHours === null) {
      const rule = await this.prisma.attendanceRule.findUnique({
        where: { id: 'singleton' },
        select: { minimumWorkingHours: true },
      });
      fullDayHours = rule?.minimumWorkingHours ?? 8;
      halfDayHours = fullDayHours / 2;
    }

    if (hoursWorked >= fullDayHours) return AttendanceStatus.PRESENT;
    if (hoursWorked >= halfDayHours) return AttendanceStatus.HALF_DAY;
    return AttendanceStatus.ABSENT;
  }

  // Worker or manager — whichever profile the user actually has. Returns null when no shift
  // is assigned, so callers fall back to their existing default behavior.
  async resolveUserShift(userId: string) {
    const [workerProfile, managerProfile] = await Promise.all([
      this.prisma.workerProfile.findUnique({
        where: { userId },
        select: { shiftRef: true },
      }),
      this.prisma.managerProfile.findUnique({
        where: { userId },
        select: { shiftRef: true },
      }),
    ]);
    return workerProfile?.shiftRef ?? managerProfile?.shiftRef ?? null;
  }

  // workingDays (from the user's own assigned Shift) narrows which weekdays count — when
  // omitted/null, keeps the original "every day except Sunday" default for backward
  // compatibility with any caller that doesn't pass it.
  private countWorkingDays(
    start: Date,
    end: Date,
    workingDays?: number[] | null,
  ): number {
    let count = 0;
    const d = new Date(start);
    while (d < end) {
      const day = d.getDay();
      const isWorkingDay = workingDays ? workingDays.includes(day) : day !== 0;
      if (isWorkingDay) count++;
      d.setDate(d.getDate() + 1);
    }
    return count;
  }

  private haversineDistance(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number,
  ): number {
    const R = 6_371_000;
    const toRad = (deg: number) => (deg * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  // Manager-only check-in guard: the office must be one of the manager's own assigned
  // offices, its area must be one of the manager's own assigned areas, and — if a shift is
  // assigned — check-in must fall on a working day within the shift window (+ grace at the
  // start). Each check is skipped (not blocked) when the manager has no such assignment yet,
  // so an incompletely-configured profile never locks a manager out entirely. Implemented as
  // direct Prisma queries rather than calling ManagerService — AttendanceModule can't depend
  // on ManagerModule (ManagerModule already depends on AttendanceModule; the reverse import
  // would be circular).
  private async validateManagerCheckInAssignment(
    userId: string,
    officeLocationId: string,
    officeAreaId: string | null,
    checkInTime: Date,
  ): Promise<void> {
    const profile = await this.prisma.managerProfile.findUnique({
      where: { userId },
      select: {
        officeLocationId: true,
        officeLocations: { select: { officeLocationId: true } },
        areas: { select: { areaId: true } },
        shiftRef: true,
      },
    });
    if (!profile) throw new ForbiddenException('Manager profile not found');

    const officeIds =
      profile.officeLocations.length > 0
        ? profile.officeLocations.map((o) => o.officeLocationId)
        : profile.officeLocationId
          ? [profile.officeLocationId]
          : [];
    if (officeIds.length > 0 && !officeIds.includes(officeLocationId)) {
      throw new ForbiddenException(
        'You can only check in at your own assigned office location',
      );
    }

    const areaIds = profile.areas.map((a) => a.areaId);
    if (areaIds.length > 0 && officeAreaId && !areaIds.includes(officeAreaId)) {
      throw new ForbiddenException(
        'You can only check in within your own assigned area',
      );
    }

    const shift = profile.shiftRef;
    if (shift) {
      const dayOfWeek = checkInTime.getDay(); // 0 = Sunday .. 6 = Saturday
      if (
        shift.workingDays.length > 0 &&
        !shift.workingDays.includes(dayOfWeek)
      ) {
        throw new BadRequestException(
          'Today is not a working day for your assigned shift',
        );
      }

      const minutesSinceMidnight =
        checkInTime.getHours() * 60 + checkInTime.getMinutes();
      const [startH, startM] = shift.startTime.split(':').map(Number);
      const [endH, endM] = shift.endTime.split(':').map(Number);
      const windowStart = startH * 60 + startM - shift.graceMinutes;
      const windowEnd = endH * 60 + endM;
      if (
        minutesSinceMidnight < windowStart ||
        minutesSinceMidnight > windowEnd
      ) {
        throw new BadRequestException(
          'Check-in is outside your assigned shift hours',
        );
      }
    }
  }
}
