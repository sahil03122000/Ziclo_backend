import { Injectable } from '@nestjs/common';
import {
  AttendanceStatus,
  BookingStatus,
  InvoiceStatus,
  PaymentStatus,
  Role,
  TaskStatus,
} from '@prisma/client';

import { AttendanceService } from '../attendance/attendance.service';
import { getTodayRange } from '../common/utils/date.util';
import { LeavePolicyService } from '../leave-policy/leave-policy.service';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DashboardService {
  // 60-second in-memory cache for dashboard counts
  private readonly cache = new Map<
    string,
    { data: unknown; expiresAt: number }
  >();

  constructor(
    private readonly prisma: PrismaService,
    private readonly attendanceService: AttendanceService,
    private readonly leavePolicyService: LeavePolicyService,
  ) {}

  async getAdminDashboard() {
    const cached = this.hit<unknown>('admin');
    if (cached) return cached;

    const { start, end } = getTodayRange();
    const now = new Date();

    const [
      totalUsers,
      totalManagers,
      totalWorkers,
      activeWorkersToday,
      tasksPending,
      tasksInProgress,
      tasksCompleted,
      tasksPendingApproval,
      tasksOverdue,
    ] = await Promise.all([
      this.prisma.user.count({ where: { role: Role.USER, isActive: true } }),
      this.prisma.user.count({ where: { role: Role.MANAGER, isActive: true } }),
      this.prisma.user.count({ where: { role: Role.WORKER, isActive: true } }),
      this.prisma.attendance.count({
        where: {
          user: { role: Role.WORKER },
          checkInTime: { gte: start, lt: end },
          status: AttendanceStatus.CHECKED_IN,
        },
      }),
      this.prisma.task.count({ where: { status: TaskStatus.PENDING } }),
      this.prisma.task.count({ where: { status: TaskStatus.IN_PROGRESS } }),
      this.prisma.task.count({ where: { status: TaskStatus.COMPLETED } }),
      this.prisma.task.count({
        where: { status: TaskStatus.COMPLETED_PENDING_APPROVAL },
      }),
      this.prisma.task.count({
        where: {
          dueDate: { lt: now },
          status: {
            notIn: [
              TaskStatus.COMPLETED,
              TaskStatus.COMPLETED_PENDING_APPROVAL,
            ],
          },
        },
      }),
    ]);

    const result = {
      success: true,
      data: {
        users: {
          total: totalUsers,
          totalManagers,
          totalWorkers,
          activeWorkersToday,
        },
        tasks: {
          pending: tasksPending,
          inProgress: tasksInProgress,
          pendingApproval: tasksPendingApproval,
          completed: tasksCompleted,
          overdue: tasksOverdue,
        },
      },
    };

    this.store('admin', result, 60);
    return result;
  }

  async getManagerDashboard(managerId: string) {
    const cacheKey = `manager:${managerId}`;
    const cached = this.hit<Awaited<ReturnType<DashboardService['buildManagerDashboard']>>>(cacheKey);
    if (cached) return cached;

    const result = await this.buildManagerDashboard(managerId);
    this.store(cacheKey, result, 60);
    return result;
  }

  private async buildManagerDashboard(managerId: string) {

    const { start, end } = getTodayRange();

    const managerProfile = await this.prisma.managerProfile.findUnique({
      where: { userId: managerId },
      select: {
        pincodes: { select: { pincodeId: true } },
        areas: { select: { areaId: true } },
      },
    });
    const pincodeIds = managerProfile?.pincodes.map((p) => p.pincodeId) ?? [];
    const areaIds = managerProfile?.areas.map((a) => a.areaId) ?? [];

    const workerFilter: {
      pincodeId?: { in: string[] };
      areaId?: { in: string[] };
    } =
      pincodeIds.length > 0
        ? { pincodeId: { in: pincodeIds } }
        : { areaId: { in: areaIds } };

    // Areas assigned to this manager, resolved down to their pincodes — a "today's request"
    // is a booking whose customer address falls in one of those pincodes, newest first.
    const managerAreaPincodes = areaIds.length > 0
      ? (await this.prisma.area.findMany({ where: { id: { in: areaIds } }, select: { pincode: true } })).map((a) => a.pincode)
      : [];

    const [
      assignedWorkers,
      workersCheckedInToday,
      activeTasks,
      pendingApprovalTasks,
      completedTasks,
      leaveBalanceResult,
      attendanceSummaryResult,
      todayRequests,
    ] = await Promise.all([
      this.prisma.user.count({
        where: {
          role: Role.WORKER,
          isActive: true,
          workerProfile: workerFilter,
        },
      }),
      this.prisma.attendance.count({
        where: {
          user: { role: Role.WORKER, workerProfile: workerFilter },
          checkInTime: { gte: start, lt: end },
          status: AttendanceStatus.CHECKED_IN,
        },
      }),
      this.prisma.task.count({
        where: {
          assignedManagerId: managerId,
          status: { in: [TaskStatus.PENDING, TaskStatus.IN_PROGRESS] },
        },
      }),
      this.prisma.task.count({
        where: {
          assignedManagerId: managerId,
          status: TaskStatus.COMPLETED_PENDING_APPROVAL,
        },
      }),
      this.prisma.task.count({
        where: { assignedManagerId: managerId, status: TaskStatus.COMPLETED },
      }),
      // The manager's own leave balance / attendance summary — Available/Used/Remaining and
      // Leave Without Pay Used are always backend-computed, never left for the UI to derive.
      this.leavePolicyService.getBalance(managerId),
      this.attendanceService.getMonthlySummary(managerId, {}),
      managerAreaPincodes.length > 0
        ? this.prisma.booking.findMany({
            where: { createdAt: { gte: start, lt: end }, address: { pincode: { in: managerAreaPincodes } } },
            select: {
              id: true, bookingRef: true, status: true, scheduledAt: true, createdAt: true,
              service: { select: { id: true, name: true } },
              customer: { select: { id: true, name: true, phone: true } },
            },
            orderBy: { createdAt: 'desc' },
          })
        : Promise.resolve([]),
    ]);

    return {
      success: true,
      data: {
        assignedWorkers,
        workersCheckedInToday,
        tasks: {
          active: activeTasks,
          pendingApproval: pendingApprovalTasks,
          completed: completedTasks,
        },
        leaveBalance: leaveBalanceResult.data,
        attendanceSummary: attendanceSummaryResult.data,
        // Today's booking requests in this manager's assigned areas — newest first.
        todayRequests,
      },
    };
  }

  // Not cached — this is the Worker Home screen's attendance source, so it must always read
  // the Attendance table fresh (a stale 60s cache previously caused Home to show "Not Checked
  // In" right after check-in, or after a fresh login, until the cache entry expired).
  async getWorkerDashboard(workerId: string) {
    const { start, end } = getTodayRange();

    const [
      todayAttendance,
      tasksPending,
      tasksActive,
      tasksCompleted,
      tasksPendingApproval,
      leaveBalanceResult,
      attendanceSummaryResult,
    ] = await Promise.all([
      this.prisma.attendance.findFirst({
        where: { userId: workerId, checkInTime: { gte: start, lt: end } },
        orderBy: { checkInTime: 'desc' },
        select: {
          id: true,
          checkInTime: true,
          checkOutTime: true,
          status: true,
        },
      }),
      this.prisma.task.count({
        where: { assignedWorkerId: workerId, status: TaskStatus.PENDING },
      }),
      this.prisma.task.count({
        where: { assignedWorkerId: workerId, status: TaskStatus.IN_PROGRESS },
      }),
      this.prisma.task.count({
        where: { assignedWorkerId: workerId, status: TaskStatus.COMPLETED },
      }),
      this.prisma.task.count({
        where: {
          assignedWorkerId: workerId,
          status: TaskStatus.COMPLETED_PENDING_APPROVAL,
        },
      }),
      // Available/Used/Remaining per leave type + Leave Without Pay Used, and the current
      // month's attendance summary — always backend-computed, never left for the UI to derive.
      this.leavePolicyService.getBalance(workerId),
      this.attendanceService.getMonthlySummary(workerId, {}),
    ]);

    // isCheckedIn is exactly "status is still CHECKED_IN" — a missed checkout now settles to
    // ABSENT (checkOutTime stays null, but the session is closed/terminal, not still open), so
    // checkOutTime-is-null is no longer a safe proxy for "checked in" on its own.
    const isCheckedIn =
      todayAttendance !== null && todayAttendance.status === AttendanceStatus.CHECKED_IN;
    // A missed checkout (ABSENT, checkOutTime still null) is a closed/terminal session with
    // zero working hours — only an actually still-open session accrues duration up to now.
    const workingDuration = !todayAttendance?.checkInTime
      ? null
      : todayAttendance.checkOutTime
        ? Math.floor(
            (todayAttendance.checkOutTime.getTime() - todayAttendance.checkInTime.getTime()) / 1000,
          )
        : isCheckedIn
          ? Math.floor((Date.now() - todayAttendance.checkInTime.getTime()) / 1000)
          : 0;

    return {
      success: true,
      data: {
        attendance: {
          checkedInToday: todayAttendance !== null,
          isCheckedIn,
          currentAttendanceId: todayAttendance?.id ?? null,
          checkInTime: todayAttendance?.checkInTime ?? null,
          checkOutTime: todayAttendance?.checkOutTime ?? null,
          workingDuration,
          status: !todayAttendance
            ? null
            : isCheckedIn
              ? 'CHECKED_IN'
              : todayAttendance.status,
        },
        tasks: {
          pending: tasksPending,
          active: tasksActive,
          pendingApproval: tasksPendingApproval,
          completed: tasksCompleted,
        },
        leaveBalance: leaveBalanceResult.data,
        attendanceSummary: attendanceSummaryResult.data,
      },
    };
  }

  async getSuperAdminDashboard() {
    const cached = this.hit<unknown>('super-admin');
    if (cached) return cached;

    const [
      totalOrganizations,
      totalUsers,
      totalBookings,
      totalInvoices,
      revenueAgg,
      pendingBookings,
      completedBookings,
    ] = await Promise.all([
      this.prisma.organization.count(),
      this.prisma.user.count({ where: { isActive: true } }),
      this.prisma.booking.count(),
      this.prisma.invoice.count({
        where: {
          status: { notIn: [InvoiceStatus.CANCELLED, InvoiceStatus.REFUNDED] },
        },
      }),
      this.prisma.payment.aggregate({
        where: { status: PaymentStatus.SUCCESS },
        _sum: { amount: true },
      }),
      this.prisma.booking.count({ where: { status: BookingStatus.PENDING } }),
      this.prisma.booking.count({ where: { status: BookingStatus.COMPLETED } }),
    ]);

    const result = {
      success: true,
      data: {
        organizations: totalOrganizations,
        users: totalUsers,
        bookings: {
          total: totalBookings,
          pending: pendingBookings,
          completed: completedBookings,
        },
        invoices: totalInvoices,
        revenue: {
          total: parseFloat((revenueAgg._sum.amount ?? 0).toFixed(2)),
        },
      },
    };

    this.store('super-admin', result, 60);
    return result;
  }

  // ─── Cache helpers ────────────────────────────────────────────────────────────

  private hit<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry || entry.expiresAt < Date.now()) {
      this.cache.delete(key);
      return null;
    }
    return entry.data as T;
  }

  private store(key: string, data: unknown, ttlSeconds: number): void {
    this.cache.set(key, { data, expiresAt: Date.now() + ttlSeconds * 1000 });
  }
}
