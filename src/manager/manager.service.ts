import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ActivityAction,
  ActivityModule,
  AttendanceStatus,
  BookingStatus,
  CommissionType,
  LeaveRequestStatus,
  PaymentMethod,
  PaymentStatus,
  Prisma,
  Role,
  SalaryType,
  TaskStatus,
  TicketStatus,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';

import { ActivityLogService } from '../activity-log/activity-log.service';
import { AdminService } from '../admin/admin.service';
import { QueryLiveWorkersDto } from '../admin/dto/query-live-workers.dto';
import { AreasService } from '../areas/areas.service';
import { AttendanceService } from '../attendance/attendance.service';
import { AttendanceHistoryQueryDto } from '../attendance/dto/attendance-query.dto';
import { BookingsService } from '../booking/bookings/bookings.service';
import { AssignWorkerDto } from '../booking/bookings/dto/assign-worker.dto';
import { CancelBookingDto } from '../booking/bookings/dto/cancel-booking.dto';
import {
  addDaysToDateString,
  getTodayRange,
  toDateOnlyString,
  resolveReportDateRange,
} from '../common/utils/date.util';
import { resolveImageUrl } from '../common/utils/url.util';
import { deriveTodayAttendanceStatus } from '../common/utils/attendance-status.util';
import { AuthUser } from '../common/types/auth-user.type';
import { DuplicateCheckService } from '../common/services/duplicate-check.service';
import { DashboardService } from '../dashboard/dashboard.service';
import { LeavePolicyService } from '../leave-policy/leave-policy.service';
import { LEAVE_TYPE_META } from '../leave-request/leave-request.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { ReportsService } from '../reports/reports.service';
import { BookingReportQueryDto } from '../reports/dto/booking-report-query.dto';
import { WorkerReportQueryDto } from '../reports/dto/worker-report-query.dto';
import { SupportService } from '../support/support.service';
import { TasksService } from '../tasks/tasks.service';
import { AssignTaskDto } from './dto/assign-task.dto';
import { CreateManagerWorkerDto } from './dto/create-manager-worker.dto';
import { ManagerAttendanceReportQueryDto } from './dto/manager-attendance-report-query.dto';
import { UpdateManagerWorkerDto } from './dto/update-manager-worker.dto';
import { WorkerBankDetailsDto } from './dto/worker-bank-details.dto';
import { WorkerCommissionInputDto } from './dto/worker-commission-input.dto';
import { ManagerWorkerListQueryDto } from './dto/worker-list-query.dto';
import { ManagerJobQueryDto } from './dto/manager-job-query.dto';
import { ManagerLiveTrackingQueryDto } from './dto/manager-live-tracking-query.dto';

