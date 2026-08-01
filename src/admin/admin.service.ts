import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  ActivityAction,
  ActivityModule,
  AttendanceStatus,
  BookingStatus,
  InvoiceStatus,
  ManagerEmploymentType,
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
import { AttendanceService } from '../attendance/attendance.service';
import { AuthUser } from '../common/types/auth-user.type';
import { DuplicateCheckService } from '../common/services/duplicate-check.service';
import { toDateOnlyString, getTodayRange } from '../common/utils/date.util';
import { deriveTodayAttendanceStatus } from '../common/utils/attendance-status.util';
import { DashboardService } from '../dashboard/dashboard.service';
import { PrismaService } from '../prisma/prisma.service';
import { ReportsService } from '../reports/reports.service';
import { CreateManagerDto } from './dto/create-manager.dto';
import {
  LiveWorkerStatusFilter,
  QueryLiveWorkersDto,
} from './dto/query-live-workers.dto';
import {
  LiveTrackingRoleFilter,
  LiveTrackingStatusFilter,
  QueryLiveTrackingDto,
} from './dto/query-live-tracking.dto';
import { QueryCustomersDto } from './dto/query-customers.dto';
import { QueryManagersDto } from './dto/query-managers.dto';
import { QueryWorkersDto } from './dto/query-workers.dto';
import { QuerySupportTicketsDto } from './dto/query-support-tickets.dto';
import { UpdateManagerDto } from './dto/update-manager.dto';
import { AnalyticsQueryDto, AnalyticsPeriod } from './dto/analytics-query.dto';
import { UpdateOrgSettingsDto } from './dto/org-settings.dto';
import {
  NOTIFICATION_SETTINGS_DEFAULTS,
  NotificationSettings,
  UpdateNotificationSettingsDto,
} from './dto/notification-settings.dto';
import {
  ATTENDANCE_RULES_DEFAULTS,
  AttendanceRulesData,
  UpdateAttendanceRulesDto,
} from './dto/attendance-rules.dto';
import { UpdateUserStatusDto } from './dto/update-user-status.dto';
import { CreateShiftDto } from './dto/create-shift.dto';
import { UpdateShiftDto } from './dto/update-shift.dto';
import { QueryShiftsDto } from './dto/query-shifts.dto';

const NOTIFICATION_SETTINGS_KEY = 'NOTIFICATION_SETTINGS';

// Keys used in the SystemSetting key-value store
export const SETTING_KEYS = {
  taxPercentage: 'ORG_TAX_PERCENTAGE',
  advancePaymentPercentage: 'ORG_ADVANCE_PAYMENT_PERCENTAGE',
  maxActiveSessions: 'ORG_MAX_ACTIVE_SESSIONS',
} as const;