@Injectable()
export class ManagerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dashboardService: DashboardService,
    private readonly attendanceService: AttendanceService,
    private readonly supportService: SupportService,
    private readonly notificationsService: NotificationsService,
    private readonly activityLogService: ActivityLogService,
    private readonly adminService: AdminService,
    private readonly reportsService: ReportsService,
    private readonly tasksService: TasksService,
    private readonly areasService: AreasService,
    private readonly duplicateCheck: DuplicateCheckService,
    private readonly configService: ConfigService,
    private readonly bookingsService: BookingsService,
    private readonly leavePolicyService: LeavePolicyService,
  ) {}

  async getDashboard(user: AuthUser) {
    const { start, end } = getTodayRange();

    const [
      managerDashboard,
      notifResult,
      recentActivitiesResult,
      todaysJobs,
      revenueAgg,
      workerFilter,
      attendanceResult,
      leaveBalanceResult,
    ] = await Promise.all([
      this.dashboardService.getManagerDashboard(user.id),
      this.notificationsService.getMyNotifications(user.id, {
        page: 1,
        limit: 1,
      }),
      this.activityLogService.getRecentActivities(10),
      this.prisma.task.count({
        where: { assignedManagerId: user.id, dueDate: { gte: start, lt: end } },
      }),
      this.prisma.booking.aggregate({
        where: {
          managerId: user.id,
          status: BookingStatus.COMPLETED,
          completedAt: { gte: start, lt: end },
        },
        _sum: { totalAmount: true },
      }),
      this.resolveWorkerFilter(user.id),
      // Reuses getAttendance wholesale — its own office/area/shift resolution and live
      // workingDuration calculation are not re-derived here.
      this.getAttendance(user),
      this.leavePolicyService.getBalance(user.id),
    ]);

    const totalWorkers = await this.prisma.user.count({
      where: { role: Role.WORKER, workerProfile: workerFilter },
    });

    const activeWorkers = managerDashboard.data.assignedWorkers;
    const presentToday = managerDashboard.data.workersCheckedInToday;
    const absentToday = Math.max(0, activeWorkers - presentToday);

    return {
      success: true,
      data: {
        totalWorkers,
        activeWorkers,
        presentToday,
        absentToday,
        pendingJobs: managerDashboard.data.tasks.active,
        completedJobs: managerDashboard.data.tasks.completed,
        todaysJobs,
        revenueToday: revenueAgg._sum.totalAmount ?? 0,
        recentActivities: recentActivitiesResult.data,
        unreadNotifications: notifResult.data.unreadCount,
        // Additive — the logged-in manager's own attendance summary for the Home screen.
        // isCheckedIn/attendanceStatus/currentAttendanceId are forwarded as-is from
        // getAttendance() (single source of truth: today's Attendance row, re-derived fresh
        // on every call, never cached) — see the derivation there for why isCheckedIn is based
        // on checkOutTime being null rather than the raw status column.
        isCheckedIn: attendanceResult.data.isCheckedIn,
        attendanceStatus: attendanceResult.data.attendanceStatus,
        currentAttendanceId: attendanceResult.data.currentAttendanceId,
        checkInTime: attendanceResult.data.checkInTime,
        checkOutTime: attendanceResult.data.checkOutTime,
        workingDuration: attendanceResult.data.workingDuration,
        currentShift: attendanceResult.data.currentShift,
        office: attendanceResult.data.office,
        area: attendanceResult.data.area,
        // Additive — forwarded from the same getAttendance() call above (no extra query) so
        // the dashboard alone can also satisfy Monthly Summary / Attendance History needs.
        monthlySummary: attendanceResult.data.monthlySummary,
        // Same value as monthlySummary, under the name this dashboard's contract requires.
        attendanceSummary: attendanceResult.data.monthlySummary,
        history: attendanceResult.data.history,
        historyMeta: attendanceResult.data.historyMeta,
        // Backend-computed Available/Used/Remaining per leave type + Leave Without Pay Used —
        // the UI must never derive these itself.
        leaveBalance: leaveBalanceResult.data,
      },
    };
  }

  async getAttendance(user: AuthUser) {
    // Reuses the same office/area resolution as GET managers/me/areas (getOwnOfficeAndAreas)
    // rather than re-deriving it — only the shift needs a new, dedicated lookup (no existing
    // method resolves "my own assigned shift"). monthlySummary/history reuse
    // AttendanceService.getMonthlySummary/getHistory wholesale (current month, 10 most recent
    // records) so the frontend never needs a separate GET attendance/me/summary or
    // attendance/me/history call to render the Manager attendance screen.
    const [
      result,
      areasResult,
      shiftProfile,
      monthlySummaryResult,
      historyResult,
    ] = await Promise.all([
      this.attendanceService.getTodayAttendance(user.id),
      this.getOwnOfficeAndAreas(user),
      this.prisma.managerProfile.findUnique({
        where: { userId: user.id },
        select: { shiftRef: true },
      }),
      this.attendanceService.getMonthlySummary(user.id, {}),
      this.attendanceService.getHistory(user.id, { limit: 10 }),
    ]);
    const record = result.data;
    const now = new Date();

    const workingHours =
      record?.checkInTime && record?.checkOutTime
        ? parseFloat(
            (
              (record.checkOutTime.getTime() - record.checkInTime.getTime()) /
              3_600_000
            ).toFixed(2),
          )
        : null;

    // Live elapsed time — uses checkOutTime once available, else "now" — this is what powers
    // a running Manager Timer view while still checked in (workingHours above stays null
    // until checkout, by design, for existing consumers).
    const workingDuration = record?.checkInTime
      ? Math.floor(
          ((record.checkOutTime ?? now).getTime() -
            record.checkInTime.getTime()) /
            1000,
        )
      : null;

    // Single source of truth: today's Attendance row, re-queried fresh on every call (no
    // cache). isCheckedIn is exactly "status is still CHECKED_IN" — a missed checkout now
    // settles to ABSENT (checkOutTime stays null, but the session is closed/terminal, not
    // still open), so checkOutTime-is-null is no longer a safe proxy for "checked in".
    const isCheckedIn = record !== null && record.status === AttendanceStatus.CHECKED_IN;
    const attendanceStatus = !record
      ? 'NOT_CHECKED_IN'
      : isCheckedIn
        ? 'CHECKED_IN'
        : record.status;

    return {
      success: true,
      data: {
        checkIn: record?.checkInTime ?? null,
        checkOut: record?.checkOutTime ?? null,
        workingHours,
        attendanceStatus,
        // Additive — Manager Home / Manager Timer fields.
        isCheckedIn,
        currentAttendanceId: record?.id ?? null,
        checkInTime: record?.checkInTime ?? null,
        checkOutTime: record?.checkOutTime ?? null,
        workingDuration,
        currentShift: shiftProfile?.shiftRef ?? null,
        office: areasResult.data.officeLocation,
        area: areasResult.data.assignedAreas[0] ?? null,
        // Additive — current-calendar-month summary (same shape as GET attendance/me/summary)
        // so the Manager attendance screen never needs a second request for it.
        monthlySummary: monthlySummaryResult.data,
        // Additive — 10 most recent records (same shape as GET attendance/me/history's
        // `attendances` array) so the Manager attendance screen never needs a second request.
        history: historyResult.data.attendances,
        historyMeta: historyResult.data.meta,
      },
    };
  }

  // Manager-panel counterpart of WorkerService.getLeaveCalendar — same output shape
  // ({ joiningDate, attendance[], leaves[] }), built from the same WorkerLeaveRequest table
  // (a manager's own leave request row also lives there, workerId = the manager's own userId,
  // see applyManagerLeave) and the same generic AttendanceService.getHistory this manager's own
  // GET managers/me/attendance already reuses — no new attendance query logic invented.
  async getLeaveCalendar(user: AuthUser, days: number) {
    const since = new Date();
    since.setDate(since.getDate() - days);

    const [managerProfile, historyResult, leaves] = await Promise.all([
      this.prisma.managerProfile.findUnique({
        where: { userId: user.id },
        // shiftRef is additive here purely so the calendar UI can compute
        // "Weekly Off" (a day outside Shift.workingDays) the same way the
        // worker calendar now does — no other behavior changes.
        select: { joiningDate: true, shiftRef: { select: { id: true, name: true, startTime: true, endTime: true, workingDays: true } } },
      }),
      this.attendanceService.getHistory(user.id, {
        startDate: toDateOnlyString(since) ?? undefined,
        limit: days + 5,
      }),
      this.prisma.workerLeaveRequest.findMany({
        where: { workerId: user.id },
        orderBy: { date: 'desc' },
      }),
    ]);

    const attendanceByDate = new Map<string, 'PRESENT' | 'ABSENT' | 'LEAVE'>();
    for (const row of historyResult.data.attendances) {
      const key = toDateOnlyString(row.checkInTime)!;
      attendanceByDate.set(key, row.status === AttendanceStatus.ABSENT ? 'ABSENT' : 'PRESENT');
    }
    // Approved-leave dates fill in LEAVE for any day with no attendance row at all — same rule
    // as the worker calendar (an actual Attendance row always wins if one exists).
    for (const l of leaves) {
      if (l.status !== LeaveRequestStatus.APPROVED) continue;
      const key = toDateOnlyString(l.date)!;
      if (!attendanceByDate.has(key)) attendanceByDate.set(key, 'LEAVE');
    }

    // Same explicit gap-fill rule as WorkerService.getLeaveCalendar: an
    // Attendance row is only ever created at check-in time, so a day with no
    // row and no approved leave is a genuine no-show — ABSENT. Bounded by
    // joiningDate (never touches a day before it) and stops at yesterday
    // (today is still in progress).
    const joiningStr = toDateOnlyString(managerProfile?.joiningDate ?? null);
    const windowStart = toDateOnlyString(since)!;
    const today = toDateOnlyString(new Date())!;
    const yesterday = addDaysToDateString(today, -1);
    let cursor = joiningStr && joiningStr > windowStart ? joiningStr : windowStart;
    while (cursor <= yesterday) {
      if (!attendanceByDate.has(cursor)) attendanceByDate.set(cursor, 'ABSENT');
      cursor = addDaysToDateString(cursor, 1);
    }

    return {
      success: true,
      data: {
        joiningDate: toDateOnlyString(managerProfile?.joiningDate ?? null),
        attendance: Array.from(attendanceByDate.entries())
          .map(([date, status]) => ({ date, status }))
          .sort((a, b) => b.date.localeCompare(a.date)),
        leaves: leaves.map((l) => ({
          startDate: toDateOnlyString(l.date)!,
          endDate: toDateOnlyString(l.date)!,
          leaveType: l.type,
          leaveTypeCode: LEAVE_TYPE_META[l.type].code,
          leaveTypeName: LEAVE_TYPE_META[l.type].name,
          status: l.status,
        })),
        shift: managerProfile?.shiftRef
          ? {
              id: managerProfile.shiftRef.id,
              name: managerProfile.shiftRef.name,
              startTime: managerProfile.shiftRef.startTime,
              endTime: managerProfile.shiftRef.endTime,
              workingDays: managerProfile.shiftRef.workingDays,
            }
          : null,
      },
    };
  }

  // officeLocationIds is optional and purely additive: when provided, this reuses
  // getAreasByOffice (same security-scoped logic as GET managers/areas) and returns its array
  // shape; when omitted, existing callers (e.g. Manager Home) keep getting the original
  // { officeLocation, assignedAreas } shape unchanged — fully backward compatible.
  async getAreas(user: AuthUser, officeLocationIds?: string[]) {
    if (officeLocationIds && officeLocationIds.length > 0) {
      return this.getAreasByOffice(user, officeLocationIds);
    }
    return this.getOwnOfficeAndAreas(user);
  }

  // Extracted from getAreas' default branch so getAttendance (Manager Home / Manager Timer)
  // can call it directly with a precise, non-union return type — same query, no duplicated
  // logic.
  private async getOwnOfficeAndAreas(user: AuthUser) {
    const profile = await this.prisma.managerProfile.findUnique({
      where: { userId: user.id },
      select: {
        officeLocation: {
          select: {
            id: true,
            name: true,
            address: true,
            latitude: true,
            longitude: true,
            radius: true,
          },
        },
        areas: {
          select: {
            area: {
              select: {
                id: true,
                name: true,
                pincode: true,
                city: true,
                district: true,
                state: true,
              },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!profile) throw new NotFoundException('Manager profile not found');

    return {
      success: true,
      data: {
        officeLocation: profile.officeLocation ?? null,
        assignedAreas: profile.areas.map((a) => a.area),
      },
    };
  }

  async getSupport(user: AuthUser, orgId?: string) {
    const [openResult, resolvedResult, recentResult] = await Promise.all([
      this.supportService.findAll(
        { status: TicketStatus.OPEN, page: 1, limit: 1 },
        user,
        orgId,
      ),
      this.supportService.findAll(
        { status: TicketStatus.RESOLVED, page: 1, limit: 1 },
        user,
        orgId,
      ),
      this.supportService.findAll({ page: 1, limit: 5 }, user, orgId),
    ]);

    return {
      success: true,
      data: {
        openTickets: openResult.data.meta.total,
        resolvedTickets: resolvedResult.data.meta.total,
        recentTickets: recentResult.data.tickets,
      },
    };
  }

  async getLiveWorkers(user: AuthUser, query: QueryLiveWorkersDto) {
    // managerId is always forced to the JWT-resolved manager — a caller-supplied
    // managerId (if any) is discarded so a manager can never query another manager's team.
    return this.adminService.getLiveWorkers({ ...query, managerId: user.id });
  }

  async getLiveTracking(user: AuthUser, query: ManagerLiveTrackingQueryDto) {
    // Reuses AdminService.getLiveTracking wholesale — role is always forced to WORKER (a
    // manager tracks their own team's workers, never other managers) and managerId is always
    // the JWT-resolved manager, mirroring the same pattern as getLiveWorkers above.
    return this.adminService.getLiveTracking({
      role: 'WORKER',
      status: query.status,
      managerId: user.id,
      page: query.page,
      limit: query.limit,
    });
  }

  // Returns ALL offices directly assigned to this manager (ManagerOfficeLocation join, with
  // the legacy single officeLocationId as fallback) — not offices derived indirectly from
  // area assignments, which is what this previously (incorrectly) computed.
  async getOfficeLocations(user: AuthUser) {
    const officeIds = await this.getManagerOfficeIds(user.id);
    if (officeIds.length === 0) return { success: true, data: [] };

    const offices = await this.prisma.officeLocation.findMany({
      where: { id: { in: officeIds } },
      select: { id: true, name: true, address: true },
      orderBy: { name: 'asc' },
    });

    return { success: true, data: offices };
  }

  // Reuses AdminService.getShifts (the real, admin-managed Shift table) rather than
  // duplicating the query. Active shifts only — AdminService.getShifts already returns
  // a plain array (only the two permanent shifts, Shift A / Shift B, typically exist).
  async getShifts() {
    const result = await this.adminService.getShifts({
      isActive: true,
      page: 1,
      limit: 100,
    });
    return { success: true, data: result.data };
  }

  // Areas filtered by office, scoped to the logged-in manager's own offices. A
  // caller-supplied officeLocationIds list is intersected with the manager's own assigned
  // offices — any id that isn't actually theirs is silently dropped, never trusted as-is.
  // Omitting officeLocationIds returns the union of areas across all of the manager's offices.
  async getAreasByOffice(user: AuthUser, requestedOfficeIds?: string[]) {
    const ownOfficeIds = await this.getManagerOfficeIds(user.id);

    const officeLocationIds =
      requestedOfficeIds && requestedOfficeIds.length > 0
        ? requestedOfficeIds.filter((oid) => ownOfficeIds.includes(oid))
        : ownOfficeIds;

    if (officeLocationIds.length === 0) {
      return { success: true, data: [] };
    }

    const result = await this.areasService.findAll({
      officeLocationIds,
      isActive: true,
      page: 1,
      limit: 500,
    });

    const officeIdSet = new Set(officeLocationIds);
    const data = result.data.areas.map((area) => {
      const matchedOffice =
        area.officeLocations.find((o) => officeIdSet.has(o.id)) ??
        area.officeLocations[0] ??
        null;
      return {
        id: area.id,
        name: area.name,
        officeLocationId: matchedOffice?.id ?? officeLocationIds[0],
        officeLocationName: matchedOffice?.name ?? null,
      };
    });

    return { success: true, data };
  }

  // Resolves the manager's own assigned office ids — ManagerOfficeLocation join rows if
  // present, falling back to the legacy single ManagerProfile.officeLocationId for managers
  // created before multi-office support existed.
  private async getManagerOfficeIds(managerUserId: string): Promise<string[]> {
    const profile = await this.prisma.managerProfile.findUnique({
      where: { userId: managerUserId },
      select: {
        officeLocationId: true,
        officeLocations: { select: { officeLocationId: true } },
      },
    });
    if (!profile) throw new NotFoundException('Manager profile not found');

    if (profile.officeLocations.length > 0) {
      return [
        ...new Set(profile.officeLocations.map((o) => o.officeLocationId)),
      ];
    }
    return profile.officeLocationId ? [profile.officeLocationId] : [];
  }

  private async getManagerScope(
    managerUserId: string,
  ): Promise<{ areaIds: string[]; pincodeIds: string[] }> {
    const profile = await this.prisma.managerProfile.findUnique({
      where: { userId: managerUserId },
      select: {
        pincodes: { select: { pincodeId: true } },
        areas: { select: { areaId: true } },
      },
    });
    return {
      areaIds: profile?.areas.map((a) => a.areaId) ?? [],
      pincodeIds: profile?.pincodes.map((p) => p.pincodeId) ?? [],
    };
  }

  private async resolveWorkerFilter(
    managerUserId: string,
  ): Promise<Prisma.WorkerProfileWhereInput> {
    const { areaIds, pincodeIds } = await this.getManagerScope(managerUserId);
    return pincodeIds.length > 0
      ? { pincodeId: { in: pincodeIds } }
      : { areaId: { in: areaIds } };
  }

  // Same manager scope as getManagerScope/resolveWorkerFilter, but resolved to the actual
  // pincode STRING values (Address.pincode and Area.pincode are both plain strings — there is
  // no FK between them, they're only ever matched by value, same as the existing Area/Pincode
  // availability feature). Needed to match a Booking's own customer Address against the
  // manager's territory, independent of whether any worker has been assigned yet. Prefers
  // direct ManagerPincode assignments over ManagerArea (same precedence resolveWorkerFilter
  // already uses); returns [] (no filter contribution) when the manager has neither configured.
  private async resolveManagerPincodes(managerUserId: string): Promise<string[]> {
    const profile = await this.prisma.managerProfile.findUnique({
      where: { userId: managerUserId },
      select: {
        // isActive filtered on both sides: an inactive Pincode/Area must not keep matching new
        // jobs to it (existing business rule for area-level open/closed status — see
        // AreasService/BookingConfigService), even if the manager is still nominally assigned
        // to it. Matches the same "isActive" gate the booking-creation-time area check already
        // enforces — this just applies it here too rather than inventing a second mechanism.
        pincodes: { where: { pincode: { isActive: true } }, select: { pincode: { select: { pincode: true } } } },
        areas: { where: { area: { isActive: true } }, select: { area: { select: { pincode: true } } } },
      },
    });
    if (!profile) return [];
    if (profile.pincodes.length > 0) return profile.pincodes.map((p) => p.pincode.pincode);
    return profile.areas.map((a) => a.area.pincode);
  }

  // A job (Booking) belongs to this manager because: it's directly assigned to them
  // (Booking.managerId), it was performed by one of their own workers (reuses
  // resolveWorkerFilter), OR — root cause of "Manager Jobs doesn't show requests raised by
  // users whose pincode belongs to that manager" — the booking's own customer Address.pincode
  // falls within the manager's assigned area/pincode territory. That third branch is what
  // makes brand-new, still-unassigned bookings (managerId null, workerId null, status PENDING)
  // visible to the correct manager the moment they're created, instead of only ever appearing
  // once explicitly assigned to that manager or one of their workers.
  private async resolveManagerBookingScope(
    managerUserId: string,
  ): Promise<Prisma.BookingWhereInput> {
    const [workerFilter, pincodes] = await Promise.all([
      this.resolveWorkerFilter(managerUserId),
      this.resolveManagerPincodes(managerUserId),
    ]);
    return {
      OR: [
        { managerId: managerUserId },
        { worker: { workerProfile: workerFilter } },
        ...(pincodes.length > 0 ? [{ address: { pincode: { in: pincodes } } }] : []),
      ],
    };
  }

  // Confirms `bookingId` falls inside this manager's scope (own booking or own worker's
  // booking) — reuses resolveManagerBookingScope. Throws 404 (not 403) so a manager can't
  // probe for the existence of jobs outside their team.
  private async authorizeManagerBooking(
    managerUserId: string,
    bookingId: string,
  ): Promise<void> {
    const scope = await this.resolveManagerBookingScope(managerUserId);
    const booking = await this.prisma.booking.findFirst({
      where: { id: bookingId, ...scope },
      select: { id: true },
    });
    if (!booking) throw new NotFoundException('Job not found in your team');
  }

  // Confirms `workerId` is a WORKER whose profile falls inside this manager's
  // assigned areas/pincodes. Throws 404 (not 403) so a manager can't probe for
  // the existence of workers outside their team.
  private async authorizeWorker(
    managerUserId: string,
    workerId: string,
  ): Promise<void> {
    const workerFilter = await this.resolveWorkerFilter(managerUserId);
    const worker = await this.prisma.user.findFirst({
      where: { id: workerId, role: Role.WORKER, workerProfile: workerFilter },
      select: { id: true },
    });
    if (!worker) throw new NotFoundException('Worker not found in your team');
  }

  private async getProfileImageMap(
    userIds: string[],
  ): Promise<Map<string, string | null>> {
    if (userIds.length === 0) return new Map();
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: {
        id: true,
        profileImage: true,
        workerProfile: { select: { faceImage: true } },
      },
    });
    const baseUrl = this.configService.get<string>('baseUrl');
    return new Map(
      users.map((u) => [
        u.id,
        resolveImageUrl(u.profileImage ?? u.workerProfile?.faceImage, baseUrl),
      ]),
    );
  }

  // KYC + employment fields, keyed by worker userId, for list endpoints — a single extra
  // query so GET managers/workers can include the new fields without joining them into
  // AdminService.getWorkers/ReportsService.getWorkerReport (which serve other consumers too).
  private async getWorkerEmploymentMap(userIds: string[]): Promise<
    Map<
      string,
      {
        aadhaarNumber: string | null;
        panNumber: string | null;
        employmentType: SalaryType;
        monthlySalary: number | null;
        paymentCycle: string | null;
        joiningDate: Date | null;
        commissions: {
          id: string;
          serviceId: string;
          commissionType: string;
          commissionValue: number;
        }[];
        // List views never expose accountNumber/ifscCode/branchName/upiId/remark — only the
        // full worker detail view (getWorkerDetails) does.
        bankDetails: {
          bankName: string | null;
          accountHolderName: string | null;
        } | null;
      }
    >
  > {
    if (userIds.length === 0) return new Map();
    const profiles = await this.prisma.workerProfile.findMany({
      where: { userId: { in: userIds } },
      select: {
        userId: true,
        aadhaarNumber: true,
        panNumber: true,
        salaryType: true,
        salaryAmount: true,
        paymentCycle: true,
        joiningDate: true,
        bankName: true,
        accountHolderName: true,
        commissions: {
          select: {
            id: true,
            serviceId: true,
            commissionType: true,
            commissionValue: true,
          },
        },
      },
    });
    return new Map(
      profiles.map((p) => [
        p.userId,
        {
          aadhaarNumber: p.aadhaarNumber,
          panNumber: p.panNumber,
          employmentType: p.salaryType,
          monthlySalary: p.salaryAmount,
          paymentCycle: p.paymentCycle,
          joiningDate: p.joiningDate,
          commissions: p.commissions,
          bankDetails:
            p.bankName || p.accountHolderName
              ? { bankName: p.bankName, accountHolderName: p.accountHolderName }
              : null,
        },
      ]),
    );
  }

  // employmentType/monthlySalary/commissions are cross-validated here rather than in the DTO
  // (via @ValidateIf) because on update the "current" employmentType may come from the DB, not
  // the request body — a DTO-level gate would either skip structural validation of an unrelated
  // field or wrongly demand fields on unrelated partial updates.
  private validateEmploymentDetails(
    employmentType: SalaryType,
    monthlySalary: number | undefined,
    commissions: WorkerCommissionInputDto[] | undefined,
  ): void {
    if (employmentType === SalaryType.SALARY && monthlySalary === undefined) {
      throw new BadRequestException(
        'monthlySalary is required when employmentType is SALARY',
      );
    }
    if (
      employmentType === SalaryType.COMMISSION &&
      (!commissions || commissions.length === 0)
    ) {
      throw new BadRequestException(
        'At least one commission record is required when employmentType is COMMISSION',
      );
    }
  }

  private async validateCommissionServices(
    commissions: WorkerCommissionInputDto[],
  ): Promise<void> {
    const ids = [...new Set(commissions.map((c) => c.serviceId))];
    const found = await this.prisma.service.findMany({
      where: { id: { in: ids } },
      select: { id: true },
    });
    const foundIds = new Set(found.map((s) => s.id));
    const missing = ids.filter((id) => !foundIds.has(id));
    if (missing.length > 0) {
      throw new BadRequestException(
        `Service(s) not found: ${missing.join(', ')}`,
      );
    }
  }

  // areaIds is the current field name; assignedAreaIds is deprecated but still accepted for
  // backward compatibility. areaIds wins if both are sent.
  private resolveAreaIds(dto: {
    areaIds?: string[];
    assignedAreaIds?: string[];
  }): string[] {
    const ids = dto.areaIds ?? dto.assignedAreaIds;
    if (!ids || ids.length === 0) {
      throw new BadRequestException('At least one area is required (areaIds)');
    }
    return ids;
  }

  // Merges the nested bankDetails object with the deprecated flat accountHolderName/bankName/
  // accountNumber/ifscCode/branchName/upiId fields — bankDetails wins when both are sent.
  private resolveWorkerBankDetails(dto: {
    bankDetails?: WorkerBankDetailsDto;
    accountHolderName?: string;
    bankName?: string;
    accountNumber?: string;
    ifscCode?: string;
    branchName?: string;
    upiId?: string;
  }): {
    accountHolderName: string | undefined;
    bankName: string | undefined;
    accountNumber: string | undefined;
    ifscCode: string | undefined;
    branchName: string | undefined;
    upiId: string | undefined;
  } {
    return {
      accountHolderName:
        dto.bankDetails?.accountHolderName ?? dto.accountHolderName,
      bankName: dto.bankDetails?.bankName ?? dto.bankName,
      accountNumber: dto.bankDetails?.accountNumber ?? dto.accountNumber,
      ifscCode: dto.bankDetails?.ifscCode ?? dto.ifscCode,
      branchName: dto.bankDetails?.branchName ?? dto.branchName,
      upiId: dto.bankDetails?.upiId ?? dto.upiId,
    };
  }

  // Every requested office must actually belong to this manager — reject, don't silently drop,
  // since this would otherwise let a manager plant/move a worker into someone else's office.
  private validateOwnOffices(
    ownOfficeIds: string[],
    requestedOfficeIds: string[],
  ): void {
    const invalidOffices = requestedOfficeIds.filter(
      (oid) => !ownOfficeIds.includes(oid),
    );
    if (invalidOffices.length > 0) {
      throw new BadRequestException(
        `Office location(s) do not belong to you: ${invalidOffices.join(', ')}`,
      );
    }
  }

  // Every requested area must belong to at least one of the given offices — reuse
  // AreasService.findAll's existing office-filter query rather than re-implementing it.
  private async validateOfficeAreaMapping(
    officeLocationIds: string[],
    areaIds: string[],
  ): Promise<void> {
    const officeAreasResult = await this.areasService.findAll({
      officeLocationIds,
      isActive: true,
      page: 1,
      limit: 500,
    });
    const validAreaIds = new Set(officeAreasResult.data.areas.map((a) => a.id));
    const invalidAreas = areaIds.filter((aid) => !validAreaIds.has(aid));
    if (invalidAreas.length > 0) {
      throw new BadRequestException(
        `Area(s) do not belong to the selected offices: ${invalidAreas.join(', ')}`,
      );
    }
  }

  // Office info is derived from the worker's assigned area's own office links (existing
  // Area.officeLocations relation) rather than stored directly on WorkerProfile — reused by
  // both createWorker and updateWorker so their responses stay identically shaped.
  private async deriveAreaOfficeInfo(areaId: string | null): Promise<{
    officeLocations: { id: string; name: string; address: string | null }[];
    assignedAreas: {
      id: string;
      name: string;
      pincode: string;
      city: string;
      state: string;
    }[];
  }> {
    if (!areaId) return { officeLocations: [], assignedAreas: [] };
    const areaWithOffices = await this.prisma.area.findUnique({
      where: { id: areaId },
      select: {
        id: true,
        name: true,
        pincode: true,
        city: true,
        state: true,
        officeLocations: { select: { id: true, name: true, address: true } },
      },
    });
    return {
      officeLocations: areaWithOffices?.officeLocations ?? [],
      assignedAreas: areaWithOffices
        ? [
            {
              id: areaWithOffices.id,
              name: areaWithOffices.name,
              pincode: areaWithOffices.pincode,
              city: areaWithOffices.city,
              state: areaWithOffices.state,
            },
          ]
        : [],
    };
  }

  // ─── Workers tab ────────────────────────────────────────────────────────────

  async createWorker(user: AuthUser, dto: CreateManagerWorkerDto) {
    // Every requested office must actually belong to this manager — reject, don't silently
    // drop, since this is a write that would otherwise let a manager plant a worker in
    // someone else's office.
    const ownOfficeIds = await this.getManagerOfficeIds(user.id);
    this.validateOwnOffices(ownOfficeIds, dto.officeLocationIds);

    const areaIds = this.resolveAreaIds(dto);
    await this.validateOfficeAreaMapping(dto.officeLocationIds, areaIds);

    // Reuses AdminService's existence/active check rather than duplicating it here.
    await this.adminService.validateShiftId(dto.shiftId);

    const employmentType = dto.employmentType ?? SalaryType.SALARY;
    const commissionRules = dto.commissionRules ?? dto.commissions;
    const joiningDate = dto.salaryStartDate ?? dto.joiningDate;
    const remark = dto.remarks ?? dto.remark;
    const bank = this.resolveWorkerBankDetails(dto);

    this.validateEmploymentDetails(
      employmentType,
      dto.monthlySalary,
      commissionRules,
    );
    if (commissionRules && commissionRules.length > 0) {
      await this.validateCommissionServices(commissionRules);
    }

    const email = dto.email.toLowerCase().trim();
    await this.duplicateCheck.ensureUnique({
      email,
      phone: dto.phone,
      aadhaarNumber: dto.aadhaarNumber,
      panNumber: dto.panNumber,
    });

    // WorkerProfile.areaId is a single scalar — no ManagerArea-style join table exists for
    // workers — so only the first requested area is actually persisted. The rest were still
    // validated above.
    const primaryAreaId = areaIds[0];

    // Needed to link ManagerArea below — office-based validation above doesn't guarantee the
    // manager already has an explicit ManagerArea row for this area (team-scope authorization
    // on every other Manager Worker endpoint — getWorkerDetails, assignWorkerToTask, etc. —
    // is resolved via ManagerArea, not ManagerOfficeLocation).
    const managerProfileRow = await this.prisma.managerProfile.findUnique({
      where: { userId: user.id },
      select: { id: true },
    });
    if (!managerProfileRow)
      throw new NotFoundException('Manager profile not found');

    const hashedPassword = await bcrypt.hash(dto.password, 10);
    const employeeCode = `WRK-${randomBytes(3).toString('hex').toUpperCase()}`;

    const { createdUser, workerProfile } = await this.prisma.$transaction(
      async (tx) => {
        const created = await tx.user.create({
          data: {
            name: dto.name,
            email,
            phone: dto.phone,
            password: hashedPassword,
            role: Role.WORKER,
            profileImage: dto.profileImage ?? null,
            isActive: true,
          },
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            role: true,
            profileImage: true,
            isActive: true,
            createdAt: true,
          },
        });

        const profile = await tx.workerProfile.create({
          data: {
            userId: created.id,
            employeeCode,
            areaId: primaryAreaId,
            shiftId: dto.shiftId,
            gender: dto.gender,
            dateOfBirth: dto.dateOfBirth
              ? new Date(dto.dateOfBirth)
              : undefined,
            address: dto.address,
            aadhaarNumber: dto.aadhaarNumber,
            aadhaarFrontImage: dto.aadhaarFrontImage,
            aadhaarBackImage: dto.aadhaarBackImage,
            panNumber: dto.panNumber,
            panImage: dto.panImage,
            salaryType: employmentType,
            salaryAmount: dto.monthlySalary,
            paymentCycle: dto.paymentCycle,
            joiningDate: joiningDate ? new Date(joiningDate) : undefined,
            accountHolderName: bank.accountHolderName,
            bankName: bank.bankName,
            accountNumber: bank.accountNumber,
            ifscCode: bank.ifscCode,
            branchName: bank.branchName,
            upiId: bank.upiId,
            remark,
          },
          select: {
            id: true,
            employeeCode: true,
            areaId: true,
            shiftId: true,
            shiftRef: true,
            gender: true,
            dateOfBirth: true,
            address: true,
            aadhaarNumber: true,
            aadhaarFrontImage: true,
            aadhaarBackImage: true,
            panNumber: true,
            panImage: true,
            salaryType: true,
            salaryAmount: true,
            paymentCycle: true,
            joiningDate: true,
            accountHolderName: true,
            bankName: true,
            accountNumber: true,
            ifscCode: true,
            branchName: true,
            upiId: true,
            remark: true,
          },
        });

        if (commissionRules && commissionRules.length > 0) {
          await tx.workerCommission.createMany({
            data: commissionRules.map((c) => ({
              workerId: profile.id,
              serviceId: c.serviceId,
              commissionType: c.commissionType,
              commissionValue: c.commissionValue,
            })),
          });
        }

        // Ensures this manager can immediately see/manage the worker via every other Manager
        // Worker endpoint (all authorize via ManagerArea) — no-op if the link already exists.
        await tx.managerArea.upsert({
          where: {
            managerId_areaId: {
              managerId: managerProfileRow.id,
              areaId: primaryAreaId,
            },
          },
          create: { managerId: managerProfileRow.id, areaId: primaryAreaId },
          update: {},
        });

        return { createdUser: created, workerProfile: profile };
      },
    );

    const commissions = commissionRules?.length
      ? await this.prisma.workerCommission.findMany({
          where: { workerId: workerProfile.id },
          select: {
            id: true,
            serviceId: true,
            commissionType: true,
            commissionValue: true,
            service: { select: { id: true, name: true } },
          },
        })
      : [];

    this.activityLogService.log({
      action: ActivityAction.WORKER_CREATED,
      module: ActivityModule.WORKER,
      description: `Worker ${createdUser.name} created by manager ${user.name}`,
      actor: { id: user.id, name: user.name, role: user.role },
      target: { id: createdUser.id, type: 'User' },
      metadata: {
        employeeCode,
        officeLocationIds: dto.officeLocationIds,
        areaIds,
        primaryAreaId,
        shiftId: dto.shiftId,
      },
    });

    // Keeps the create response consistent with what getWorkerDetails/updateWorker return.
    const { officeLocations, assignedAreas } =
      await this.deriveAreaOfficeInfo(primaryAreaId);

    return {
      success: true,
      message: 'Worker created successfully',
      data: {
        id: createdUser.id,
        name: createdUser.name,
        email: createdUser.email,
        phone: createdUser.phone,
        role: createdUser.role,
        profileImage: createdUser.profileImage,
        isActive: createdUser.isActive,
        createdAt: createdUser.createdAt,
        employeeCode: workerProfile.employeeCode,
        shiftId: workerProfile.shiftId,
        shift: workerProfile.shiftRef,
        officeLocationIds: officeLocations.map((o) => o.id),
        officeLocations,
        assignedAreaIds: workerProfile.areaId ? [workerProfile.areaId] : [],
        areaIds: workerProfile.areaId ? [workerProfile.areaId] : [],
        assignedAreas,
        gender: workerProfile.gender ?? null,
        dateOfBirth: toDateOnlyString(workerProfile.dateOfBirth),
        address: workerProfile.address,
        aadhaarNumber: workerProfile.aadhaarNumber,
        aadhaarFrontImage: workerProfile.aadhaarFrontImage,
        aadhaarBackImage: workerProfile.aadhaarBackImage,
        panNumber: workerProfile.panNumber,
        panImage: workerProfile.panImage,
        employmentType: workerProfile.salaryType,
        monthlySalary: workerProfile.salaryAmount,
        paymentCycle: workerProfile.paymentCycle,
        joiningDate: workerProfile.joiningDate,
        salaryStartDate: workerProfile.joiningDate,
        commissions,
        commissionRules: commissions,
        accountHolderName: workerProfile.accountHolderName,
        bankName: workerProfile.bankName,
        accountNumber: workerProfile.accountNumber,
        ifscCode: workerProfile.ifscCode,
        branchName: workerProfile.branchName,
        upiId: workerProfile.upiId,
        bankDetails: {
          accountHolderName: workerProfile.accountHolderName,
          bankName: workerProfile.bankName,
          accountNumber: workerProfile.accountNumber,
          ifscCode: workerProfile.ifscCode,
          branchName: workerProfile.branchName,
          upiId: workerProfile.upiId,
        },
        remark: workerProfile.remark,
        remarks: workerProfile.remark,
      },
    };
  }

  async updateWorker(
    user: AuthUser,
    workerId: string,
    dto: UpdateManagerWorkerDto,
  ) {
    // authorizeWorker enforces "manager can edit only workers assigned to his own areas" —
    // resolveWorkerFilter scopes by ManagerArea, same as every other Manager Worker endpoint.
    await this.authorizeWorker(user.id, workerId);

    const workerProfileRow = await this.prisma.workerProfile.findUnique({
      where: { userId: workerId },
      select: { id: true, salaryType: true, areaId: true },
    });
    if (!workerProfileRow) throw new NotFoundException('Worker not found');

    const commissionRules = dto.commissionRules ?? dto.commissions;
    const joiningDate = dto.salaryStartDate ?? dto.joiningDate;
    const remark = dto.remarks ?? dto.remark;
    const bank = this.resolveWorkerBankDetails(dto);
    const email =
      dto.email !== undefined ? dto.email.toLowerCase().trim() : undefined;

    // Cross-field employment rules only apply when employmentType is actively being changed
    // in this request — an unrelated partial update (e.g. just isActive) must not be forced
    // to also resend monthlySalary/commissionRules.
    if (dto.employmentType !== undefined) {
      this.validateEmploymentDetails(
        dto.employmentType,
        dto.monthlySalary,
        commissionRules,
      );
    }
    if (commissionRules && commissionRules.length > 0) {
      await this.validateCommissionServices(commissionRules);
    }

    // Reuses AdminService's existence/active check rather than duplicating it here.
    await this.adminService.validateShiftId(dto.shiftId);

    // Office ↔ area reassignment — reuses the same validation helpers as createWorker. If
    // officeLocationIds is omitted, areaIds is validated against all of the manager's own
    // offices (a manager may move a worker to any area within their own offices without
    // having to resend the exact office scope every time).
    let newPrimaryAreaId: string | undefined;
    if (dto.officeLocationIds !== undefined || dto.areaIds !== undefined) {
      const ownOfficeIds = await this.getManagerOfficeIds(user.id);
      if (dto.officeLocationIds !== undefined) {
        this.validateOwnOffices(ownOfficeIds, dto.officeLocationIds);
      }
      if (dto.areaIds !== undefined) {
        const officeScope = dto.officeLocationIds ?? ownOfficeIds;
        await this.validateOfficeAreaMapping(officeScope, dto.areaIds);
        newPrimaryAreaId = dto.areaIds[0];
      }
    }

    await this.duplicateCheck.ensureUnique({
      email,
      phone: dto.phone,
      aadhaarNumber: dto.aadhaarNumber,
      panNumber: dto.panNumber,
      excludeUserId: workerId,
    });

    const [updatedUser, updatedProfile] = await this.prisma.$transaction(
      async (tx) => {
        const userUpdate: Prisma.UserUpdateInput = {};
        if (dto.name !== undefined) userUpdate.name = dto.name;
        if (email !== undefined) userUpdate.email = email;
        if (dto.phone !== undefined) userUpdate.phone = dto.phone;
        if (dto.profileImage !== undefined)
          userUpdate.profileImage = dto.profileImage;
        if (dto.isActive !== undefined) userUpdate.isActive = dto.isActive;

        const USER_SELECT = {
          id: true,
          name: true,
          email: true,
          phone: true,
          profileImage: true,
          isActive: true,
        } as const;

        const uUser =
          Object.keys(userUpdate).length > 0
            ? await tx.user.update({
                where: { id: workerId },
                data: userUpdate,
                select: USER_SELECT,
              })
            : await tx.user.findUniqueOrThrow({
                where: { id: workerId },
                select: USER_SELECT,
              });

        const profileUpdate: Prisma.WorkerProfileUncheckedUpdateInput = {};
        if (dto.gender !== undefined) profileUpdate.gender = dto.gender;
        if (dto.dateOfBirth !== undefined)
          profileUpdate.dateOfBirth = new Date(dto.dateOfBirth);
        if (dto.address !== undefined) profileUpdate.address = dto.address;
        if (dto.aadhaarNumber !== undefined)
          profileUpdate.aadhaarNumber = dto.aadhaarNumber;
        if (dto.aadhaarFrontImage !== undefined)
          profileUpdate.aadhaarFrontImage = dto.aadhaarFrontImage;
        if (dto.aadhaarBackImage !== undefined)
          profileUpdate.aadhaarBackImage = dto.aadhaarBackImage;
        if (dto.panNumber !== undefined)
          profileUpdate.panNumber = dto.panNumber;
        if (dto.panImage !== undefined) profileUpdate.panImage = dto.panImage;
        if (dto.shiftId !== undefined) profileUpdate.shiftId = dto.shiftId;
        if (newPrimaryAreaId !== undefined)
          profileUpdate.areaId = newPrimaryAreaId;
        if (dto.employmentType !== undefined)
          profileUpdate.salaryType = dto.employmentType;
        if (dto.monthlySalary !== undefined)
          profileUpdate.salaryAmount = dto.monthlySalary;
        if (dto.paymentCycle !== undefined)
          profileUpdate.paymentCycle = dto.paymentCycle;
        if (joiningDate !== undefined)
          profileUpdate.joiningDate = new Date(joiningDate);
        if (bank.accountHolderName !== undefined)
          profileUpdate.accountHolderName = bank.accountHolderName;
        if (bank.bankName !== undefined) profileUpdate.bankName = bank.bankName;
        if (bank.accountNumber !== undefined)
          profileUpdate.accountNumber = bank.accountNumber;
        if (bank.ifscCode !== undefined) profileUpdate.ifscCode = bank.ifscCode;
        if (bank.branchName !== undefined)
          profileUpdate.branchName = bank.branchName;
        if (bank.upiId !== undefined) profileUpdate.upiId = bank.upiId;
        if (remark !== undefined) profileUpdate.remark = remark;

        const PROFILE_SELECT = {
          areaId: true,
          shiftId: true,
          shiftRef: true,
          gender: true,
          dateOfBirth: true,
          address: true,
          aadhaarNumber: true,
          aadhaarFrontImage: true,
          aadhaarBackImage: true,
          panNumber: true,
          panImage: true,
          salaryType: true,
          salaryAmount: true,
          paymentCycle: true,
          joiningDate: true,
          accountHolderName: true,
          bankName: true,
          accountNumber: true,
          ifscCode: true,
          branchName: true,
          upiId: true,
          remark: true,
        } as const;

        const uProfile =
          Object.keys(profileUpdate).length > 0
            ? await tx.workerProfile.update({
                where: { id: workerProfileRow.id },
                data: profileUpdate,
                select: PROFILE_SELECT,
              })
            : await tx.workerProfile.findUniqueOrThrow({
                where: { id: workerProfileRow.id },
                select: PROFILE_SELECT,
              });

        // Ensures this manager can still see/manage the worker via every other Manager Worker
        // endpoint (all authorize via ManagerArea) after being moved to a new area — no-op if
        // the link already exists. Mirrors createWorker's identical upsert.
        if (newPrimaryAreaId !== undefined) {
          const managerProfileRow = await tx.managerProfile.findUnique({
            where: { userId: user.id },
            select: { id: true },
          });
          if (managerProfileRow) {
            await tx.managerArea.upsert({
              where: {
                managerId_areaId: {
                  managerId: managerProfileRow.id,
                  areaId: newPrimaryAreaId,
                },
              },
              create: {
                managerId: managerProfileRow.id,
                areaId: newPrimaryAreaId,
              },
              update: {},
            });
          }
        }

        // Sent commissionRules fully replace existing ones — simplest, unambiguous semantics
        // for a "these are the worker's commission rates now" payload.
        if (commissionRules !== undefined) {
          await tx.workerCommission.deleteMany({
            where: { workerId: workerProfileRow.id },
          });
          if (commissionRules.length > 0) {
            await tx.workerCommission.createMany({
              data: commissionRules.map((c) => ({
                workerId: workerProfileRow.id,
                serviceId: c.serviceId,
                commissionType: c.commissionType,
                commissionValue: c.commissionValue,
              })),
            });
          }
        }

        return [uUser, uProfile];
      },
    );

    const [commissions, { officeLocations, assignedAreas }] = await Promise.all(
      [
        this.prisma.workerCommission.findMany({
          where: { workerId: workerProfileRow.id },
          select: {
            id: true,
            serviceId: true,
            commissionType: true,
            commissionValue: true,
            service: { select: { id: true, name: true } },
          },
        }),
        this.deriveAreaOfficeInfo(updatedProfile.areaId),
      ],
    );

    this.activityLogService.log({
      action: ActivityAction.WORKER_UPDATED,
      module: ActivityModule.WORKER,
      description: `Worker ${updatedUser.name} updated by manager ${user.name}`,
      actor: { id: user.id, name: user.name, role: user.role },
      target: { id: workerId, type: 'User' },
      metadata: { fields: Object.keys(dto) },
    });

    return {
      success: true,
      message: 'Worker updated successfully',
      data: {
        id: updatedUser.id,
        name: updatedUser.name,
        email: updatedUser.email,
        phone: updatedUser.phone,
        profileImage: updatedUser.profileImage,
        isActive: updatedUser.isActive,
        shiftId: updatedProfile.shiftId,
        shift: updatedProfile.shiftRef,
        officeLocationIds: officeLocations.map((o) => o.id),
        officeLocations,
        areaIds: updatedProfile.areaId ? [updatedProfile.areaId] : [],
        assignedAreaIds: updatedProfile.areaId ? [updatedProfile.areaId] : [],
        assignedAreas,
        gender: updatedProfile.gender ?? null,
        dateOfBirth: toDateOnlyString(updatedProfile.dateOfBirth),
        address: updatedProfile.address,
        aadhaarNumber: updatedProfile.aadhaarNumber,
        aadhaarFrontImage: updatedProfile.aadhaarFrontImage,
        aadhaarBackImage: updatedProfile.aadhaarBackImage,
        panNumber: updatedProfile.panNumber,
        panImage: updatedProfile.panImage,
        employmentType: updatedProfile.salaryType,
        monthlySalary: updatedProfile.salaryAmount,
        paymentCycle: updatedProfile.paymentCycle,
        joiningDate: updatedProfile.joiningDate,
        salaryStartDate: updatedProfile.joiningDate,
        commissions,
        commissionRules: commissions,
        accountHolderName: updatedProfile.accountHolderName,
        bankName: updatedProfile.bankName,
        accountNumber: updatedProfile.accountNumber,
        ifscCode: updatedProfile.ifscCode,
        branchName: updatedProfile.branchName,
        upiId: updatedProfile.upiId,
        bankDetails: {
          accountHolderName: updatedProfile.accountHolderName,
          bankName: updatedProfile.bankName,
          accountNumber: updatedProfile.accountNumber,
          ifscCode: updatedProfile.ifscCode,
          branchName: updatedProfile.branchName,
          upiId: updatedProfile.upiId,
        },
        remark: updatedProfile.remark,
        remarks: updatedProfile.remark,
      },
    };
  }

  async getWorkerList(user: AuthUser, query: ManagerWorkerListQueryDto) {
    const {
      page = 1,
      limit = 20,
      search,
      status = 'all',
      areaId,
      officeLocationId,
    } = query;

    const { areaIds } = await this.getManagerScope(user.id);
    if (areaId && !areaIds.includes(areaId)) {
      return {
        success: true,
        data: { workers: [], meta: { total: 0, page, limit, totalPages: 0 } },
      };
    }

    if (status === 'inactive') {
      return this.getInactiveWorkerList(user.id, {
        page,
        limit,
        search,
        areaId,
      });
    }

    // 'all' and 'active' both resolve through AdminService.getWorkers, whose report
    // scope is always active workers — the two are equivalent from that source.
    const attendanceStatus =
      status === 'present'
        ? 'PRESENT'
        : status === 'absent'
          ? 'ABSENT'
          : undefined;

    const [baseResult, liveResult, reportResult] = await Promise.all([
      this.adminService.getWorkers({
        managerId: user.id,
        page,
        limit,
        search,
        areaId,
        officeLocationId,
        status: attendanceStatus,
      }),
      // Full-team lookups (manager teams are small) used only to enrich the current page.
      this.adminService.getLiveWorkers({
        managerId: user.id,
        page: 1,
        limit: 1000,
      }),
      this.reportsService.getWorkerReport({
        managerId: user.id,
        page: 1,
        limit: 1000,
      }),
    ]);

    const ids = baseResult.data.workers.map((w) => w.id);
    const [profileImages, employmentMap] = await Promise.all([
      this.getProfileImageMap(ids),
      this.getWorkerEmploymentMap(ids),
    ]);

    const liveMap = new Map(liveResult.data.workers.map((w) => [w.id, w]));
    const reportMap = new Map(reportResult.data.items.map((w) => [w.id, w]));

    const workers = baseResult.data.workers.map((w) => {
      const live = liveMap.get(w.id);
      const report = reportMap.get(w.id);
      const completedJobs = report?.completedJobs ?? 0;
      const pendingJobs = report?.pendingJobs ?? 0;
      const employment = employmentMap.get(w.id) ?? null;

      return {
        id: w.id,
        name: w.name,
        phone: w.phone,
        profileImage: profileImages.get(w.id) ?? null,
        status:
          live?.status ??
          (w.attendanceStatus === 'CHECKED_IN' ? 'active' : 'offline'),
        todayAttendance: {
          status: w.attendanceStatus,
          checkInTime: w.checkInTime,
          checkOutTime: w.checkOutTime,
          workingHours: w.workingHours,
        },
        // Derived from the same attendance data already joined into w.attendanceStatus above —
        // no extra query.
        todayAttendanceStatus: deriveTodayAttendanceStatus(
          w.attendanceStatus === 'CHECKED_IN' ||
            w.attendanceStatus === 'CHECKED_OUT',
        ),
        assignedArea: report?.area ?? null,
        officeLocation: w.officeLocation,
        currentTask: live?.currentJob ?? null,
        rating: null,
        totalJobs: completedJobs + pendingJobs,
        completedJobs,
        aadhaarNumber: employment?.aadhaarNumber ?? null,
        panNumber: employment?.panNumber ?? null,
        employmentType: employment?.employmentType ?? null,
        monthlySalary: employment?.monthlySalary ?? null,
        paymentCycle: employment?.paymentCycle ?? null,
        joiningDate: employment?.joiningDate ?? null,
        commissions: employment?.commissions ?? [],
        // List view — bankName/accountHolderName only, never accountNumber (see getWorkerDetails).
        bankDetails: employment?.bankDetails ?? null,
      };
    });

    return { success: true, data: { workers, meta: baseResult.data.meta } };
  }

  private async getInactiveWorkerList(
    managerId: string,
    params: { page: number; limit: number; search?: string; areaId?: string },
  ) {
    const result = await this.reportsService.getWorkerReport({
      managerId,
      isActive: false,
      page: params.page,
      limit: params.limit,
      search: params.search,
      areaId: params.areaId,
    });

    const ids = result.data.items.map((w) => w.id);
    // Single bulk query (same today-range helper AttendanceService.getTodayAttendance uses
    // internally) rather than one AttendanceService call per worker — avoids N+1 on this list.
    const { start: todayStart, end: todayEnd } = getTodayRange();
    const [profileImages, employmentMap, todayCheckIns] = await Promise.all([
      this.getProfileImageMap(ids),
      this.getWorkerEmploymentMap(ids),
      ids.length > 0
        ? this.prisma.attendance.findMany({
            where: {
              userId: { in: ids },
              checkInTime: { gte: todayStart, lt: todayEnd },
            },
            select: { userId: true },
            distinct: ['userId'],
          })
        : Promise.resolve([] as { userId: string }[]),
    ]);
    const checkedInTodaySet = new Set(todayCheckIns.map((a) => a.userId));

    const workers = result.data.items.map((w) => {
      const employment = employmentMap.get(w.id) ?? null;
      return {
        id: w.id,
        name: w.name,
        phone: w.phone,
        profileImage: profileImages.get(w.id) ?? null,
        status: 'inactive',
        todayAttendance: null,
        todayAttendanceStatus: deriveTodayAttendanceStatus(
          checkedInTodaySet.has(w.id),
        ),
        assignedArea: w.area,
        officeLocation: null,
        currentTask: null,
        rating: null,
        totalJobs: w.completedJobs + w.pendingJobs,
        completedJobs: w.completedJobs,
        aadhaarNumber: employment?.aadhaarNumber ?? null,
        panNumber: employment?.panNumber ?? null,
        employmentType: employment?.employmentType ?? null,
        monthlySalary: employment?.monthlySalary ?? null,
        paymentCycle: employment?.paymentCycle ?? null,
        joiningDate: employment?.joiningDate ?? null,
        commissions: employment?.commissions ?? [],
        bankDetails: employment?.bankDetails ?? null,
      };
    });

    return { success: true, data: { workers, meta: result.data.meta } };
  }

  async getWorkerDetails(user: AuthUser, workerId: string, orgId?: string) {
    await this.authorizeWorker(user.id, workerId);

    const [
      profile,
      attendanceSummary,
      todayAttendance,
      allTasks,
      completedTasks,
      reportResult,
    ] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: workerId },
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          profileImage: true,
          isActive: true,
          createdAt: true,
          workerProfile: {
            select: {
              id: true,
              employeeCode: true,
              gender: true,
              dateOfBirth: true,
              address: true,
              faceImage: true,
              salaryType: true,
              salaryAmount: true,
              commissionPercent: true,
              aadhaarNumber: true,
              aadhaarFrontImage: true,
              aadhaarBackImage: true,
              panNumber: true,
              panImage: true,
              paymentCycle: true,
              joiningDate: true,
              accountHolderName: true,
              bankName: true,
              accountNumber: true,
              ifscCode: true,
              branchName: true,
              upiId: true,
              remark: true,
              shiftId: true,
              shiftRef: true,
              commissions: {
                select: {
                  id: true,
                  serviceId: true,
                  commissionType: true,
                  commissionValue: true,
                  service: { select: { id: true, name: true } },
                },
              },
              area: {
                select: {
                  id: true,
                  name: true,
                  pincode: true,
                  city: true,
                  state: true,
                  officeLocations: {
                    select: { id: true, name: true, address: true },
                  },
                },
              },
            },
          },
        },
      }),
      this.attendanceService.getMonthlySummary(workerId, {}),
      this.attendanceService.getTodayAttendance(workerId),
      this.tasksService.getMyTasks(workerId, { limit: 50 }, orgId),
      this.tasksService.getMyTasks(
        workerId,
        { status: TaskStatus.COMPLETED, limit: 20 },
        orgId,
      ),
      this.reportsService.getWorkerReport({ workerId, page: 1, limit: 1 }),
    ]);

    if (!profile) throw new NotFoundException('Worker not found');

    const earningsRow = reportResult.data.items[0] ?? null;
    const attendanceSummaryData = attendanceSummary.data ?? {
      month: null,
      year: null,
      totalDays: 0,
      presentCount: 0,
      absentCount: 0,
      totalHours: 0,
      avgHoursPerDay: 0,
    };
    const attendancePercentage =
      attendanceSummaryData.totalDays > 0
        ? Math.round(
            (attendanceSummaryData.presentCount /
              attendanceSummaryData.totalDays) *
              100,
          )
        : 0;

    // Office info is derived from the worker's assigned area's own office links (existing
    // Area.officeLocations relation) — WorkerProfile has no direct office relation.
    const area = profile.workerProfile?.area ?? null;
    const officeLocations = area?.officeLocations ?? [];
    const bankDetails = {
      accountHolderName: profile.workerProfile?.accountHolderName ?? null,
      bankName: profile.workerProfile?.bankName ?? null,
      accountNumber: profile.workerProfile?.accountNumber ?? null,
      ifscCode: profile.workerProfile?.ifscCode ?? null,
      branchName: profile.workerProfile?.branchName ?? null,
      upiId: profile.workerProfile?.upiId ?? null,
    };

    return {
      success: true,
      data: {
        profile: {
          id: profile.id,
          name: profile.name,
          email: profile.email,
          phone: profile.phone,
          profileImage: resolveImageUrl(
            profile.profileImage ?? profile.workerProfile?.faceImage,
            this.configService.get<string>('baseUrl'),
          ),
          isActive: profile.isActive,
          employeeCode: profile.workerProfile?.employeeCode ?? null,
          gender: profile.workerProfile?.gender ?? null,
          dateOfBirth: toDateOnlyString(profile.workerProfile?.dateOfBirth),
          address: profile.workerProfile?.address ?? null,
          salaryType: profile.workerProfile?.salaryType ?? null,
          salaryAmount: profile.workerProfile?.salaryAmount ?? null,
          commissionPercent: profile.workerProfile?.commissionPercent ?? null,
          aadhaarNumber: profile.workerProfile?.aadhaarNumber ?? null,
          aadhaarFrontImage: profile.workerProfile?.aadhaarFrontImage ?? null,
          aadhaarBackImage: profile.workerProfile?.aadhaarBackImage ?? null,
          panNumber: profile.workerProfile?.panNumber ?? null,
          panImage: profile.workerProfile?.panImage ?? null,
          employmentType: profile.workerProfile?.salaryType ?? null,
          monthlySalary: profile.workerProfile?.salaryAmount ?? null,
          paymentCycle: profile.workerProfile?.paymentCycle ?? null,
          joiningDate: profile.workerProfile?.joiningDate ?? null,
          salaryStartDate: profile.workerProfile?.joiningDate ?? null,
          commissions: profile.workerProfile?.commissions ?? [],
          commissionRules: profile.workerProfile?.commissions ?? [],
          accountHolderName: profile.workerProfile?.accountHolderName ?? null,
          bankName: profile.workerProfile?.bankName ?? null,
          accountNumber: profile.workerProfile?.accountNumber ?? null,
          ifscCode: profile.workerProfile?.ifscCode ?? null,
          branchName: profile.workerProfile?.branchName ?? null,
          upiId: profile.workerProfile?.upiId ?? null,
          bankDetails,
          remark: profile.workerProfile?.remark ?? null,
          remarks: profile.workerProfile?.remark ?? null,
          createdAt: profile.createdAt,
        },
        // ── Additive, grouped sections below — fields nested under `profile` above are kept
        // for backward compatibility with existing consumers. ──
        salary: {
          employmentType: profile.workerProfile?.salaryType ?? null,
          monthlySalary: profile.workerProfile?.salaryAmount ?? null,
          paymentCycle: profile.workerProfile?.paymentCycle ?? null,
          salaryStartDate: profile.workerProfile?.joiningDate ?? null,
        },
        commission: {
          commissionPercent: profile.workerProfile?.commissionPercent ?? null,
          commissionRules: profile.workerProfile?.commissions ?? [],
        },
        aadhaar: {
          number: profile.workerProfile?.aadhaarNumber ?? null,
          frontImage: profile.workerProfile?.aadhaarFrontImage ?? null,
          backImage: profile.workerProfile?.aadhaarBackImage ?? null,
        },
        pan: {
          number: profile.workerProfile?.panNumber ?? null,
          image: profile.workerProfile?.panImage ?? null,
        },
        bankDetails,
        statistics: {
          completedJobs: earningsRow?.completedJobs ?? 0,
          pendingJobs: earningsRow?.pendingJobs ?? 0,
          attendancePercentage,
          rating: null,
        },
        attendanceSummary: attendanceSummaryData,
        todayAttendance: todayAttendance.data,
        // Derived from the same AttendanceService.getTodayAttendance call already made above
        // (todayAttendance) — no extra query.
        todayAttendanceStatus: deriveTodayAttendanceStatus(
          !!todayAttendance.data,
        ),
        assignedTasks: (allTasks.data.tasks ?? []).filter(
          (t) => t.status !== TaskStatus.COMPLETED,
        ),
        completedTasks: completedTasks.data.tasks ?? [],
        earningsSummary: {
          completedJobs: earningsRow?.completedJobs ?? 0,
          pendingJobs: earningsRow?.pendingJobs ?? 0,
          earnings: earningsRow?.earnings ?? 0,
        },
        rating: null,
        officeLocation: todayAttendance.data?.officeLocation ?? null,
        officeLocationIds: officeLocations.map((o) => o.id),
        officeLocations,
        assignedAreas: area ? [area] : [],
        assignedAreaIds: area ? [area.id] : [],
        shiftId: profile.workerProfile?.shiftId ?? null,
        shift: profile.workerProfile?.shiftRef ?? null,
      },
    };
  }

  async getPresentWorkers(
    user: AuthUser,
    query: Pick<ManagerWorkerListQueryDto, 'page' | 'limit' | 'search'>,
  ) {
    return this.adminService.getWorkers({
      managerId: user.id,
      status: 'PRESENT',
      page: query.page ?? 1,
      limit: query.limit ?? 20,
      search: query.search,
    });
  }

  async getAbsentWorkers(
    user: AuthUser,
    query: Pick<ManagerWorkerListQueryDto, 'page' | 'limit' | 'search'>,
  ) {
    return this.adminService.getWorkers({
      managerId: user.id,
      status: 'ABSENT',
      page: query.page ?? 1,
      limit: query.limit ?? 20,
      search: query.search,
    });
  }

  async getWorkerAttendanceHistory(
    user: AuthUser,
    workerId: string,
    query: AttendanceHistoryQueryDto,
  ) {
    await this.authorizeWorker(user.id, workerId);
    return this.attendanceService.getHistory(workerId, query);
  }

  async assignWorkerToTask(
    user: AuthUser,
    workerId: string,
    dto: AssignTaskDto,
    orgId?: string,
  ) {
    await this.authorizeWorker(user.id, workerId);

    const worker = await this.prisma.user.findUnique({
      where: { id: workerId },
      select: { isActive: true },
    });
    if (!worker?.isActive) throw new BadRequestException('Worker is inactive');

    const activeTaskCount = await this.prisma.task.count({
      where: { assignedWorkerId: workerId, status: TaskStatus.IN_PROGRESS },
    });
    if (activeTaskCount > 0) {
      throw new BadRequestException(
        'Worker is not available — already has an in-progress task',
      );
    }

    return this.tasksService.assignWorker(
      dto.taskId,
      user.id,
      { workerId },
      orgId,
    );
  }

  async getWorkerLiveStatus(user: AuthUser, workerId: string) {
    await this.authorizeWorker(user.id, workerId);

    const liveResult = await this.adminService.getLiveWorkers({
      managerId: user.id,
      page: 1,
      limit: 1000,
    });
    const worker = liveResult.data.workers.find((w) => w.id === workerId);
    if (!worker) throw new NotFoundException('Worker not found in your team');

    return {
      success: true,
      data: {
        online: worker.status !== 'offline',
        status: worker.status,
        currentLocation: worker.currentLocation,
        battery: null,
        lastUpdated: worker.lastUpdated,
        currentTask: worker.currentJob,
      },
    };
  }

  // ─── Reports ──────────────────────────────────────────────────────────────────

  async getReportsDashboard(user: AuthUser) {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const { areaIds } = await this.getManagerScope(user.id);

    const [
      dashboard,
      jobStatusGroups,
      distinctCustomerRows,
      monthlyRevenueAgg,
      monthlySalaryAgg,
      monthlyCompletedBookings,
    ] = await Promise.all([
      // Reuses DashboardService.getManagerDashboard — already resolves the manager's
      // pincode/area scope and is 60s-cached.
      this.dashboardService.getManagerDashboard(user.id),
      this.prisma.booking.groupBy({
        by: ['status'],
        where: { managerId: user.id },
        _count: true,
      }),
      this.prisma.booking.findMany({
        where: { managerId: user.id },
        select: { customerId: true },
        distinct: ['customerId'],
      }),
      this.prisma.booking.aggregate({
        where: {
          managerId: user.id,
          status: BookingStatus.COMPLETED,
          completedAt: { gte: monthStart },
        },
        _sum: { totalAmount: true },
      }),
      areaIds.length > 0
        ? this.prisma.workerProfile.aggregate({
            where: { areaId: { in: areaIds }, salaryType: SalaryType.SALARY },
            _sum: { salaryAmount: true },
          })
        : Promise.resolve({ _sum: { salaryAmount: null } }),
      this.prisma.booking.findMany({
        where: {
          managerId: user.id,
          status: BookingStatus.COMPLETED,
          completedAt: { gte: monthStart },
        },
        select: { workerId: true, serviceId: true, totalAmount: true },
      }),
    ]);

    const totalJobs = jobStatusGroups.reduce((sum, g) => sum + g._count, 0);
    const completedJobs =
      jobStatusGroups.find((g) => g.status === BookingStatus.COMPLETED)
        ?._count ?? 0;
    const cancelledJobs =
      jobStatusGroups.find((g) => g.status === BookingStatus.CANCELLED)
        ?._count ?? 0;
    const pendingJobs = Math.max(0, totalJobs - completedJobs - cancelledJobs);

    const totalWorkers = dashboard.data.assignedWorkers;
    const presentWorkers = dashboard.data.workersCheckedInToday;
    const absentWorkers = Math.max(0, totalWorkers - presentWorkers);

    const monthlyCommission = await this.computeMonthlyCommission(
      monthlyCompletedBookings,
    );

    return {
      success: true,
      data: {
        totalJobs,
        completedJobs,
        pendingJobs,
        cancelledJobs,
        totalWorkers,
        presentWorkers,
        absentWorkers,
        totalCustomers: distinctCustomerRows.length,
        monthlyRevenue: this.round2(monthlyRevenueAgg._sum.totalAmount ?? 0),
        monthlyCommission,
        monthlySalaryPayable: this.round2(
          Number(monthlySalaryAgg._sum.salaryAmount ?? 0),
        ),
      },
    };
  }

  // Commission payable this month: matches each COMMISSION-type worker's completed bookings
  // against their per-service WorkerCommission rule. Two bulk queries (never per-booking) —
  // WorkerCommission.workerId is the WorkerProfile PK, not the User id, hence the id bridge.
  private async computeMonthlyCommission(
    bookings: {
      workerId: string | null;
      serviceId: string;
      totalAmount: number | null;
    }[],
  ): Promise<number> {
    const workerUserIds = [
      ...new Set(
        bookings.map((b) => b.workerId).filter((id): id is string => !!id),
      ),
    ];
    if (workerUserIds.length === 0) return 0;

    const commissionWorkers = await this.prisma.workerProfile.findMany({
      where: {
        userId: { in: workerUserIds },
        salaryType: SalaryType.COMMISSION,
      },
      select: { id: true, userId: true },
    });
    if (commissionWorkers.length === 0) return 0;

    const workerProfileIdByUserId = new Map(
      commissionWorkers.map((w) => [w.userId, w.id]),
    );
    const rules = await this.prisma.workerCommission.findMany({
      where: {
        workerId: { in: commissionWorkers.map((w) => w.id) },
      },
      select: {
        workerId: true,
        serviceId: true,
        commissionType: true,
        commissionValue: true,
      },
    });
    const ruleMap = new Map(
      rules.map((r) => [`${r.workerId}:${r.serviceId}`, r]),
    );

    let total = 0;
    for (const b of bookings) {
      if (!b.workerId) continue;
      const workerProfileId = workerProfileIdByUserId.get(b.workerId);
      if (!workerProfileId) continue;
      const rule = ruleMap.get(`${workerProfileId}:${b.serviceId}`);
      if (!rule) continue;
      const amount = b.totalAmount ?? 0;
      total +=
        rule.commissionType === CommissionType.PERCENT
          ? (amount * rule.commissionValue) / 100
          : rule.commissionValue;
    }
    return this.round2(total);
  }

  private round2(n: number): number {
    return Math.round(n * 100) / 100;
  }

  async getReportsAttendance(
    user: AuthUser,
    query: ManagerAttendanceReportQueryDto,
  ) {
    // resolveWorkerFilter/authorizeWorker enforce "manager sees only their own team" —
    // same scoping helpers used throughout this service.
    const workerFilter = await this.resolveWorkerFilter(user.id);
    if (query.workerId) await this.authorizeWorker(user.id, query.workerId);

    const { start, end } = resolveReportDateRange(
      query.period,
      query.startDate,
      query.endDate,
    );
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where: Prisma.AttendanceWhereInput = {
      user: { role: Role.WORKER, workerProfile: workerFilter },
      ...(query.workerId ? { userId: query.workerId } : {}),
      ...(start || end
        ? {
            checkInTime: {
              ...(start ? { gte: start } : {}),
              ...(end ? { lte: end } : {}),
            },
          }
        : {}),
    };

    const [records, total] = await Promise.all([
      this.prisma.attendance.findMany({
        where,
        include: {
          user: { select: { id: true, name: true, phone: true } },
          officeLocation: { select: { id: true, name: true } },
        },
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { checkInTime: 'desc' },
      }),
      this.prisma.attendance.count({ where }),
    ]);

    const items = records.map((r) => ({
      id: r.id,
      user: { id: r.user.id, name: r.user.name, phone: r.user.phone },
      officeLocation: r.officeLocation,
      checkInTime: r.checkInTime,
      checkOutTime: r.checkOutTime,
      workingHours: r.checkOutTime
        ? this.round2(
            (r.checkOutTime.getTime() - r.checkInTime.getTime()) / 3_600_000,
          )
        : null,
      status: r.status,
      date: r.checkInTime,
    }));

    return {
      success: true,
      data: {
        items,
        meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
      },
    };
  }

  async getReportsJobs(user: AuthUser, query: BookingReportQueryDto) {
    // Reuses ReportsService.getBookingReport wholesale (status/workerId/serviceId/date
    // filters already supported) — managerId is always forced to the caller, never trusted
    // from the query, so a manager can only ever see their own team's bookings.
    return this.reportsService.getBookingReport({
      ...query,
      managerId: user.id,
    });
  }

  async getReportsEarnings(user: AuthUser) {
    const rows = await this.prisma.payment.groupBy({
      by: ['method', 'status'],
      where: { invoice: { booking: { managerId: user.id } } },
      _sum: { amount: true },
    });

    let cashPayments = 0;
    let onlinePayments = 0;
    let pendingPayments = 0;

    for (const row of rows) {
      const amount = row._sum.amount ?? 0;
      if (row.status === PaymentStatus.PENDING) {
        pendingPayments += amount;
      } else if (row.status === PaymentStatus.SUCCESS) {
        if (row.method === PaymentMethod.CASH) cashPayments += amount;
        else onlinePayments += amount;
      }
    }

    return {
      success: true,
      data: {
        totalEarnings: this.round2(cashPayments + onlinePayments),
        cashPayments: this.round2(cashPayments),
        onlinePayments: this.round2(onlinePayments),
        pendingPayments: this.round2(pendingPayments),
      },
    };
  }

  async getReportsWorkers(user: AuthUser, query: WorkerReportQueryDto) {
    // Reuses ReportsService.getWorkerReport (completedJobs/earnings/attendancePct already
    // computed there via bulk groupBy — no per-worker queries) — managerId forced to the
    // caller for the same team-scoping reason as getReportsJobs.
    const result = await this.reportsService.getWorkerReport({
      ...query,
      managerId: user.id,
    });

    const ids = result.data.items.map((w) => w.id);
    const profileImages = await this.getProfileImageMap(ids);

    const items = result.data.items.map((w) => ({
      workerId: w.id,
      name: w.name,
      profileImage: profileImages.get(w.id) ?? null,
      completedJobs: w.completedJobs,
      rating: null,
      attendancePercentage: w.attendancePct,
      earnings: w.earnings,
    }));

    return { success: true, data: { items, meta: result.data.meta } };
  }

  // ─── Jobs (Bookings) ────────────────────────────────────────────────────────────

  async getJobsDashboard(user: AuthUser) {
    const scope = await this.resolveManagerBookingScope(user.id);
    const statusGroups = await this.prisma.booking.groupBy({
      by: ['status'],
      where: scope,
      _count: true,
    });

    const countOf = (statuses: BookingStatus[]) =>
      statusGroups
        .filter((g) => statuses.includes(g.status))
        .reduce((sum, g) => sum + g._count, 0);

    return {
      success: true,
      data: {
        totalJobs: statusGroups.reduce((sum, g) => sum + g._count, 0),
        pendingJobs: countOf([BookingStatus.PENDING, BookingStatus.CONFIRMED]),
        assignedJobs: countOf([BookingStatus.ASSIGNED]),
        inProgressJobs: countOf([BookingStatus.IN_PROGRESS]),
        completedJobs: countOf([BookingStatus.COMPLETED]),
        cancelledJobs: countOf([
          BookingStatus.CANCELLED,
          BookingStatus.NO_SHOW,
        ]),
      },
    };
  }

  async getJobsList(user: AuthUser, query: ManagerJobQueryDto) {
    const {
      page = 1,
      limit = 20,
      status,
      serviceId,
      workerId,
      officeLocationId,
      areaId,
      customerId,
      search,
      startDate,
      endDate,
    } = query;

    if (workerId) await this.authorizeWorker(user.id, workerId);

    // areaId/officeLocationId narrow within the manager's own scope — never outside it. Matches
    // either the assigned worker's area (already-assigned jobs) OR the booking's own address
    // pincode against the selected area(s)' pincode (unassigned jobs whose customer is in that
    // area) — same reasoning as resolveManagerBookingScope below.
    let areaFilterIds: string[] | undefined;
    if (areaId || officeLocationId) {
      const { areaIds: managerAreaIds } = await this.getManagerScope(user.id);
      if (areaId) {
        if (!managerAreaIds.includes(areaId)) {
          return {
            success: true,
            data: { jobs: [], meta: { total: 0, page, limit, totalPages: 0 } },
          };
        }
        areaFilterIds = [areaId];
      } else if (officeLocationId) {
        const officeIds = await this.getManagerOfficeIds(user.id);
        if (!officeIds.includes(officeLocationId)) {
          return {
            success: true,
            data: { jobs: [], meta: { total: 0, page, limit, totalPages: 0 } },
          };
        }
        const areasForOffice = await this.prisma.area.findMany({
          where: {
            officeLocations: { some: { id: officeLocationId } },
            id: { in: managerAreaIds },
          },
          select: { id: true },
        });
        areaFilterIds = areasForOffice.map((a) => a.id);
      }
    }

    const scope = await this.resolveManagerBookingScope(user.id);

    // Built as AND: [...] rather than flat object-spread — scope, the areaFilter narrowing, and
    // the search clause below each contribute their own `OR`, and a plain `{...a, ...b}` spread
    // would silently let whichever one is written last completely replace the others' `OR`
    // (in the previous version, `search`'s OR always overwrote `scope`'s OR, which meant a
    // search query bypassed the manager's own scope entirely). AND: [] keeps every condition
    // independently enforced regardless of how many of them use OR internally.
    const andConditions: Prisma.BookingWhereInput[] = [scope];
    if (status) andConditions.push({ status });
    if (serviceId) andConditions.push({ serviceId });
    if (workerId) andConditions.push({ workerId });
    if (customerId) andConditions.push({ customerId });
    if (areaFilterIds) {
      const areaPincodes = await this.prisma.area.findMany({
        where: { id: { in: areaFilterIds } },
        select: { pincode: true },
      });
      andConditions.push({
        OR: [
          { worker: { workerProfile: { areaId: { in: areaFilterIds } } } },
          ...(areaPincodes.length > 0
            ? [{ address: { pincode: { in: areaPincodes.map((a) => a.pincode) } } }]
            : []),
        ],
      });
    }
    if (startDate || endDate) {
      andConditions.push({
        scheduledAt: {
          ...(startDate ? { gte: new Date(startDate) } : {}),
          ...(endDate ? { lte: new Date(endDate) } : {}),
        },
      });
    }
    if (search) {
      andConditions.push({
        OR: [
          { bookingRef: { contains: search, mode: 'insensitive' } },
          { customer: { name: { contains: search, mode: 'insensitive' } } },
          { service: { name: { contains: search, mode: 'insensitive' } } },
        ],
      });
    }

    const where: Prisma.BookingWhereInput = { AND: andConditions };

    const [bookings, total] = await this.prisma.$transaction([
      this.prisma.booking.findMany({
        where,
        select: {
          id: true,
          bookingRef: true,
          status: true,
          scheduledAt: true,
          completedAt: true,
          totalAmount: true,
          createdAt: true,
          customer: { select: { id: true, name: true, phone: true } },
          service: { select: { id: true, name: true } },
          worker: {
            select: {
              id: true,
              name: true,
              phone: true,
              workerProfile: {
                select: { area: { select: { id: true, name: true } } },
              },
            },
          },
        },
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { scheduledAt: 'desc' },
      }),
      this.prisma.booking.count({ where }),
    ]);

    const jobs = bookings.map((b) => ({
      id: b.id,
      bookingRef: b.bookingRef,
      status: b.status,
      scheduledAt: b.scheduledAt,
      completedAt: b.completedAt,
      totalAmount: b.totalAmount,
      customer: b.customer,
      service: b.service,
      worker: b.worker
        ? { id: b.worker.id, name: b.worker.name, phone: b.worker.phone }
        : null,
      area: b.worker?.workerProfile?.area ?? null,
      createdAt: b.createdAt,
    }));

    return {
      success: true,
      data: {
        jobs,
        meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
      },
    };
  }

  async getJobDetail(user: AuthUser, jobId: string) {
    await this.authorizeManagerBooking(user.id, jobId);

    // Reuses BookingsService.findOne for the core booking shape (service, propertyType,
    // package, timeSlot, address, customer, worker, manager, createdBy, statusHistory as the
    // timeline) — enriched below only with data that method doesn't provide (payment, the
    // worker's office/area).
    const [bookingResult, invoice] = await Promise.all([
      this.bookingsService.findOne(jobId),
      this.prisma.invoice.findUnique({
        where: { bookingId: jobId },
        include: { payments: true },
      }),
    ]);
    const booking = bookingResult.data;

    const workerProfile = booking.workerId
      ? await this.prisma.workerProfile.findUnique({
          where: { userId: booking.workerId },
          select: {
            area: {
              select: {
                id: true,
                name: true,
                pincode: true,
                city: true,
                state: true,
                officeLocations: {
                  select: { id: true, name: true, address: true },
                },
              },
            },
          },
        })
      : null;
    const area = workerProfile?.area ?? null;
    const officeLocations = area?.officeLocations ?? [];

    return {
      success: true,
      data: {
        id: booking.id,
        bookingRef: booking.bookingRef,
        status: booking.status,
        scheduledAt: booking.scheduledAt,
        completedAt: booking.completedAt,
        cancelledAt: booking.cancelledAt,
        cancelReason: booking.cancelReason,
        totalAmount: booking.totalAmount,
        advanceAmount: booking.advanceAmount,
        customer: booking.customer,
        worker: booking.worker,
        manager: booking.manager,
        service: booking.service,
        propertyType: booking.propertyType,
        package: booking.package,
        timeSlot: booking.timeSlot,
        address: booking.address,
        officeLocations,
        area,
        timeline: booking.statusHistory,
        payment: invoice
          ? {
              invoiceId: invoice.id,
              invoiceNumber: invoice.invoiceNumber,
              status: invoice.status,
              total: invoice.total,
              payments: invoice.payments.map((p) => ({
                id: p.id,
                amount: p.amount,
                method: p.method,
                status: p.status,
                paidAt: p.paidAt,
              })),
            }
          : null,
        // Booking has no image storage of its own (only Task/TaskPhoto does) — always empty
        // until that modeling exists for bookings specifically.
        beforeImages: [],
        afterImages: [],
        remarks: booking.notes ?? null,
        createdAt: booking.createdAt,
        updatedAt: booking.updatedAt,
      },
    };
  }

  async assignJobWorker(user: AuthUser, jobId: string, dto: AssignWorkerDto) {
    await this.authorizeManagerBooking(user.id, jobId);
    await this.authorizeWorker(user.id, dto.workerId);

    const booking = await this.prisma.booking.findUnique({
      where: { id: jobId },
      select: { workerId: true },
    });
    if (!booking) throw new NotFoundException('Job not found in your team');
    if (booking.workerId) {
      throw new BadRequestException(
        'Job already has a worker assigned — use reassign-worker instead',
      );
    }

    // Reuses BookingsService.assignWorker — identical mechanism for first assignment.
    return this.bookingsService.assignWorker(jobId, user.id, dto);
  }

  async reassignJobWorker(user: AuthUser, jobId: string, dto: AssignWorkerDto) {
    await this.authorizeManagerBooking(user.id, jobId);
    await this.authorizeWorker(user.id, dto.workerId);

    const booking = await this.prisma.booking.findUnique({
      where: { id: jobId },
      select: { workerId: true },
    });
    if (!booking) throw new NotFoundException('Job not found in your team');
    if (!booking.workerId) {
      throw new BadRequestException(
        'Job has no worker assigned yet — use assign-worker instead',
      );
    }

    // Reuses BookingsService.assignWorker — it already allows overwriting an existing
    // workerId (only blocks terminal statuses), so reassignment needs no separate mechanism.
    return this.bookingsService.assignWorker(jobId, user.id, dto);
  }

  async startJob(user: AuthUser, jobId: string) {
    await this.authorizeManagerBooking(user.id, jobId);

    const booking = await this.prisma.booking.findUnique({
      where: { id: jobId },
      select: { workerId: true },
    });
    if (!booking?.workerId) {
      throw new BadRequestException(
        'Job has no worker assigned — assign a worker before starting',
      );
    }

    // Reuses BookingsService.start, which validates the caller against the booking's own
    // assigned worker — passing that worker's id (not the manager's) applies the exact same
    // transition/validation rather than duplicating it, attributing the timeline entry to
    // the worker who is actually doing the job.
    return this.bookingsService.start(jobId, booking.workerId);
  }

  async completeJob(user: AuthUser, jobId: string) {
    await this.authorizeManagerBooking(user.id, jobId);
    // Reuses BookingsService.complete — already allows MANAGER unconditionally.
    return this.bookingsService.complete(jobId, user.id);
  }

  async cancelJob(user: AuthUser, jobId: string, dto: CancelBookingDto) {
    await this.authorizeManagerBooking(user.id, jobId);
    // Reuses BookingsService.cancel — already allows MANAGER unconditionally.
    return this.bookingsService.cancel(jobId, user.id, dto);
  }
}