// Defaults returned when a key has never been written
export const DEFAULTS = {
  taxPercentage: 18,
  advancePaymentPercentage: 20,
  maxActiveSessions: 3,
};

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly activityLog: ActivityLogService,
    private readonly duplicateCheck: DuplicateCheckService,
    private readonly reportsService: ReportsService,
    private readonly attendanceService: AttendanceService,
    private readonly dashboardService: DashboardService,
  ) {}

  // ─── Organization Settings ────────────────────────────────────────────────────

  async getOrgSettings() {
    const rows = await this.prisma.systemSetting.findMany({
      where: { key: { in: Object.values(SETTING_KEYS) } },
      select: { key: true, value: true },
    });

    const map = new Map(rows.map((r) => [r.key, Number(r.value)]));

    return {
      success: true,
      message: 'Settings fetched successfully',
      data: {
        taxPercentage:
          map.get(SETTING_KEYS.taxPercentage) ?? DEFAULTS.taxPercentage,
        advancePaymentPercentage:
          map.get(SETTING_KEYS.advancePaymentPercentage) ??
          DEFAULTS.advancePaymentPercentage,
        maxActiveSessions:
          map.get(SETTING_KEYS.maxActiveSessions) ?? DEFAULTS.maxActiveSessions,
      },
    };
  }

  async updateOrgSettings(dto: UpdateOrgSettingsDto, actor: AuthUser) {
    const ops: Prisma.PrismaPromise<unknown>[] = [];

    const upsert = (key: string, value: number, description: string) =>
      this.prisma.systemSetting.upsert({
        where: { key },
        create: { key, value: String(value), description },
        update: { value: String(value) },
      });

    if (dto.taxPercentage !== undefined) {
      ops.push(
        upsert(
          SETTING_KEYS.taxPercentage,
          dto.taxPercentage,
          'Organization tax percentage (%)',
        ),
      );
    }
    if (dto.advancePaymentPercentage !== undefined) {
      ops.push(
        upsert(
          SETTING_KEYS.advancePaymentPercentage,
          dto.advancePaymentPercentage,
          'Advance payment percentage required at booking (%)',
        ),
      );
    }
    if (dto.maxActiveSessions !== undefined) {
      ops.push(
        upsert(
          SETTING_KEYS.maxActiveSessions,
          dto.maxActiveSessions,
          'Maximum concurrent active sessions per user',
        ),
      );
    }

    if (ops.length > 0) {
      await this.prisma.$transaction(ops);
    }

    const changed: string[] = [];
    if (dto.taxPercentage !== undefined)
      changed.push(`Tax ${dto.taxPercentage}%`);
    if (dto.advancePaymentPercentage !== undefined)
      changed.push(`Advance Payment ${dto.advancePaymentPercentage}%`);
    if (dto.maxActiveSessions !== undefined)
      changed.push(`Max Sessions ${dto.maxActiveSessions}`);

    this.activityLog.log({
      action: ActivityAction.SETTINGS_UPDATED,
      module: ActivityModule.SETTINGS,
      description: `Admin updated organization settings: ${changed.join(', ') || 'no fields changed'}`,
      actor: { id: actor.id, name: actor.name, role: actor.role },
      metadata: dto as Record<string, unknown>,
    });

    const result = await this.getOrgSettings();
    return { ...result, message: 'Settings updated successfully' };
  }

  // ─── Notification Settings ────────────────────────────────────────────────────

  async getNotificationSettings(): Promise<{
    success: boolean;
    data: NotificationSettings;
  }> {
    const row = await this.prisma.systemSetting.findUnique({
      where: { key: NOTIFICATION_SETTINGS_KEY },
      select: { value: true },
    });

    const data: NotificationSettings = row
      ? {
          ...NOTIFICATION_SETTINGS_DEFAULTS,
          ...(JSON.parse(row.value) as Partial<NotificationSettings>),
        }
      : { ...NOTIFICATION_SETTINGS_DEFAULTS };

    return { success: true, data };
  }

  async updateNotificationSettings(
    dto: UpdateNotificationSettingsDto,
    actor: AuthUser,
  ): Promise<{ success: boolean; message: string }> {
    const current = (await this.getNotificationSettings()).data;
    const merged: NotificationSettings = { ...current, ...dto };

    await this.prisma.systemSetting.upsert({
      where: { key: NOTIFICATION_SETTINGS_KEY },
      create: {
        key: NOTIFICATION_SETTINGS_KEY,
        value: JSON.stringify(merged),
        description: 'Admin notification preferences',
      },
      update: { value: JSON.stringify(merged) },
    });

    this.activityLog.log({
      action: ActivityAction.SETTINGS_UPDATED,
      module: ActivityModule.SETTINGS,
      description: 'Admin updated notification settings',
      actor: { id: actor.id, name: actor.name, role: actor.role },
      metadata: dto as Record<string, unknown>,
    });

    return {
      success: true,
      message: 'Notification settings updated successfully.',
    };
  }

  // ─── Attendance Rules (singleton) ────────────────────────────────────────────

  async getAttendanceRules(): Promise<{
    success: boolean;
    data: AttendanceRulesData;
  }> {
    const row = await this.prisma.attendanceRule.findUnique({
      where: { id: 'singleton' },
    });

    const data: AttendanceRulesData = row
      ? {
          officeRadius: row.officeRadius,
          lateAfter: row.lateAfter,
          halfDayAfter: row.halfDayAfter,
          checkOutBefore: row.checkOutBefore,
          minimumWorkingHours: row.minimumWorkingHours,
          autoAbsentTime: row.autoAbsentTime,
          allowOutsideOffice: row.allowOutsideOffice,
          requireSelfie: row.requireSelfie,
          requireLiveLocation: row.requireLiveLocation,
          allowMultipleCheckIn: row.allowMultipleCheckIn,
          enableAttendance: row.enableAttendance,
          weekends: row.weekends,
          requireAdminAttendanceApproval: row.requireAdminAttendanceApproval,
        }
      : { ...ATTENDANCE_RULES_DEFAULTS };

    return { success: true, data };
  }

  async updateAttendanceRules(
    dto: UpdateAttendanceRulesDto,
    actor: AuthUser,
  ): Promise<{ success: boolean; message: string }> {
    const current = (await this.getAttendanceRules()).data;
    const merged: AttendanceRulesData = { ...current, ...dto };

    // Cross-field: lateAfter < halfDayAfter < autoAbsentTime
    if (merged.lateAfter >= merged.halfDayAfter) {
      throw new BadRequestException(
        'lateAfter must be earlier than halfDayAfter',
      );
    }
    if (merged.halfDayAfter >= merged.autoAbsentTime) {
      throw new BadRequestException(
        'halfDayAfter must be earlier than autoAbsentTime',
      );
    }

    await this.prisma.attendanceRule.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton', ...merged },
      update: { ...merged },
    });

    this.activityLog.log({
      action: ActivityAction.ATTENDANCE_UPDATED,
      module: ActivityModule.ATTENDANCE,
      description: 'Admin updated attendance rules',
      actor: { id: actor.id, name: actor.name, role: actor.role },
      metadata: dto as Record<string, unknown>,
    });

    return { success: true, message: 'Attendance rules updated successfully' };
  }

  // ─── Shifts (Admin → Profile → Attendance Rules) ─────────────────────────────
  // Additive alongside the legacy ManagerProfile.shift (WorkShift) enum — that column is
  // untouched. shiftId on ManagerProfile/WorkerProfile is the real, admin-managed shift
  // going forward, used everywhere a hardcoded "Shift A"/"Shift B" would otherwise appear.

  private readonly DEFAULT_SHIFTS: Prisma.ShiftCreateManyInput[] = [
    {
      name: 'Shift A',
      startTime: '08:00',
      endTime: '17:00',
      graceMinutes: 15,
      halfDayHours: 4,
      fullDayHours: 8,
      lateAfterMinutes: 15,
      earlyLeaveMinutes: 15,
      workingDays: [1, 2, 3, 4, 5, 6],
    },
    {
      name: 'Shift B',
      startTime: '10:00',
      endTime: '19:00',
      graceMinutes: 15,
      halfDayHours: 4,
      fullDayHours: 8,
      lateAfterMinutes: 15,
      earlyLeaveMinutes: 15,
      workingDays: [1, 2, 3, 4, 5, 6],
    },
  ];

  // The UI only ever manages these two permanent shifts — they cannot be deleted
  // (createShift/updateShift can still rename other shifts freely; this only guards delete).
  private readonly PERMANENT_SHIFT_NAMES = ['shift a', 'shift b'];

  private isPermanentShiftName(name: string): boolean {
    return this.PERMANENT_SHIFT_NAMES.includes(name.trim().toLowerCase());
  }

  // Backward compatibility: no legacy "Shift A"/"Shift B" data exists anywhere in this schema
  // to migrate (only the WorkShift enum, which has no name/time/grace fields), so per the
  // fallback rule this seeds the two defaults once, the first time shifts are ever read.
  private async ensureDefaultShifts(): Promise<void> {
    const count = await this.prisma.shift.count();
    if (count > 0) return;
    await this.prisma.shift.createMany({ data: this.DEFAULT_SHIFTS });
  }

  // Confirms a shiftId (if provided) references an existing, active Shift. No-op when
  // undefined — shiftId is optional everywhere it's accepted (backward compatible). Not
  // private: reused by ManagerService (createWorker) to avoid duplicating this check.
  async validateShiftId(shiftId: string | undefined): Promise<void> {
    if (shiftId === undefined) return;
    const shift = await this.prisma.shift.findUnique({
      where: { id: shiftId },
      select: { id: true, isActive: true },
    });
    if (!shift) throw new NotFoundException('Shift not found');
    if (!shift.isActive) throw new BadRequestException('Shift is not active');
  }

  private toMinutes(time: string): number {
    const [h, m] = time.split(':').map(Number);
    return h * 60 + m;
  }

  // earlyLeaveBeforeMinutes is an accepted alias for earlyLeaveMinutes on both Create/UpdateShiftDto
  // (some UI payloads use the older name) — canonical field wins if both are sent.
  private resolveEarlyLeaveMinutes(dto: {
    earlyLeaveMinutes?: number;
    earlyLeaveBeforeMinutes?: number;
  }): number | undefined {
    return dto.earlyLeaveMinutes ?? dto.earlyLeaveBeforeMinutes;
  }

  private validateShiftTimes(
    startTime: string,
    endTime: string,
    halfDayHours: number,
    fullDayHours: number,
  ): void {
    if (this.toMinutes(endTime) <= this.toMinutes(startTime)) {
      throw new BadRequestException('endTime must be after startTime');
    }
    if (halfDayHours >= fullDayHours) {
      throw new BadRequestException(
        'halfDayHours must be less than fullDayHours',
      );
    }
  }

  async getShifts(query: QueryShiftsDto) {
    await this.ensureDefaultShifts();

    const { page = 1, limit = 20, search, isActive } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.ShiftWhereInput = {};
    if (isActive !== undefined) where.isActive = isActive;
    if (search) where.name = { contains: search, mode: 'insensitive' };

    const shifts = await this.prisma.shift.findMany({
      where,
      skip,
      take: limit,
      orderBy: { name: 'asc' },
    });

    return { success: true, data: shifts };
  }

  // POST behaves as an upsert keyed on name (case-insensitive): the UI only ever manages
  // the two permanent shifts (Shift A / Shift B), so re-submitting an existing name updates
  // it in place instead of failing with a duplicate-name conflict.
  async createShift(dto: CreateShiftDto, actor: AuthUser) {
    this.validateShiftTimes(
      dto.startTime,
      dto.endTime,
      dto.halfDayHours,
      dto.fullDayHours,
    );

    const existing = await this.prisma.shift.findFirst({
      where: { name: { equals: dto.name, mode: 'insensitive' } },
      select: { id: true },
    });

    const data = {
      name: dto.name,
      startTime: dto.startTime,
      endTime: dto.endTime,
      graceMinutes: dto.graceMinutes ?? 0,
      halfDayHours: dto.halfDayHours,
      fullDayHours: dto.fullDayHours,
      lateAfterMinutes: dto.lateAfterMinutes ?? 0,
      earlyLeaveMinutes: this.resolveEarlyLeaveMinutes(dto) ?? 0,
      workingDays: dto.workingDays,
      isActive: dto.isActive ?? true,
    };

    const shift = existing
      ? await this.prisma.shift.update({ where: { id: existing.id }, data })
      : await this.prisma.shift.create({ data });

    this.activityLog.log({
      action: ActivityAction.ATTENDANCE_UPDATED,
      module: ActivityModule.ATTENDANCE,
      description: `Shift "${shift.name}" ${existing ? 'updated' : 'created'}`,
      actor: { id: actor.id, name: actor.name, role: actor.role },
      target: { id: shift.id, type: 'Shift' },
      metadata: {
        name: shift.name,
        startTime: shift.startTime,
        endTime: shift.endTime,
      },
    });

    return {
      success: true,
      message: existing
        ? 'Shift updated successfully'
        : 'Shift created successfully',
      data: shift,
    };
  }

  async updateShift(id: string, dto: UpdateShiftDto, actor: AuthUser) {
    const current = await this.prisma.shift.findUnique({ where: { id } });
    if (!current) throw new NotFoundException('Shift not found');

    if (
      dto.name !== undefined &&
      dto.name.toLowerCase() !== current.name.toLowerCase()
    ) {
      const dup = await this.prisma.shift.findFirst({
        where: {
          name: { equals: dto.name, mode: 'insensitive' },
          id: { not: id },
        },
        select: { id: true },
      });
      if (dup)
        throw new ConflictException('A shift with this name already exists');
    }

    const startTime = dto.startTime ?? current.startTime;
    const endTime = dto.endTime ?? current.endTime;
    const halfDayHours = dto.halfDayHours ?? current.halfDayHours;
    const fullDayHours = dto.fullDayHours ?? current.fullDayHours;
    this.validateShiftTimes(startTime, endTime, halfDayHours, fullDayHours);

    const earlyLeaveMinutes = this.resolveEarlyLeaveMinutes(dto);

    const updated = await this.prisma.shift.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.startTime !== undefined && { startTime: dto.startTime }),
        ...(dto.endTime !== undefined && { endTime: dto.endTime }),
        ...(dto.graceMinutes !== undefined && {
          graceMinutes: dto.graceMinutes,
        }),
        ...(dto.halfDayHours !== undefined && {
          halfDayHours: dto.halfDayHours,
        }),
        ...(dto.fullDayHours !== undefined && {
          fullDayHours: dto.fullDayHours,
        }),
        ...(dto.lateAfterMinutes !== undefined && {
          lateAfterMinutes: dto.lateAfterMinutes,
        }),
        ...(earlyLeaveMinutes !== undefined && { earlyLeaveMinutes }),
        ...(dto.workingDays !== undefined && { workingDays: dto.workingDays }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
    });

    this.activityLog.log({
      action: ActivityAction.ATTENDANCE_UPDATED,
      module: ActivityModule.ATTENDANCE,
      description: `Shift "${updated.name}" updated`,
      actor: { id: actor.id, name: actor.name, role: actor.role },
      target: { id, type: 'Shift' },
      metadata: dto as Record<string, unknown>,
    });

    return {
      success: true,
      message: 'Shift updated successfully',
      data: updated,
    };
  }

  async updateShiftStatus(
    id: string,
    dto: UpdateUserStatusDto,
    actor: AuthUser,
  ) {
    const current = await this.prisma.shift.findUnique({
      where: { id },
      select: { id: true, name: true },
    });
    if (!current) throw new NotFoundException('Shift not found');

    const updated = await this.prisma.shift.update({
      where: { id },
      data: { isActive: dto.isActive },
    });

    this.activityLog.log({
      action: ActivityAction.ATTENDANCE_UPDATED,
      module: ActivityModule.ATTENDANCE,
      description: `Shift "${current.name}" ${dto.isActive ? 'activated' : 'deactivated'}`,
      actor: { id: actor.id, name: actor.name, role: actor.role },
      target: { id, type: 'Shift' },
    });

    return {
      success: true,
      message: 'Shift status updated successfully',
      data: updated,
    };
  }

  async deleteShift(id: string, actor: AuthUser) {
    const shift = await this.prisma.shift.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        _count: { select: { managerProfiles: true, workerProfiles: true } },
      },
    });
    if (!shift) throw new NotFoundException('Shift not found');

    if (this.isPermanentShiftName(shift.name)) {
      throw new BadRequestException(
        `"${shift.name}" is a permanent shift and cannot be deleted. Update it instead.`,
      );
    }

    const { managerProfiles, workerProfiles } = shift._count;
    if (managerProfiles + workerProfiles > 0) {
      throw new ConflictException(
        `Cannot delete shift — it is assigned to ${managerProfiles} manager(s) and ${workerProfiles} worker(s).`,
      );
    }

    await this.prisma.shift.delete({ where: { id } });

    this.activityLog.log({
      action: ActivityAction.ATTENDANCE_UPDATED,
      module: ActivityModule.ATTENDANCE,
      description: `Shift "${shift.name}" deleted`,
      actor: { id: actor.id, name: actor.name, role: actor.role },
      target: { id, type: 'Shift' },
    });

    return { success: true, message: 'Shift deleted successfully' };
  }

  // ─── Customers (USER role) ────────────────────────────────────────────────────

  async getCustomers(query: QueryCustomersDto) {
    const { page = 1, limit = 20 } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.UserWhereInput = { role: Role.USER };
    if (query.isActive !== undefined) where.isActive = query.isActive;
    if (query.startDate || query.endDate) {
      where.createdAt = {
        ...(query.startDate ? { gte: new Date(query.startDate) } : {}),
        ...(query.endDate ? { lte: new Date(query.endDate) } : {}),
      };
    }
    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { email: { contains: query.search, mode: 'insensitive' } },
        { phone: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const [users, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          profileImage: true,
          isActive: true,
          createdAt: true,
          _count: { select: { customerBookings: true } },
        },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.user.count({ where }),
    ]);

    // Aggregate total spend per customer in one query (avoids N+1)
    const userIds = users.map((u) => u.id);
    const spendRows =
      userIds.length > 0
        ? await this.prisma.invoice.groupBy({
            by: ['customerId'],
            where: { customerId: { in: userIds } },
            _sum: { total: true },
          })
        : [];

    const spendMap = new Map(
      spendRows.map((r) => [r.customerId, r._sum.total ?? 0]),
    );

    const items = users.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      phone: u.phone,
      profileImage: u.profileImage,
      isActive: u.isActive,
      createdAt: u.createdAt,
      totalBookings: u._count.customerBookings,
      totalSpent: spendMap.get(u.id) ?? 0,
    }));

    return {
      success: true,
      message: 'Users fetched successfully',
      data: {
        items,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      },
    };
  }

  async getCustomerById(id: string) {
    const PENDING_STATUSES = [
      BookingStatus.PENDING,
      BookingStatus.CONFIRMED,
      BookingStatus.ASSIGNED,
      BookingStatus.IN_PROGRESS,
      BookingStatus.RESCHEDULED,
    ];

    const [
      user,
      completedBookings,
      cancelledBookings,
      pendingBookings,
      spendResult,
      lastLoginEntry,
    ] = await this.prisma.$transaction([
      this.prisma.user.findFirst({
        where: { id, role: Role.USER },
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          profileImage: true,
          role: true,
          isActive: true,
          emailVerified: true,
          phoneVerified: true,
          createdAt: true,
          updatedAt: true,
          _count: { select: { customerBookings: true } },
          addresses: {
            select: {
              id: true,
              label: true,
              addressType: true,
              houseNo: true,
              street: true,
              landmark: true,
              city: true,
              state: true,
              pincode: true,
              isDefault: true,
            },
            orderBy: { isDefault: 'desc' },
          },
          customerBookings: {
            select: {
              id: true,
              bookingRef: true,
              status: true,
              totalAmount: true,
              createdAt: true,
              service: { select: { name: true } },
            },
            orderBy: { createdAt: 'desc' },
            take: 5,
          },
        },
      }),
      this.prisma.booking.count({
        where: { customerId: id, status: BookingStatus.COMPLETED },
      }),
      this.prisma.booking.count({
        where: { customerId: id, status: BookingStatus.CANCELLED },
      }),
      this.prisma.booking.count({
        where: { customerId: id, status: { in: PENDING_STATUSES } },
      }),
      this.prisma.invoice.aggregate({
        where: { customerId: id },
        _sum: { total: true },
      }),
      this.prisma.activityLog.findFirst({
        where: {
          actorId: id,
          action: {
            in: [
              ActivityAction.USER_LOGIN,
              ActivityAction.MOBILE_LOGIN_SUCCESS,
            ],
          },
        },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      }),
    ]);

    if (!user) throw new NotFoundException('Customer not found');

    return {
      success: true,
      message: 'Customer fetched successfully',
      data: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        profileImage: user.profileImage,
        role: user.role,
        isActive: user.isActive,
        emailVerified: user.emailVerified,
        phoneVerified: user.phoneVerified,
        lastLoginAt: lastLoginEntry?.createdAt ?? null,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,

        totalBookings: user._count.customerBookings,
        completedBookings,
        cancelledBookings,
        pendingBookings,

        totalSpent: spendResult._sum.total ?? 0,

        addresses: user.addresses,

        recentBookings: user.customerBookings.map((b) => ({
          id: b.id,
          bookingNumber: b.bookingRef,
          serviceName: b.service.name,
          status: b.status,
          amount: b.totalAmount ?? 0,
          createdAt: b.createdAt,
        })),
      },
    };
  }

  async updateUserStatus(
    id: string,
    dto: UpdateUserStatusDto,
    actor: AuthUser,
  ) {
    if (id === actor.id) {
      throw new BadRequestException('You cannot deactivate your own account.');
    }

    const target = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, name: true, role: true, isActive: true },
    });
    if (!target) throw new NotFoundException('User not found');

    const isStatusChanging = dto.isActive !== target.isActive;

    // Pre-collect worker IDs to cascade when a MANAGER is toggled
    let workerUserIds: string[] = [];
    if (target.role === Role.MANAGER && isStatusChanging) {
      const managerProfile = await this.prisma.managerProfile.findUnique({
        where: { userId: id },
        select: { id: true },
      });
      if (managerProfile) {
        const managerAreas = await this.prisma.managerArea.findMany({
          where: { managerId: managerProfile.id },
          select: { areaId: true },
        });
        const areaIds = managerAreas.map((ma) => ma.areaId);
        if (areaIds.length > 0) {
          const workerProfiles = await this.prisma.workerProfile.findMany({
            where: { areaId: { in: areaIds } },
            select: { userId: true },
          });
          workerUserIds = workerProfiles.map((wp) => wp.userId);
        }
      }
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.user.update({
        where: { id },
        data: { isActive: dto.isActive },
        select: { id: true, isActive: true },
      });
      if (workerUserIds.length > 0) {
        await tx.user.updateMany({
          where: { id: { in: workerUserIds } },
          data: { isActive: dto.isActive },
        });
      }
      return result;
    });

    const verb = dto.isActive ? 'activated' : 'deactivated';

    // Emit role-specific activity log action
    const primaryAction = this.resolveStatusAction(target.role, dto.isActive);
    this.activityLog.log({
      action: primaryAction,
      module: ActivityModule.USER,
      description: `Admin ${actor.name} ${verb} ${target.role.toLowerCase()} ${target.name}`,
      actor: { id: actor.id, name: actor.name, role: actor.role },
      target: { id, type: 'User' },
      metadata: {
        targetUserId: target.id,
        targetUserName: target.name,
        targetRole: target.role,
        isActive: dto.isActive,
      },
    });

    if (target.role === Role.MANAGER && workerUserIds.length > 0) {
      this.activityLog.log({
        action: dto.isActive
          ? ActivityAction.WORKER_ACTIVATED
          : ActivityAction.WORKER_DEACTIVATED,
        module: ActivityModule.WORKER,
        description: `${workerUserIds.length} worker(s) ${verb} via Manager cascade`,
        actor: { id: actor.id, name: actor.name, role: actor.role },
        metadata: {
          triggeredBy: 'MANAGER_STATUS_CHANGE',
          managerId: id,
          managerName: target.name,
          count: workerUserIds.length,
        },
      });
    }

    return {
      success: true,
      message: 'User status updated successfully',
      data: updated,
    };
  }

  async updateManagerStatus(
    id: string,
    dto: UpdateUserStatusDto,
    actor: AuthUser,
  ) {
    const profile = await this.prisma.managerProfile.findUnique({
      where: { userId: id },
      select: {
        id: true,
        user: { select: { id: true, name: true, isActive: true } },
      },
    });
    if (!profile) throw new NotFoundException('Manager not found');

    // Collect all worker user IDs under this manager's areas
    const managerAreas = await this.prisma.managerArea.findMany({
      where: { managerId: profile.id },
      select: { areaId: true },
    });
    const areaIds = managerAreas.map((ma) => ma.areaId);

    let workerUserIds: string[] = [];
    if (areaIds.length > 0) {
      const workerProfiles = await this.prisma.workerProfile.findMany({
        where: { areaId: { in: areaIds } },
        select: { userId: true },
      });
      workerUserIds = workerProfiles.map((wp) => wp.userId);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.user.update({
        where: { id },
        data: { isActive: dto.isActive },
        select: { id: true, isActive: true },
      });
      if (workerUserIds.length > 0) {
        await tx.user.updateMany({
          where: { id: { in: workerUserIds } },
          data: { isActive: dto.isActive },
        });
      }
      return result;
    });

    const verb = dto.isActive ? 'activated' : 'deactivated';

    this.activityLog.log({
      action: dto.isActive
        ? ActivityAction.MANAGER_ACTIVATED
        : ActivityAction.MANAGER_DEACTIVATED,
      module: ActivityModule.MANAGER,
      description: `${actor.name} ${verb} manager ${profile.user.name}`,
      actor: { id: actor.id, name: actor.name, role: actor.role },
      target: { id, type: 'User' },
      metadata: {
        managerId: id,
        managerName: profile.user.name,
        isActive: dto.isActive,
      },
    });

    if (workerUserIds.length > 0) {
      this.activityLog.log({
        action: dto.isActive
          ? ActivityAction.WORKER_ACTIVATED
          : ActivityAction.WORKER_DEACTIVATED,
        module: ActivityModule.WORKER,
        description: `${workerUserIds.length} worker(s) ${verb} via Manager cascade`,
        actor: { id: actor.id, name: actor.name, role: actor.role },
        metadata: {
          triggeredBy: 'MANAGER_STATUS_CHANGE',
          managerId: id,
          managerName: profile.user.name,
          count: workerUserIds.length,
        },
      });
    }

    return {
      success: true,
      message: 'Manager status updated successfully.',
      data: updated,
    };
  }

  // ─── Stats ───────────────────────────────────────────────────────────────────

  async getStats() {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    monthStart.setHours(0, 0, 0, 0);

    const ACTIVE_STATUSES = [
      BookingStatus.PENDING,
      BookingStatus.CONFIRMED,
      BookingStatus.ASSIGNED,
      BookingStatus.IN_PROGRESS,
    ];

    const [
      revenueThisMonthAgg,
      revenueTotalAgg,
      totalBookings,
      activeBookings,
      totalUsers,
      totalWorkers,
      totalManagers,
    ] = await Promise.all([
      this.prisma.invoice.aggregate({
        where: { status: InvoiceStatus.PAID, createdAt: { gte: monthStart } },
        _sum: { total: true },
      }),
      this.prisma.invoice.aggregate({
        where: { status: InvoiceStatus.PAID },
        _sum: { total: true },
      }),
      this.prisma.booking.count(),
      this.prisma.booking.count({ where: { status: { in: ACTIVE_STATUSES } } }),
      this.prisma.user.count({ where: { role: Role.USER } }),
      this.prisma.user.count({ where: { role: Role.WORKER } }),
      this.prisma.user.count({ where: { role: Role.MANAGER } }),
    ]);

    return {
      success: true,
      data: {
        revenueThisMonth: this.analyticsR2(revenueThisMonthAgg._sum.total ?? 0),
        revenueTotal: this.analyticsR2(revenueTotalAgg._sum.total ?? 0),
        totalBookings,
        activeBookings,
        totalUsers,
        totalWorkers,
        totalManagers,
      },
    };
  }

  // ─── Analytics ────────────────────────────────────────────────────────────────

  async getAnalytics(query: AnalyticsQueryDto) {
    const { start, end } = this.buildAnalyticsDateRange(
      query.period,
      query.startDate,
      query.endDate,
    );
    const dateRange = { gte: start, lte: end };
    const TOP_N = 5;

    const [allBookingDates, topServiceRows, topWorkerRows] = await Promise.all([
      this.prisma.booking.findMany({
        where: { createdAt: dateRange },
        select: { createdAt: true },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.booking.groupBy({
        by: ['serviceId'],
        where: { createdAt: dateRange },
        _count: true,
        orderBy: { _count: { serviceId: 'desc' } },
        take: TOP_N,
      }),
      this.prisma.booking.groupBy({
        by: ['workerId'],
        where: {
          workerId: { not: null },
          status: BookingStatus.COMPLETED,
          createdAt: dateRange,
        },
        _count: true,
        orderBy: { _count: { workerId: 'desc' } },
        take: TOP_N,
      }),
    ]);

    // Booking trend grouped by day
    const trendMap = new Map<string, number>();
    for (const b of allBookingDates) {
      const d = b.createdAt.toISOString().slice(0, 10);
      trendMap.set(d, (trendMap.get(d) ?? 0) + 1);
    }
    const bookings = [...trendMap.entries()].map(([date, count]) => ({
      date,
      count,
    }));

    // Resolve names
    const serviceIds = topServiceRows.map((r) => r.serviceId);
    const workerIds = topWorkerRows.map((r) => r.workerId!).filter(Boolean);

    const [services, workerUsers] = await Promise.all([
      serviceIds.length > 0
        ? this.prisma.service.findMany({
            where: { id: { in: serviceIds } },
            select: { id: true, name: true },
          })
        : Promise.resolve([] as Array<{ id: string; name: string }>),
      workerIds.length > 0
        ? this.prisma.user.findMany({
            where: { id: { in: workerIds } },
            select: { id: true, name: true },
          })
        : Promise.resolve([] as Array<{ id: string; name: string }>),
    ]);

    const serviceNameMap = new Map(services.map((s) => [s.id, s.name]));
    const workerNameMap = new Map(workerUsers.map((u) => [u.id, u.name]));

    const topServices = topServiceRows.map((r) => ({
      id: r.serviceId,
      name: serviceNameMap.get(r.serviceId) ?? '',
      count: r._count,
    }));
    const topWorkers = topWorkerRows.map((r) => ({
      id: r.workerId!,
      name: workerNameMap.get(r.workerId!) ?? '',
      count: r._count,
    }));

    return {
      success: true,
      data: { bookings, topServices, topWorkers },
    };
  }

  // ─── Support Tickets ──────────────────────────────────────────────────────────

  async getSupportTickets(query: QuerySupportTicketsDto) {
    const { page = 1, limit = 20 } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.SupportTicketWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.priority) where.priority = query.priority;
    if (query.startDate || query.endDate) {
      where.createdAt = {
        ...(query.startDate ? { gte: new Date(query.startDate) } : {}),
        ...(query.endDate ? { lte: new Date(query.endDate) } : {}),
      };
    }
    if (query.search) {
      where.OR = [
        { ticketNumber: { contains: query.search, mode: 'insensitive' } },
        { title: { contains: query.search, mode: 'insensitive' } },
        { customer: { name: { contains: query.search, mode: 'insensitive' } } },
      ];
    }

    const [tickets, total] = await Promise.all([
      this.prisma.supportTicket.findMany({
        where,
        select: {
          id: true,
          ticketNumber: true,
          title: true,
          subject: true,
          priority: true,
          status: true,
          closedAt: true,
          createdAt: true,
          customer: { select: { id: true, name: true, phone: true } },
          assignedTo: { select: { id: true, name: true } },
          createdBy: { select: { id: true, name: true } },
        },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.supportTicket.count({ where }),
    ]);

    return {
      success: true,
      data: {
        items: tickets,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      },
    };
  }

  private buildAnalyticsDateRange(
    period?: AnalyticsPeriod,
    startDate?: string,
    endDate?: string,
  ): { start: Date; end: Date } {
    const now = new Date();

    if (period === 'custom' || (!period && (startDate || endDate))) {
      return {
        start: startDate
          ? new Date(startDate)
          : new Date(now.getTime() - 30 * 86_400_000),
        end: endDate ? new Date(endDate) : now,
      };
    }
    if (period === 'today') {
      const start = new Date(now);
      start.setHours(0, 0, 0, 0);
      const end = new Date(now);
      end.setHours(23, 59, 59, 999);
      return { start, end };
    }
    if (period === 'week')
      return { start: new Date(now.getTime() - 7 * 86_400_000), end: now };
    if (period === 'year')
      return { start: new Date(now.getTime() - 365 * 86_400_000), end: now };
    /* month (default) */ return {
      start: new Date(now.getTime() - 30 * 86_400_000),
      end: now,
    };
  }

  private analyticsR2(n: number): number {
    return parseFloat(n.toFixed(2));
  }

  private resolveStatusAction(role: Role, isActive: boolean): ActivityAction {
    if (role === Role.MANAGER) {
      return isActive
        ? ActivityAction.MANAGER_ACTIVATED
        : ActivityAction.MANAGER_DEACTIVATED;
    }
    if (role === Role.WORKER) {
      return isActive
        ? ActivityAction.WORKER_ACTIVATED
        : ActivityAction.WORKER_DEACTIVATED;
    }
    return isActive
      ? ActivityAction.USER_ACTIVATED
      : ActivityAction.USER_DEACTIVATED;
  }

  // ─── Managers ─────────────────────────────────────────────────────────────────

  // Confirms every areaId exists and belongs to at least one of officeLocationIds (via
  // Area.officeLocations). No-op for an empty/undefined areaIds list. Throws distinct 400s
  // for "not found" vs "wrong office" so the client can render a proper validation message.
  private async validateAreasForOffices(
    areaIds: string[] | undefined,
    officeLocationIds: string[],
  ): Promise<void> {
    if (!areaIds || areaIds.length === 0) return;

    const uniqueIds = [...new Set(areaIds)];
    const areas = await this.prisma.area.findMany({
      where: { id: { in: uniqueIds } },
      select: { id: true, officeLocations: { select: { id: true } } },
    });

    const foundIds = new Set(areas.map((a) => a.id));
    const missing = uniqueIds.filter((id) => !foundIds.has(id));
    if (missing.length > 0) {
      throw new BadRequestException(`Area(s) not found: ${missing.join(', ')}`);
    }

    const officeIdSet = new Set(officeLocationIds);
    const notInOffice = areas
      .filter((a) => !a.officeLocations.some((ol) => officeIdSet.has(ol.id)))
      .map((a) => a.id);
    if (notInOffice.length > 0) {
      throw new BadRequestException(
        `Area(s) do not belong to any of the selected office locations: ${notInOffice.join(', ')}`,
      );
    }
  }

  // Normalizes the new officeLocationIds array and the deprecated singular officeLocationId
  // into one array. Returns undefined only when neither field was supplied — callers use that
  // to distinguish "no office change requested" (update) from "invalid payload" (create).
  private resolveOfficeLocationIds(dto: {
    officeLocationIds?: string[];
    officeLocationId?: string;
  }): string[] | undefined {
    if (dto.officeLocationIds !== undefined)
      return [...new Set(dto.officeLocationIds)];
    if (dto.officeLocationId !== undefined) return [dto.officeLocationId];
    return undefined;
  }

  // Prisma returns Decimal fields as a Prisma.Decimal instance — converted to a plain number
  // here so the API response stays consistent with every other numeric field.
  private decimalToNumber(
    value: Prisma.Decimal | number | null | undefined,
  ): number | null {
    if (value === null || value === undefined) return null;
    return Number(value);
  }

  // The flat bankAccountHolder/bankName/bankBranch/bankAccountNumber/bankIfsc/upiId columns
  // are wrapped into a single nested `bankDetails` object for the API response — reused across
  // createManager/updateManager/getManagerById so the shape stays identical everywhere.
  private buildBankDetails(profile: {
    bankAccountHolder: string | null;
    bankName: string | null;
    bankBranch: string | null;
    bankAccountNumber: string | null;
    bankIfsc: string | null;
    upiId: string | null;
  }) {
    return {
      accountHolderName: profile.bankAccountHolder,
      bankName: profile.bankName,
      branchName: profile.bankBranch,
      accountNumber: profile.bankAccountNumber,
      ifscCode: profile.bankIfsc,
      upiId: profile.upiId,
    };
  }

  // monthlySalary structural validation (>0, numeric) lives on the DTO; this only enforces the
  // cross-field "required when MONTHLY" rule, which depends on the resolved employmentType.
  private validateManagerEmploymentDetails(
    employmentType: ManagerEmploymentType | undefined,
    monthlySalary: number | undefined,
  ): void {
    if (
      employmentType === ManagerEmploymentType.MONTHLY &&
      monthlySalary === undefined
    ) {
      throw new BadRequestException(
        'monthlySalary is required when employmentType is MONTHLY',
      );
    }
  }

  async createManager(dto: CreateManagerDto, actor: AuthUser) {
    const { password: _pw, ...loggable } = dto;
    this.logger.log(
      `[createManager] Incoming DTO: ${JSON.stringify(loggable)}`,
    );

    try {
      const email = dto.email.toLowerCase().trim();

      await this.duplicateCheck.ensureUnique({ email, phone: dto.phone });
      this.logger.log(`[createManager] Duplicate check passed`);

      // officeLocationId (legacy, singular) is converted to officeLocationIds: [officeLocationId]
      // when officeLocationIds isn't supplied — kept for backward compatibility.
      const officeLocationIds = this.resolveOfficeLocationIds(dto);
      if (!officeLocationIds || officeLocationIds.length === 0) {
        throw new BadRequestException(
          'At least one office location is required (officeLocationIds)',
        );
      }

      const officeLocationRows = await this.prisma.officeLocation.findMany({
        where: { id: { in: officeLocationIds } },
        select: { id: true, name: true, isActive: true },
      });
      const foundOfficeIds = new Set(officeLocationRows.map((o) => o.id));
      const missingOfficeIds = officeLocationIds.filter(
        (oid) => !foundOfficeIds.has(oid),
      );
      if (missingOfficeIds.length > 0) {
        throw new NotFoundException(
          `Office location(s) not found: ${missingOfficeIds.join(', ')}`,
        );
      }
      const inactiveOfficeIds = officeLocationRows
        .filter((o) => !o.isActive)
        .map((o) => o.id);
      if (inactiveOfficeIds.length > 0) {
        throw new BadRequestException(
          `Office location(s) are inactive: ${inactiveOfficeIds.join(', ')}`,
        );
      }
      this.logger.log(
        `[createManager] Office locations resolved: ${officeLocationRows.map((o) => o.name).join(', ')}`,
      );

      await this.validateAreasForOffices(dto.areaIds, officeLocationIds);
      this.logger.log(
        `[createManager] Area assignment validated: ${JSON.stringify(dto.areaIds ?? [])}`,
      );

      await this.validateShiftId(dto.shiftId);
      this.validateManagerEmploymentDetails(
        dto.employmentType,
        dto.monthlySalary,
      );

      let organization: { id: string; name: string } | null = null;
      if (dto.organizationId) {
        organization = await this.prisma.organization.findUnique({
          where: { id: dto.organizationId },
          select: { id: true, name: true },
        });
        if (!organization) {
          throw new NotFoundException(
            `Organization not found: ${dto.organizationId}`,
          );
        }
      }

      const hashedPassword = await bcrypt.hash(dto.password, 10);
      const employeeCode = `MGR-${randomBytes(3).toString('hex').toUpperCase()}`;

      const { user, profile, assignedAreas, assignedOffices } =
        await this.prisma.$transaction(async (tx) => {
          const created = await tx.user.create({
            data: {
              name: dto.name,
              email,
              phone: dto.phone,
              password: hashedPassword,
              role: Role.MANAGER,
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

          if (organization) {
            await tx.organizationUser.create({
              data: {
                organizationId: organization.id,
                userId: created.id,
                role: Role.MANAGER,
                isActive: true,
              },
            });
          }

          const mgr = await tx.managerProfile.create({
            data: {
              userId: created.id,
              employeeCode,
              officeLocationId: officeLocationIds[0], // primary/legacy single office
              shift: dto.shift,
              shiftId: dto.shiftId,
              gender: dto.gender,
              dateOfBirth: dto.dateOfBirth
                ? new Date(dto.dateOfBirth)
                : undefined,
              address: dto.address,
              salaryType: SalaryType.SALARY,
              employmentType: dto.employmentType,
              monthlySalary: dto.monthlySalary,
              bankAccountHolder: dto.bankDetails?.accountHolderName,
              bankName: dto.bankDetails?.bankName,
              bankBranch: dto.bankDetails?.branchName,
              bankAccountNumber: dto.bankDetails?.accountNumber,
              bankIfsc: dto.bankDetails?.ifscCode,
              upiId: dto.bankDetails?.upiId,
              remarks: dto.remarks,
              aadhaarNumber: dto.aadhaarNumber,
              aadhaarFrontImage: dto.aadhaarFrontImage,
              aadhaarBackImage: dto.aadhaarBackImage,
              panNumber: dto.panNumber,
              panImage: dto.panImage,
            },
            select: {
              id: true,
              employeeCode: true,
              shift: true,
              shiftId: true,
              shiftRef: true,
              gender: true,
              dateOfBirth: true,
              address: true,
              officeLocationId: true,
              officeLocation: { select: { id: true, name: true } },
              employmentType: true,
              monthlySalary: true,
              bankAccountHolder: true,
              bankName: true,
              bankBranch: true,
              bankAccountNumber: true,
              bankIfsc: true,
              upiId: true,
              remarks: true,
              aadhaarNumber: true,
              aadhaarFrontImage: true,
              aadhaarBackImage: true,
              panNumber: true,
              panImage: true,
            },
          });

          await tx.managerOfficeLocation.createMany({
            data: officeLocationIds.map((officeLocationId) => ({
              managerId: mgr.id,
              officeLocationId,
            })),
          });

          let areas: {
            id: string;
            name: string;
            pincode: string;
            city: string;
            state: string;
          }[] = [];
          if (dto.areaIds && dto.areaIds.length > 0) {
            await tx.managerArea.createMany({
              data: dto.areaIds.map((areaId) => ({
                managerId: mgr.id,
                areaId,
              })),
            });
            areas = await tx.area.findMany({
              where: { id: { in: dto.areaIds } },
              select: {
                id: true,
                name: true,
                pincode: true,
                city: true,
                state: true,
              },
            });
          }

          return {
            user: created,
            profile: mgr,
            assignedAreas: areas,
            assignedOffices: officeLocationRows.map((o) => ({
              id: o.id,
              name: o.name,
            })),
          };
        });
      this.logger.log(
        `[createManager] Transaction committed — userId=${user.id} employeeCode=${employeeCode}`,
      );

      this.activityLog.log({
        action: ActivityAction.MANAGER_CREATED,
        module: ActivityModule.MANAGER,
        description: `Manager ${user.name} created`,
        actor: { id: actor.id, name: actor.name, role: actor.role },
        target: { id: user.id, type: 'User' },
        metadata: {
          employeeCode,
          officeLocationIds,
          officeNames: officeLocationRows.map((o) => o.name),
          shift: dto.shift,
          areaIds: dto.areaIds ?? [],
        },
      });

      return {
        success: true,
        message: 'Manager created successfully',
        data: {
          id: user.id,
          name: user.name,
          email: user.email,
          phone: user.phone,
          role: user.role,
          profileImage: user.profileImage,
          isActive: user.isActive,
          createdAt: user.createdAt,
          organizationId: organization?.id ?? null,
          organization,
          employeeCode: profile.employeeCode,
          shift: profile.shift,
          shiftId: profile.shiftId,
          shiftDetails: profile.shiftRef,
          gender: profile.gender ?? null,
          dateOfBirth: toDateOnlyString(profile.dateOfBirth),
          address: profile.address,
          officeLocationId: profile.officeLocationId,
          officeLocation: profile.officeLocation,
          officeLocationIds,
          officeLocations: assignedOffices,
          areaIds: dto.areaIds ?? [],
          assignedAreas,
          areas: assignedAreas,
          employmentType: profile.employmentType,
          monthlySalary: this.decimalToNumber(profile.monthlySalary),
          bankDetails: this.buildBankDetails(profile),
          remarks: profile.remarks,
          aadhaarNumber: profile.aadhaarNumber,
          aadhaarFrontImage: profile.aadhaarFrontImage,
          aadhaarBackImage: profile.aadhaarBackImage,
          panNumber: profile.panNumber,
          panImage: profile.panImage,
        },
      };
    } catch (e) {
      this.logger.error(
        `[createManager] Error: ${(e as Error).message}`,
        (e as Error).stack,
      );
      throw e;
    }
  }

  async getManagers(query: QueryManagersDto) {
    const { page = 1, limit = 20 } = query;
    const skip = (page - 1) * limit;

    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(now);
    todayEnd.setHours(23, 59, 59, 999);

    const userFilter: Prisma.UserWhereInput = {};
    if (query.isActive !== undefined) userFilter.isActive = query.isActive;
    if (query.startDate || query.endDate) {
      userFilter.createdAt = {
        ...(query.startDate ? { gte: new Date(query.startDate) } : {}),
        ...(query.endDate ? { lte: new Date(query.endDate) } : {}),
      };
    }
    if (query.search) {
      userFilter.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { email: { contains: query.search, mode: 'insensitive' } },
        { phone: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const where: Prisma.ManagerProfileWhereInput =
      Object.keys(userFilter).length > 0 ? { user: userFilter } : {};

    const [profiles, total] = await this.prisma.$transaction([
      this.prisma.managerProfile.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              phone: true,
              profileImage: true,
              isActive: true,
              createdAt: true,
              attendances: {
                where: { checkInTime: { gte: todayStart, lte: todayEnd } },
                select: { status: true },
                take: 1,
                orderBy: { checkInTime: 'desc' },
              },
              orgMemberships: {
                where: { isActive: true },
                select: {
                  organizationId: true,
                  organization: { select: { id: true, name: true } },
                },
                take: 1,
              },
            },
          },
          officeLocation: {
            select: { id: true, name: true, latitude: true, longitude: true },
          },
        },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.managerProfile.count({ where }),
    ]);

    // Reuses DashboardService.getManagerDashboard (already computes assignedWorkers /
    // workersCheckedInToday from each manager's pincode/area scope, 60s-cached) rather than
    // re-deriving that resolution logic here.
    const workerCounts = await Promise.all(
      profiles.map((p) => this.dashboardService.getManagerDashboard(p.user.id)),
    );

    const managers = profiles.map((p, i) => {
      const totalWorkers = workerCounts[i].data.assignedWorkers;
      const presentWorkers = workerCounts[i].data.workersCheckedInToday;
      return {
        id: p.user.id,
        name: p.user.name,
        email: p.user.email,
        phone: p.user.phone,
        profileImage: p.user.profileImage,
        organizationId: p.user.orgMemberships[0]?.organizationId ?? null,
        organization: p.user.orgMemberships[0]?.organization ?? null,
        officeLocation: p.officeLocation
          ? { id: p.officeLocation.id, name: p.officeLocation.name }
          : null,
        shift: p.shift,
        isActive: p.user.isActive,
        // PRESENT/NO_CHECKIN are the only two states derivable from today's Attendance row
        // (reused from the same include already fetched above — no extra query). HALF_DAY,
        // LEAVE, and ABSENT are valid values of this field but unreachable until half-day/leave
        // tracking exists in the schema; NO_CHECKIN is used instead of a guessed ABSENT.
        todayAttendanceStatus:
          p.user.attendances.length > 0 ? 'PRESENT' : 'NO_CHECKIN',
        createdAt: p.user.createdAt,
        totalWorkers,
        presentWorkers,
        absentWorkers: Math.max(0, totalWorkers - presentWorkers),
      };
    });

    return {
      success: true,
      data: {
        managers,
        meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
      },
    };
  }

  async updateManager(id: string, dto: UpdateManagerDto, actor: AuthUser) {
    const profile = await this.prisma.managerProfile.findUnique({
      where: { userId: id },
      select: {
        id: true,
        officeLocationId: true,
        user: { select: { id: true, name: true } },
        officeLocations: { select: { officeLocationId: true } },
      },
    });
    if (!profile) throw new NotFoundException('Manager not found');

    if (dto.email !== undefined) {
      dto.email = dto.email.toLowerCase().trim();
    }
    await this.duplicateCheck.ensureUnique({
      email: dto.email,
      phone: dto.phone,
      excludeUserId: id,
    });

    // officeLocationId (legacy, singular) is converted to officeLocationIds: [officeLocationId]
    // when officeLocationIds isn't supplied — kept for backward compatibility.
    // undefined = office assignments untouched; otherwise the array fully replaces them.
    const officeLocationIds = this.resolveOfficeLocationIds(dto);
    let officeLocationRows: { id: string; name: string }[] = [];

    if (officeLocationIds !== undefined) {
      if (officeLocationIds.length === 0) {
        throw new BadRequestException(
          'At least one office location is required when updating office locations',
        );
      }
      const found = await this.prisma.officeLocation.findMany({
        where: { id: { in: officeLocationIds } },
        select: { id: true, name: true, isActive: true },
      });
      const foundIds = new Set(found.map((o) => o.id));
      const missing = officeLocationIds.filter((oid) => !foundIds.has(oid));
      if (missing.length > 0) {
        throw new NotFoundException(
          `Office location(s) not found: ${missing.join(', ')}`,
        );
      }
      const inactive = found.filter((o) => !o.isActive).map((o) => o.id);
      if (inactive.length > 0) {
        throw new BadRequestException(
          `Office location(s) are inactive: ${inactive.join(', ')}`,
        );
      }
      officeLocationRows = found.map((o) => ({ id: o.id, name: o.name }));
    }

    if (dto.areaIds !== undefined) {
      const targetOfficeLocationIds =
        officeLocationIds ??
        profile.officeLocations.map((o) => o.officeLocationId);
      if (dto.areaIds.length > 0 && targetOfficeLocationIds.length === 0) {
        throw new BadRequestException(
          'Manager must have at least one office location assigned before areas can be assigned',
        );
      }
      if (targetOfficeLocationIds.length > 0) {
        await this.validateAreasForOffices(
          dto.areaIds,
          targetOfficeLocationIds,
        );
      }
    }

    await this.validateShiftId(dto.shiftId);
    if (dto.employmentType !== undefined) {
      this.validateManagerEmploymentDetails(
        dto.employmentType,
        dto.monthlySalary,
      );
    }

    const userUpdate: Record<string, unknown> = {};
    if (dto.name !== undefined) userUpdate.name = dto.name;
    if (dto.email !== undefined) userUpdate.email = dto.email;
    if (dto.phone !== undefined) userUpdate.phone = dto.phone;
    if (dto.profileImage !== undefined)
      userUpdate.profileImage = dto.profileImage;
    if (dto.isActive !== undefined) userUpdate.isActive = dto.isActive;

    const profileUpdate: Record<string, unknown> = {};
    if (officeLocationIds !== undefined)
      profileUpdate.officeLocationId = officeLocationIds[0]; // primary/legacy
    if (dto.shift !== undefined) profileUpdate.shift = dto.shift;
    if (dto.shiftId !== undefined) profileUpdate.shiftId = dto.shiftId;
    if (dto.gender !== undefined) profileUpdate.gender = dto.gender;
    if (dto.dateOfBirth !== undefined)
      profileUpdate.dateOfBirth = new Date(dto.dateOfBirth);
    if (dto.address !== undefined) profileUpdate.address = dto.address;
    if (dto.employmentType !== undefined)
      profileUpdate.employmentType = dto.employmentType;
    if (dto.monthlySalary !== undefined)
      profileUpdate.monthlySalary = dto.monthlySalary;
    // Each bankDetails sub-field is checked independently — sending only bankName, for
    // example, must not touch accountNumber/ifscCode/etc. already stored for this manager.
    if (dto.bankDetails?.accountHolderName !== undefined)
      profileUpdate.bankAccountHolder = dto.bankDetails.accountHolderName;
    if (dto.bankDetails?.bankName !== undefined)
      profileUpdate.bankName = dto.bankDetails.bankName;
    if (dto.bankDetails?.branchName !== undefined)
      profileUpdate.bankBranch = dto.bankDetails.branchName;
    if (dto.bankDetails?.accountNumber !== undefined)
      profileUpdate.bankAccountNumber = dto.bankDetails.accountNumber;
    if (dto.bankDetails?.ifscCode !== undefined)
      profileUpdate.bankIfsc = dto.bankDetails.ifscCode;
    if (dto.bankDetails?.upiId !== undefined)
      profileUpdate.upiId = dto.bankDetails.upiId;
    if (dto.remarks !== undefined) profileUpdate.remarks = dto.remarks;
    if (dto.aadhaarNumber !== undefined)
      profileUpdate.aadhaarNumber = dto.aadhaarNumber;
    if (dto.aadhaarFrontImage !== undefined)
      profileUpdate.aadhaarFrontImage = dto.aadhaarFrontImage;
    if (dto.aadhaarBackImage !== undefined)
      profileUpdate.aadhaarBackImage = dto.aadhaarBackImage;
    if (dto.panNumber !== undefined) profileUpdate.panNumber = dto.panNumber;
    if (dto.panImage !== undefined) profileUpdate.panImage = dto.panImage;

    const hasUserChanges = Object.keys(userUpdate).length > 0;
    const hasProfileChanges = Object.keys(profileUpdate).length > 0;

    const USER_SELECT = {
      id: true,
      name: true,
      email: true,
      phone: true,
      profileImage: true,
    } as const;
    const PROFILE_SELECT = {
      shift: true,
      shiftId: true,
      shiftRef: true,
      gender: true,
      dateOfBirth: true,
      address: true,
      officeLocationId: true,
      officeLocation: { select: { id: true, name: true } },
      employmentType: true,
      monthlySalary: true,
      bankAccountHolder: true,
      bankName: true,
      bankBranch: true,
      bankAccountNumber: true,
      bankIfsc: true,
      upiId: true,
      remarks: true,
      aadhaarNumber: true,
      aadhaarFrontImage: true,
      aadhaarBackImage: true,
      panNumber: true,
      panImage: true,
    } as const;
    const AREA_SELECT = {
      id: true,
      name: true,
      pincode: true,
      city: true,
      state: true,
    } as const;
    const OFFICE_SELECT = { id: true, name: true } as const;

    const { updatedUser, updatedProfile, assignedAreas, assignedOffices } =
      await this.prisma.$transaction(async (tx) => {
        const u = hasUserChanges
          ? await tx.user.update({
              where: { id },
              data: userUpdate,
              select: USER_SELECT,
            })
          : await tx.user.findUnique({ where: { id }, select: USER_SELECT });

        const p = hasProfileChanges
          ? await tx.managerProfile.update({
              where: { userId: id },
              data: profileUpdate,
              select: PROFILE_SELECT,
            })
          : await tx.managerProfile.findUnique({
              where: { userId: id },
              select: PROFILE_SELECT,
            });

        if (officeLocationIds !== undefined) {
          // Full replace — mirrors the area-assignment semantics below.
          await tx.managerOfficeLocation.deleteMany({
            where: { managerId: profile.id },
          });
          await tx.managerOfficeLocation.createMany({
            data: officeLocationIds.map((officeLocationId) => ({
              managerId: profile.id,
              officeLocationId,
            })),
          });
        }

        let areas: {
          id: string;
          name: string;
          pincode: string;
          city: string;
          state: string;
        }[];
        if (dto.areaIds !== undefined) {
          // Full replace — matches the same semantics as PUT pincodes/managers/:id
          // (empty array removes all current assignments).
          await tx.managerArea.deleteMany({ where: { managerId: profile.id } });
          if (dto.areaIds.length > 0) {
            await tx.managerArea.createMany({
              data: dto.areaIds.map((areaId) => ({
                managerId: profile.id,
                areaId,
              })),
            });
          }
          areas =
            dto.areaIds.length > 0
              ? await tx.area.findMany({
                  where: { id: { in: dto.areaIds } },
                  select: AREA_SELECT,
                })
              : [];
        } else {
          const current = await tx.managerArea.findMany({
            where: { managerId: profile.id },
            select: { area: { select: AREA_SELECT } },
            orderBy: { createdAt: 'asc' },
          });
          areas = current.map((c) => c.area);
        }

        // Fall back to the legacy single office for managers whose ManagerOfficeLocation
        // rows haven't been backfilled yet (e.g. created before multi-office support existed).
        let offices: { id: string; name: string }[];
        if (officeLocationIds !== undefined) {
          offices = officeLocationRows;
        } else {
          const currentOffices = await tx.managerOfficeLocation.findMany({
            where: { managerId: profile.id },
            select: { officeLocation: { select: OFFICE_SELECT } },
            orderBy: { createdAt: 'asc' },
          });
          offices =
            currentOffices.length > 0
              ? currentOffices.map((c) => c.officeLocation)
              : p!.officeLocation
                ? [p!.officeLocation]
                : [];
        }

        return {
          updatedUser: u!,
          updatedProfile: p!,
          assignedAreas: areas,
          assignedOffices: offices,
        };
      });

    this.activityLog.log({
      action: ActivityAction.MANAGER_UPDATED,
      module: ActivityModule.MANAGER,
      description: `Manager ${profile.user.name} updated by ${actor.name}`,
      actor: { id: actor.id, name: actor.name, role: actor.role },
      target: { id, type: 'User' },
      metadata: dto as Record<string, unknown>,
    });

    return {
      success: true,
      message: 'Manager updated successfully.',
      data: {
        id: updatedUser.id,
        name: updatedUser.name,
        email: updatedUser.email,
        phone: updatedUser.phone,
        officeLocationId: updatedProfile.officeLocationId,
        officeLocation: updatedProfile.officeLocation ?? null,
        officeLocationIds: assignedOffices.map((o) => o.id),
        officeLocations: assignedOffices,
        shift: updatedProfile.shift,
        shiftId: updatedProfile.shiftId,
        shiftDetails: updatedProfile.shiftRef,
        gender: updatedProfile.gender ?? null,
        dateOfBirth: toDateOnlyString(updatedProfile.dateOfBirth),
        address: updatedProfile.address,
        profileImage: updatedUser.profileImage,
        areaIds: assignedAreas.map((a) => a.id),
        assignedAreas,
        areas: assignedAreas,
        employmentType: updatedProfile.employmentType,
        monthlySalary: this.decimalToNumber(updatedProfile.monthlySalary),
        bankDetails: this.buildBankDetails(updatedProfile),
        remarks: updatedProfile.remarks,
        aadhaarNumber: updatedProfile.aadhaarNumber,
        aadhaarFrontImage: updatedProfile.aadhaarFrontImage,
        aadhaarBackImage: updatedProfile.aadhaarBackImage,
        panNumber: updatedProfile.panNumber,
        panImage: updatedProfile.panImage,
      },
    };
  }

  // Splits User.name into firstName/lastName for API consumers that expect them
  // separately. Handles null/empty/single-word names safely.
  private splitName(name: string | null | undefined): {
    firstName: string;
    lastName: string;
  } {
    const trimmed = (name ?? '').trim();
    if (!trimmed) return { firstName: '', lastName: '' };
    const [firstName, ...rest] = trimmed.split(/\s+/);
    return { firstName, lastName: rest.join(' ') };
  }

  async getManagerById(id: string) {
    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(now);
    todayEnd.setHours(23, 59, 59, 999);

    const profile = await this.prisma.managerProfile.findUnique({
      where: { userId: id },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            profileImage: true,
            isActive: true,
            createdAt: true,
            attendances: {
              where: { checkInTime: { gte: todayStart, lte: todayEnd } },
              select: { status: true },
              take: 1,
              orderBy: { checkInTime: 'desc' },
            },
            orgMemberships: {
              where: { isActive: true },
              select: {
                organizationId: true,
                organization: { select: { id: true, name: true } },
              },
              take: 1,
            },
          },
        },
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
        officeLocations: {
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
          },
          orderBy: { createdAt: 'asc' },
        },
        areas: {
          select: {
            area: {
              select: {
                id: true,
                name: true,
                pincode: true,
                city: true,
                state: true,
                officeLocations: { select: { id: true, name: true } },
              },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
        shiftRef: true,
      },
    });

    if (!profile) throw new NotFoundException('Manager not found');

    // Defensive: Prisma always resolves to-many includes as [] (never null/undefined) and
    // the user relation is required — but never assume, and never let a missing/malformed
    // relation crash the response. Every array below defaults to [] rather than throwing.
    const areaRows = profile.areas ?? [];
    const officeLocationRows = profile.officeLocations ?? [];

    // De-duplicated by construction: each ManagerArea/ManagerOfficeLocation row is unique on
    // (managerId, areaId) / (managerId, officeLocationId), so no explicit dedup pass is needed.
    const areas = areaRows
      .map((a) => a?.area)
      .filter((a): a is NonNullable<typeof a> => a != null);
    const areaIds = areas.map((a) => a.id);

    // Fall back to the legacy single office for managers whose ManagerOfficeLocation rows
    // haven't been backfilled yet (e.g. created before multi-office support existed).
    const officeLocations =
      officeLocationRows.length > 0
        ? officeLocationRows
            .map((o) => o?.officeLocation)
            .filter((o): o is NonNullable<typeof o> => o != null)
        : profile.officeLocation
          ? [profile.officeLocation]
          : [];
    const officeLocationIds = officeLocations.map((o) => o.id);

    // Each area may be linked to more than one office (Area.officeLocations); prefer whichever
    // is also one of this manager's own offices, falling back to the area's first linked
    // office if none of the manager's offices match (e.g. a stale/orphaned assignment).
    const ownOfficeIdSet = new Set(officeLocationIds);
    const assignedAreas = areas.map((a) => {
      const areaOffices = a.officeLocations ?? [];
      const matchedOffice =
        areaOffices.find((o) => ownOfficeIdSet.has(o.id)) ??
        areaOffices[0] ??
        null;
      return {
        id: a.id,
        name: a.name,
        pincode: a.pincode,
        city: a.city,
        state: a.state,
        officeLocationId: matchedOffice?.id ?? null,
        officeLocationName: matchedOffice?.name ?? null,
        // officeName duplicates officeLocationName under the field name requested for the new
        // "Assigned Areas" response section — officeLocationName is kept for backward compatibility.
        officeName: matchedOffice?.name ?? null,
      };
    });

    const [
      totalWorkers,
      lastLoginEntry,
      managerReportResult,
      attendanceSummary,
      lastAttendanceEntry,
      teamResult,
    ] = await Promise.all([
      areaIds.length > 0
        ? this.prisma.workerProfile.count({
            where: { areaId: { in: areaIds } },
          })
        : Promise.resolve(0),
      this.prisma.activityLog.findFirst({
        where: {
          actorId: id,
          action: {
            in: [
              ActivityAction.USER_LOGIN,
              ActivityAction.MOBILE_LOGIN_SUCCESS,
            ],
          },
        },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      }),
      // Reuses ReportsService.getManagerReport (already computes completedJobs/pendingJobs via
      // Booking, and now supports filtering to a single managerId) rather than re-querying here.
      this.reportsService.getManagerReport({
        managerId: id,
        page: 1,
        limit: 1,
      }),
      // Reuses AttendanceService.getMonthlySummary (same source powering the worker/manager
      // attendance summary APIs) to derive this month's attendance percentage.
      this.attendanceService.getMonthlySummary(id, {}),
      this.prisma.attendance.findFirst({
        where: { userId: id },
        orderBy: { checkInTime: 'desc' },
        select: { checkInTime: true },
      }),
      // Reuses getWorkers (already scopes by managerId via ManagerArea and computes
      // attendanceStatus/office) rather than re-deriving that join here — full-team lookup,
      // manager teams are small.
      this.getWorkers({ managerId: id, page: 1, limit: 1000 }),
    ]);

    const managerReportItem = managerReportResult.data.items[0] ?? null;
    const attendanceSummaryData = attendanceSummary.data ?? {
      month: null,
      year: null,
      totalDays: 0,
      presentCount: 0,
      absentCount: 0,
      totalHours: 0,
      avgHoursPerDay: 0,
    };
    const { totalDays, presentCount } = attendanceSummaryData;
    const attendancePercentage =
      totalDays > 0 ? Math.round((presentCount / totalDays) * 100) : 0;

    const teamWorkerIds = teamResult.data.workers.map((w) => w.id);
    const teamWorkerProfiles =
      teamWorkerIds.length > 0
        ? await this.prisma.workerProfile.findMany({
            where: { userId: { in: teamWorkerIds } },
            select: {
              userId: true,
              salaryType: true,
              salaryAmount: true,
              commissionPercent: true,
              shiftRef: true,
              area: {
                select: {
                  id: true,
                  name: true,
                  pincode: true,
                  city: true,
                  state: true,
                },
              },
            },
          })
        : [];
    const teamProfileMap = new Map(
      teamWorkerProfiles.map((p) => [p.userId, p]),
    );
    const teamUserImages =
      teamWorkerIds.length > 0
        ? await this.prisma.user.findMany({
            where: { id: { in: teamWorkerIds } },
            select: { id: true, profileImage: true },
          })
        : [];
    const teamImageMap = new Map(
      teamUserImages.map((u) => [u.id, u.profileImage]),
    );

    const workers = teamResult.data.workers.map((w) => {
      const wp = teamProfileMap.get(w.id);
      return {
        id: w.id,
        name: w.name,
        profileImage: teamImageMap.get(w.id) ?? null,
        phone: w.phone,
        office: w.officeLocation ?? null,
        areas: wp?.area ? [wp.area] : [],
        shift: wp?.shiftRef ?? null,
        employmentType: wp?.salaryType ?? null,
        salary: wp?.salaryAmount ?? null,
        commission: wp?.commissionPercent ?? null,
        attendanceStatus: w.attendanceStatus,
      };
    });

    const { firstName, lastName } = this.splitName(profile.user?.name);

    return {
      success: true,
      data: {
        id: profile.user?.id ?? id,
        firstName,
        lastName,
        name: profile.user?.name ?? null,
        email: profile.user?.email ?? null,
        phone: profile.user?.phone ?? null,
        profilePhoto: profile.user?.profileImage ?? null,
        profileImage: profile.user?.profileImage ?? null,
        organizationId: profile.user?.orgMemberships?.[0]?.organizationId ?? null,
        organization: profile.user?.orgMemberships?.[0]?.organization ?? null,
        employeeCode: profile.employeeCode,
        shiftId: profile.shiftId ?? null,
        shiftDetails: profile.shiftRef ?? null,
        gender: profile.gender ?? null,
        dateOfBirth: toDateOnlyString(profile.dateOfBirth),
        address: profile.address ?? null,
        officeLocationId: profile.officeLocationId ?? null,
        officeLocation: profile.officeLocation ?? null,
        officeLocationIds,
        officeLocations,
        area: areas[0] ?? null,
        areaIds,
        assignedAreaIds: areaIds,
        assignedAreas,
        areas,
        shift: profile.shift ?? null,
        isActive: profile.user?.isActive ?? false,
        todayAttendanceStatus:
          (profile.user?.attendances?.length ?? 0) > 0 ? 'Present' : 'Absent',
        totalWorkers,
        createdAt: profile.user?.createdAt ?? null,
        lastLogin: lastLoginEntry?.createdAt ?? null,
        employmentType: profile.employmentType ?? null,
        monthlySalary: this.decimalToNumber(profile.monthlySalary),
        bankDetails: this.buildBankDetails(profile),
        remarks: profile.remarks ?? null,
        aadhaarNumber: profile.aadhaarNumber ?? null,
        aadhaarFrontImage: profile.aadhaarFrontImage ?? null,
        aadhaarBackImage: profile.aadhaarBackImage ?? null,
        panNumber: profile.panNumber ?? null,
        panImage: profile.panImage ?? null,
        // ── Additive, grouped sections below — flat fields above are kept for backward
        // compatibility with existing consumers. ──
        status: (profile.user?.isActive ?? false) ? 'active' : 'inactive',
        updatedAt: profile.updatedAt,
        salary: {
          monthlySalary: this.decimalToNumber(profile.monthlySalary),
          // No ManagerCommission-style table exists (unlike WorkerCommission) — nothing to
          // duplicate-query here; empty until commission-rate storage exists for managers.
          commissionRules: [],
        },
        // Own top-level section (mirrors salary.commissionRules) so "Commission Configuration"
        // is its own clearly-labeled field, matching the Worker profile response shape.
        commission: {
          commissionPercent: null,
          commissionRules: [],
        },
        // Additive alias of `commission` under the exact field name requested by the Manager
        // Profile screen's Employment section (employmentType/monthlySalary/commissionConfiguration).
        commissionConfiguration: {
          commissionPercent: null,
          commissionRules: [],
        },
        aadhaar: {
          number: profile.aadhaarNumber ?? null,
          frontImage: profile.aadhaarFrontImage ?? null,
          backImage: profile.aadhaarBackImage ?? null,
        },
        pan: {
          number: profile.panNumber ?? null,
          image: profile.panImage ?? null,
        },
        statistics: {
          totalWorkers,
          completedJobs: managerReportItem?.completedJobs ?? 0,
          pendingJobs: managerReportItem?.pendingJobs ?? 0,
          attendancePercentage,
          rating: null,
        },
        // Current calendar month only (AttendanceService.getMonthlySummary defaults to the
        // current month when no month/year is passed — never lifetime). halfDay/leave are
        // always 0: no half-day or leave tracking exists anywhere in this schema/service yet.
        attendanceSummary: {
          present: attendanceSummaryData.presentCount,
          absent: attendanceSummaryData.absentCount,
          halfDay: 0,
          leave: 0,
          workingHours: attendanceSummaryData.totalHours,
          attendancePercentage,
        },
        // Additive — explicit alias for statistics' work-related fields, named to match what
        // the Manager Profile screen asks for.
        workSummary: {
          totalWorkers,
          completedJobs: managerReportItem?.completedJobs ?? 0,
          pendingJobs: managerReportItem?.pendingJobs ?? 0,
        },
        lastActivity: {
          lastLogin: lastLoginEntry?.createdAt ?? null,
          lastAttendance: lastAttendanceEntry?.checkInTime ?? null,
        },
        workers,
      },
    };
  }

  // ─── Workers ──────────────────────────────────────────────────────────────────

  async getWorkers(query: QueryWorkersDto) {
    const { page = 1, limit = 20 } = query;
    const skip = (page - 1) * limit;

    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(now);
    todayEnd.setHours(23, 59, 59, 999);

    let rangeStart = todayStart;
    let rangeEnd = todayEnd;
    if (query.startDate || query.endDate) {
      const startSrc = query.startDate ?? query.endDate!;
      const endSrc = query.endDate ?? query.startDate!;
      rangeStart = new Date(startSrc);
      rangeStart.setHours(0, 0, 0, 0);
      rangeEnd = new Date(endSrc);
      rangeEnd.setHours(23, 59, 59, 999);
    }

    // ON_LEAVE / HALF_DAY have no backing data source yet — there's nothing to
    // match, so return an empty page instead of rejecting the request.
    if (query.status === 'ON_LEAVE' || query.status === 'HALF_DAY') {
      return {
        success: true,
        data: { workers: [], meta: { page, limit, total: 0, totalPages: 0 } },
      };
    }

    const where: Prisma.WorkerProfileWhereInput = {};

    if (query.managerId) {
      const managedAreas = await this.prisma.managerArea.findMany({
        where: { manager: { userId: query.managerId } },
        select: { areaId: true },
      });
      let areaIds = managedAreas.map((ma) => ma.areaId);
      if (query.areaId) areaIds = areaIds.filter((id) => id === query.areaId);
      where.areaId = { in: areaIds };
    } else if (query.areaId) {
      where.areaId = query.areaId;
    }

    // Report scope is always active workers — this is never relaxed by a query param.
    const userFilter: Prisma.UserWhereInput = { isActive: true };
    if (query.search) {
      userFilter.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { phone: { contains: query.search, mode: 'insensitive' } },
        {
          workerProfile: {
            employeeCode: { contains: query.search, mode: 'insensitive' },
          },
        },
      ];
    }

    const attendanceDateFilter: Prisma.AttendanceWhereInput = {
      checkInTime: { gte: rangeStart, lte: rangeEnd },
    };
    if (query.officeLocationId)
      attendanceDateFilter.officeLocationId = query.officeLocationId;

    // `status` is the only param allowed to exclude a worker from the report — it's an
    // explicit ask. `officeLocationId` must NOT exclude workers with no matching attendance;
    // it only narrows which attendance row gets left-joined in below (see `include`).
    if (query.status === 'CHECKED_IN') {
      userFilter.attendances = {
        some: { ...attendanceDateFilter, status: AttendanceStatus.CHECKED_IN },
      };
    } else if (query.status === 'CHECKED_OUT') {
      userFilter.attendances = {
        some: { ...attendanceDateFilter, status: AttendanceStatus.CHECKED_OUT },
      };
    } else if (query.status === 'PRESENT') {
      userFilter.attendances = { some: attendanceDateFilter };
    } else if (query.status === 'ABSENT') {
      userFilter.attendances = {
        none: { checkInTime: { gte: rangeStart, lte: rangeEnd } },
      };
    }

    where.user = userFilter;

    const [profiles, total] = await this.prisma.$transaction([
      this.prisma.workerProfile.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              name: true,
              phone: true,
              isActive: true,
              // LEFT JOIN semantics: this `where` only narrows which attendance row is
              // joined onto the worker — it can never exclude the worker row itself
              // (that would happen only if this filter were hoisted onto `where.user`).
              attendances: {
                where: attendanceDateFilter,
                select: {
                  status: true,
                  checkInTime: true,
                  checkOutTime: true,
                  officeLocation: { select: { id: true, name: true } },
                },
                take: 1,
                orderBy: { checkInTime: 'desc' },
              },
            },
          },
        },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.workerProfile.count({ where }),
    ]);

    // Bulk-fetch area → manager mapping (no N+1)
    const areaIds = [
      ...new Set(
        profiles.map((p) => p.areaId).filter((id): id is string => id !== null),
      ),
    ];

    const areaManagerMap = new Map<string, { id: string; name: string }>();
    if (areaIds.length > 0) {
      const managerAreas = await this.prisma.managerArea.findMany({
        where: { areaId: { in: areaIds } },
        select: {
          areaId: true,
          manager: { select: { user: { select: { id: true, name: true } } } },
        },
        orderBy: { createdAt: 'asc' },
      });
      for (const ma of managerAreas) {
        if (!areaManagerMap.has(ma.areaId)) {
          areaManagerMap.set(ma.areaId, {
            id: ma.manager.user.id,
            name: ma.manager.user.name,
          });
        }
      }
    }

    const formatTime = (d: Date) =>
      `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    const formatDuration = (ms: number) => {
      const totalMinutes = Math.max(0, Math.floor(ms / 60_000));
      const hours = Math.floor(totalMinutes / 60);
      const minutes = totalMinutes % 60;
      return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
    };

    const workers = profiles.map((p) => {
      const attendance = p.user.attendances[0] ?? null;

      let attendanceStatus: string;
      if (!attendance) {
        attendanceStatus = 'ABSENT';
      } else if (attendance.status === AttendanceStatus.CHECKED_IN) {
        attendanceStatus = 'CHECKED_IN';
      } else {
        attendanceStatus = 'CHECKED_OUT';
      }

      const workingHours = attendance
        ? formatDuration(
            (attendance.checkOutTime ?? now).getTime() -
              attendance.checkInTime.getTime(),
          )
        : '00:00';

      return {
        id: p.user.id,
        // WorkerProfile's own primary key — distinct from `id` (the User id, kept for
        // backward compatibility since ManagerService.getWorkerList and other joins already
        // key off `id` as the user id). Use this when the WorkerProfile row itself is needed.
        workerId: p.id,
        employeeCode: p.employeeCode,
        name: p.user.name,
        phone: p.user.phone,
        officeLocation: attendance?.officeLocation ?? null,
        manager: p.areaId ? (areaManagerMap.get(p.areaId) ?? null) : null,
        attendanceStatus,
        todayAttendanceStatus: attendance ? 'Present' : 'Absent',
        checkInTime: attendance ? formatTime(attendance.checkInTime) : null,
        checkOutTime: attendance?.checkOutTime
          ? formatTime(attendance.checkOutTime)
          : null,
        workingHours,
        isActive: p.user.isActive,
      };
    });

    return {
      success: true,
      data: {
        workers,
        meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
      },
    };
  }

  async getWorkerById(id: string) {
    // Matches on either the worker's User id (the `id` field returned by getWorkers/other
    // worker endpoints — kept for backward compatibility) or the WorkerProfile's own primary
    // key (the `workerId` field) — never on employeeCode. Either way this ultimately searches
    // the WorkerProfile table (the "Worker" table) for the matching row.
    const profile = await this.prisma.user.findFirst({
      where: {
        role: Role.WORKER,
        OR: [{ id }, { workerProfile: { id } }],
      },
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
    });

    if (!profile) throw new NotFoundException('Worker not found');

    const [attendanceSummary, reportResult, todayAttendance] =
      await Promise.all([
        this.attendanceService.getMonthlySummary(profile.id, {}),
        this.reportsService.getWorkerReport({
          workerId: profile.id,
          page: 1,
          limit: 1,
        }),
        // Reuses AttendanceService.getTodayAttendance — single-entity lookup, not a loop, so
        // no N+1 risk.
        this.attendanceService.getTodayAttendance(profile.id),
      ]);

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
        id: profile.id,
        workerId: profile.workerProfile?.id ?? null,
        employeeCode: profile.workerProfile?.employeeCode ?? null,
        profileImage: profile.profileImage ?? null,
        name: profile.name,
        email: profile.email ?? null,
        phone: profile.phone,
        gender: profile.workerProfile?.gender ?? null,
        dateOfBirth: toDateOnlyString(profile.workerProfile?.dateOfBirth),
        address: profile.workerProfile?.address ?? null,
        isActive: profile.isActive,
        createdAt: profile.createdAt,
        todayAttendanceStatus: deriveTodayAttendanceStatus(
          !!todayAttendance.data,
        ),
        officeLocationIds: officeLocations.map((o) => o.id),
        officeLocations,
        assignedAreaIds: area ? [area.id] : [],
        assignedAreas: area ? [area] : [],
        shiftId: profile.workerProfile?.shiftId ?? null,
        shift: profile.workerProfile?.shiftRef ?? null,
        employmentType: profile.workerProfile?.salaryType ?? null,
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
        bankDetails,
        aadhaar: {
          number: profile.workerProfile?.aadhaarNumber ?? null,
          frontImage: profile.workerProfile?.aadhaarFrontImage ?? null,
          backImage: profile.workerProfile?.aadhaarBackImage ?? null,
        },
        pan: {
          number: profile.workerProfile?.panNumber ?? null,
          image: profile.workerProfile?.panImage ?? null,
        },
        remarks: profile.workerProfile?.remark ?? null,
        statistics: {
          completedJobs: earningsRow?.completedJobs ?? 0,
          pendingJobs: earningsRow?.pendingJobs ?? 0,
          attendancePercentage,
          rating: null,
        },
        attendanceSummary: attendanceSummaryData,
      },
    };
  }

  // ─── Live Worker Tracking ────────────────────────────────────────────────────

  async getLiveWorkers(query: QueryLiveWorkersDto) {
    const {
      status = 'all',
      officeLocationId,
      managerId,
      page = 1,
      limit = 20,
    } = query;

    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(now);
    todayEnd.setHours(23, 59, 59, 999);
    const FIVE_MINUTES_MS = 5 * 60 * 1000;

    const where: Prisma.WorkerProfileWhereInput = { user: { isActive: true } };

    if (managerId) {
      const managedAreas = await this.prisma.managerArea.findMany({
        where: { manager: { userId: managerId } },
        select: { areaId: true },
      });
      where.areaId = { in: managedAreas.map((ma) => ma.areaId) };
    }

    if (officeLocationId) {
      where.user = {
        isActive: true,
        attendances: {
          some: {
            checkInTime: { gte: todayStart, lte: todayEnd },
            officeLocationId,
          },
        },
      };
    }

    // Single query, no N+1: today's latest attendance (with office coords) and any
    // in-progress task are both pulled inline per worker.
    const profiles = await this.prisma.workerProfile.findMany({
      where,
      select: {
        id: true,
        user: {
          select: {
            id: true,
            name: true,
            phone: true,
            attendances: {
              where: { checkInTime: { gte: todayStart, lte: todayEnd } },
              select: {
                status: true,
                checkInLatitude: true,
                checkInLongitude: true,
                checkOutLatitude: true,
                checkOutLongitude: true,
                updatedAt: true,
                officeLocation: { select: { latitude: true, longitude: true } },
              },
              take: 1,
              orderBy: { checkInTime: 'desc' },
            },
            assignedTasks: {
              where: { status: TaskStatus.IN_PROGRESS },
              select: { title: true },
              take: 1,
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const allWorkers = profiles.map((p) => {
      const attendance = p.user.attendances[0] ?? null;
      const activeTask = p.user.assignedTasks[0] ?? null;

      let liveStatus: Exclude<LiveWorkerStatusFilter, 'all'>;
      if (!attendance || attendance.status === AttendanceStatus.CHECKED_OUT) {
        liveStatus = 'offline';
      } else if (
        now.getTime() - attendance.updatedAt.getTime() >
        FIVE_MINUTES_MS
      ) {
        liveStatus = 'offline';
      } else if (activeTask) {
        liveStatus = 'active';
      } else {
        liveStatus = 'free';
      }

      const latitude = attendance
        ? (attendance.checkOutLatitude ?? attendance.checkInLatitude)
        : null;
      const longitude = attendance
        ? (attendance.checkOutLongitude ?? attendance.checkInLongitude)
        : null;

      return {
        id: p.user.id,
        name: p.user.name,
        phone: p.user.phone,
        status: liveStatus,
        currentJob: activeTask?.title ?? null,
        currentLocation:
          latitude !== null && longitude !== null
            ? { latitude, longitude }
            : null,
        lastUpdated: attendance ? attendance.updatedAt.toISOString() : null,
        distanceFromOffice:
          attendance?.officeLocation && latitude !== null && longitude !== null
            ? this.haversineKm(
                latitude,
                longitude,
                attendance.officeLocation.latitude,
                attendance.officeLocation.longitude,
              )
            : null,
        isAvailable: liveStatus === 'free',
      };
    });

    const filtered =
      status === 'all'
        ? allWorkers
        : allWorkers.filter((w) => w.status === status);

    const total = filtered.length;
    const skip = (page - 1) * limit;
    const workers = filtered.slice(skip, skip + limit);

    return {
      success: true,
      message: 'Live workers fetched successfully',
      data: {
        workers,
        meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
      },
    };
  }

  // ─── Live Tracking (Admin + reused by Manager) ───────────────────────────────
  // Distinct from getLiveWorkers above (different response shape/status vocabulary, kept
  // untouched for backward compatibility) — reuses the same Attendance-based "no separate
  // live-GPS store" approach and the same 5-minute freshness window concept.

  private readonly LOCATION_FRESHNESS_MS = 5 * 60 * 1000;

  private async resolveManagerAreaIds(managerId: string): Promise<string[]> {
    const managedAreas = await this.prisma.managerArea.findMany({
      where: { manager: { userId: managerId } },
      select: { areaId: true },
    });
    return managedAreas.map((ma) => ma.areaId);
  }

  private buildTrackingRecord(
    u: {
      id: string;
      name: string;
      profileImage: string | null;
      phone: string;
      role: Role;
      attendances: {
        status: AttendanceStatus;
        checkInTime: Date;
        checkOutTime: Date | null;
        checkInLatitude: number;
        checkInLongitude: number;
        checkOutLatitude: number | null;
        checkOutLongitude: number | null;
        updatedAt: Date;
      }[];
      currentJob: { id: string; status: string; title: string | null } | null;
      officeId: string | null;
      areaId: string | null;
      office: { id: string; name: string } | null;
      area: { id: string; name: string } | null;
      shift: unknown;
      employmentStatus: string | null;
    },
    now: Date,
  ) {
    const attendance = u.attendances[0] ?? null;
    const { start: todayStart, end: todayEnd } = getTodayRange();
    const isToday =
      !!attendance &&
      attendance.checkInTime >= todayStart &&
      attendance.checkInTime < todayEnd;

    let attendanceStatus: 'PRESENT' | 'CHECKED_OUT' | 'NOT_CHECKED_IN';
    if (isToday && attendance.status === AttendanceStatus.CHECKED_IN) {
      attendanceStatus = 'PRESENT';
    } else if (isToday && attendance.status === AttendanceStatus.CHECKED_OUT) {
      attendanceStatus = 'CHECKED_OUT';
    } else {
      // No attendance today (whether or not one exists from an earlier day) — this schema
      // has no separate leave/absence record, so ABSENT is never distinguishable from this.
      attendanceStatus = 'NOT_CHECKED_IN';
    }

    const lastLatitude = attendance
      ? (attendance.checkOutLatitude ?? attendance.checkInLatitude)
      : null;
    const lastLongitude = attendance
      ? (attendance.checkOutLongitude ?? attendance.checkInLongitude)
      : null;
    const lastLocationTime = attendance ? attendance.updatedAt : null;

    const isFresh = attendance
      ? now.getTime() - attendance.updatedAt.getTime() <=
        this.LOCATION_FRESHNESS_MS
      : false;

    let trackingStatus: LiveTrackingStatusFilter;
    let gpsEnabled: boolean;
    if (
      attendanceStatus === 'PRESENT' &&
      isFresh &&
      lastLatitude !== null &&
      lastLongitude !== null
    ) {
      trackingStatus = 'LIVE';
      gpsEnabled = true;
    } else if (attendanceStatus === 'PRESENT') {
      // Checked in, but no fresh GPS fix — device GPS off/unreachable or location timed out.
      trackingStatus = 'CHECKED_IN';
      gpsEnabled = false;
    } else {
      trackingStatus = 'OFFLINE';
      gpsEnabled = false;
    }

    return {
      id: u.id,
      name: u.name,
      profileImage: u.profileImage,
      phone: u.phone,
      // No such field exists anywhere in this schema yet — always null until a dedicated
      // WhatsApp number is captured.
      whatsappNumber: null,
      role: u.role,
      employmentStatus: u.employmentStatus,
      attendanceStatus,
      trackingStatus,
      // Unified best-available position (same value as lastKnownLatitude/Longitude below,
      // regardless of freshness) — additive alongside the existing current*/lastKnown* pair
      // for backward compatibility.
      latitude: lastLatitude,
      longitude: lastLongitude,
      currentLatitude: trackingStatus === 'LIVE' ? lastLatitude : null,
      currentLongitude: trackingStatus === 'LIVE' ? lastLongitude : null,
      lastKnownLatitude: lastLatitude,
      lastKnownLongitude: lastLongitude,
      lastLocationTime,
      gpsEnabled,
      currentJobId: u.currentJob?.id ?? null,
      currentJobStatus: u.currentJob?.status ?? null,
      currentJob: u.currentJob
        ? {
            id: u.currentJob.id,
            status: u.currentJob.status,
            title: u.currentJob.title,
          }
        : null,
      officeId: u.officeId,
      areaId: u.areaId,
      office: u.office,
      area: u.area,
      shift: u.shift,
    };
  }

  private async fetchWorkerTrackingRecords(
    filters: { officeLocationId?: string; managerId?: string },
    now: Date,
  ) {
    const where: Prisma.WorkerProfileWhereInput = { user: { isActive: true } };
    let areaIds: string[] | undefined;

    if (filters.managerId) {
      areaIds = await this.resolveManagerAreaIds(filters.managerId);
    }
    if (filters.officeLocationId) {
      const areasForOffice = await this.prisma.area.findMany({
        where: { officeLocations: { some: { id: filters.officeLocationId } } },
        select: { id: true },
      });
      const officeAreaIds = areasForOffice.map((a) => a.id);
      areaIds = areaIds
        ? areaIds.filter((id) => officeAreaIds.includes(id))
        : officeAreaIds;
    }
    if (areaIds) where.areaId = { in: areaIds };

    // Single query, no N+1 — mirrors getLiveWorkers' nested-select approach, but without a
    // today-only date filter so the same row also serves as "last known" for OFFLINE workers.
    const profiles = await this.prisma.workerProfile.findMany({
      where,
      select: {
        areaId: true,
        salaryType: true,
        shiftRef: true,
        area: {
          select: {
            id: true,
            name: true,
            officeLocations: { select: { id: true, name: true }, take: 1 },
          },
        },
        user: {
          select: {
            id: true,
            name: true,
            profileImage: true,
            phone: true,
            role: true,
            attendances: {
              select: {
                status: true,
                checkInTime: true,
                checkOutTime: true,
                checkInLatitude: true,
                checkInLongitude: true,
                checkOutLatitude: true,
                checkOutLongitude: true,
                updatedAt: true,
              },
              take: 1,
              orderBy: { checkInTime: 'desc' },
            },
            assignedTasks: {
              where: { status: TaskStatus.IN_PROGRESS },
              select: { id: true, status: true, title: true },
              take: 1,
            },
          },
        },
      },
    });

    return profiles.map((p) =>
      this.buildTrackingRecord(
        {
          ...p.user,
          currentJob: p.user.assignedTasks[0] ?? null,
          officeId: p.area?.officeLocations[0]?.id ?? null,
          areaId: p.areaId,
          // Worker and manager records now share the identical structure — office/area/shift
          // are resolved here the same way as for managers (area's own office, take 1).
          office: p.area?.officeLocations[0] ?? null,
          area: p.area ? { id: p.area.id, name: p.area.name } : null,
          shift: p.shiftRef,
          employmentStatus: p.salaryType,
        },
        now,
      ),
    );
  }

  private async fetchManagerTrackingRecords(
    filters: { officeLocationId?: string },
    now: Date,
  ) {
    const where: Prisma.ManagerProfileWhereInput = { user: { isActive: true } };
    if (filters.officeLocationId) {
      where.OR = [
        { officeLocationId: filters.officeLocationId },
        {
          officeLocations: {
            some: { officeLocationId: filters.officeLocationId },
          },
        },
      ];
    }

    // Managers are never assigned a Task themselves (only workers execute jobs) — currentJob
    // is always null for MANAGER role records.
    const profiles = await this.prisma.managerProfile.findMany({
      where,
      select: {
        officeLocationId: true,
        officeLocation: { select: { id: true, name: true } },
        // Prefers the multi-office join (officeLocations) over the legacy singular
        // officeLocationId/officeLocation — same "primary office" fallback used elsewhere
        // (e.g. AdminService.getManagerById) for managers not yet backfilled onto it.
        officeLocations: {
          select: { officeLocation: { select: { id: true, name: true } } },
          take: 1,
          orderBy: { createdAt: 'asc' },
        },
        areas: {
          select: { area: { select: { id: true, name: true } } },
          take: 1,
          orderBy: { createdAt: 'asc' },
        },
        shiftRef: true,
        employmentType: true,
        user: {
          select: {
            id: true,
            name: true,
            profileImage: true,
            phone: true,
            role: true,
            attendances: {
              select: {
                status: true,
                checkInTime: true,
                checkOutTime: true,
                checkInLatitude: true,
                checkInLongitude: true,
                checkOutLatitude: true,
                checkOutLongitude: true,
                updatedAt: true,
              },
              take: 1,
              orderBy: { checkInTime: 'desc' },
            },
          },
        },
      },
    });

    return profiles.map((p) => {
      const office =
        p.officeLocations[0]?.officeLocation ?? p.officeLocation ?? null;
      const area = p.areas[0]?.area ?? null;
      return this.buildTrackingRecord(
        {
          ...p.user,
          currentJob: null,
          officeId: office?.id ?? null,
          areaId: area?.id ?? null,
          office,
          area,
          shift: p.shiftRef,
          employmentStatus: p.employmentType,
        },
        now,
      );
    });
  }

  async getLiveTracking(query: QueryLiveTrackingDto) {
    const {
      role = 'BOTH',
      status,
      officeLocationId,
      managerId,
      page = 1,
      limit = 20,
    } = query;
    const now = new Date();

    const roleFilter: LiveTrackingRoleFilter = role;
    const [workerRecords, managerRecords] = await Promise.all([
      roleFilter === 'WORKER' || roleFilter === 'BOTH'
        ? this.fetchWorkerTrackingRecords({ officeLocationId, managerId }, now)
        : Promise.resolve([]),
      // managerId only ever scopes workers (a manager's own team) — it has no meaning when
      // fetching manager records themselves.
      roleFilter === 'MANAGER' || roleFilter === 'BOTH'
        ? this.fetchManagerTrackingRecords({ officeLocationId }, now)
        : Promise.resolve([]),
    ]);

    let all = [...workerRecords, ...managerRecords];
    if (status) all = all.filter((r) => r.trackingStatus === status);

    const total = all.length;
    const skip = (page - 1) * limit;
    const records = all.slice(skip, skip + limit);

    return {
      success: true,
      data: {
        records,
        meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
      },
    };
  }

  private haversineKm(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number,
  ): number {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return Math.round(R * c * 100) / 100;
  }
}
