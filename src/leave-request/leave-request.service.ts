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
  LeaveApprovalLevel,
  LeaveRequestStatus,
  LeaveType,
  Prisma,
} from '@prisma/client';

import { ActivityLogService } from '../activity-log/activity-log.service';
import { AttendanceService } from '../attendance/attendance.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import type { AuthUser } from '../common/types/auth-user.type';
import { LeavePolicyService, PolicyGovernedType } from '../leave-policy/leave-policy.service';
import { PrismaService } from '../prisma/prisma.service';
import { ApplyLeaveDto } from './dto/apply-leave.dto';
import { ApproveLeaveRequestDto } from './dto/approve-leave-request.dto';
import { QueryLeaveRequestsDto } from './dto/query-leave-requests.dto';
import { RejectLeaveRequestDto } from './dto/reject-leave-request.dto';

// One leave request = one day = 1 unit deducted from the requested type's balance.
const LEAVE_REQUEST_DAYS = 1;

// EMERGENCY is not governed by LeavePolicy (see the LeaveType enum comment in schema.prisma)
// — no balance exists for it, so it bypasses the deduction step entirely.
const POLICY_GOVERNED_TYPES = new Set<LeaveType>([LeaveType.CASUAL, LeaveType.SICK, LeaveType.PLANNED]);

const fmtDate = (d: Date) => d.toISOString().split('T')[0];

const REQUEST_INCLUDE = {
  worker: { select: { id: true, name: true, email: true, phone: true, profileImage: true } },
  managerDecidedByUser: { select: { id: true, name: true } },
  adminDecidedByUser: { select: { id: true, name: true } },
} satisfies Prisma.WorkerLeaveRequestInclude;

type PendingRequest = Prisma.WorkerLeaveRequestGetPayload<{
  select: {
    id: true;
    workerId: true;
    type: true;
    date: true;
    status: true;
    currentLevel: true;
    adminApprovalRequired: true;
    managerId: true;
  };
}>;

@Injectable()
export class LeaveRequestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly attendanceService: AttendanceService,
    private readonly leavePolicyService: LeavePolicyService,
    private readonly auditLogs: AuditLogsService,
    private readonly activityLog: ActivityLogService,
  ) {}

  // ─── Worker ───────────────────────────────────────────────────────────────────

  async applyLeave(userId: string, dto: ApplyLeaveDto) {
    await this.assertApplicable(userId, dto);

    const workerProfile = await this.prisma.workerProfile.findUnique({
      where: { userId },
      select: { areaId: true },
    });
    const managerId = await this.resolveManagerUserId(workerProfile?.areaId ?? null);
    const policy = (await this.leavePolicyService.getPolicy()).data;

    const leave = await this.prisma.workerLeaveRequest.create({
      data: {
        workerId: userId,
        date: new Date(dto.date),
        type: dto.type,
        reason: dto.reason,
        managerId,
        currentLevel: LeaveApprovalLevel.MANAGER,
        adminApprovalRequired: policy.requireAdminLeaveApproval,
      },
    });

    this.auditLogs
      .log({
        actorId: userId,
        entityType: 'WorkerLeaveRequest',
        entityId: leave.id,
        action: AuditAction.CREATE,
        newValue: { date: dto.date, type: dto.type },
      })
      .catch(() => {});

    return { success: true, message: 'Leave request submitted', data: this.toLeaveDto(leave) };
  }

  async getMyLeaves(userId: string, status?: LeaveRequestStatus) {
    const leaves = await this.prisma.workerLeaveRequest.findMany({
      where: { workerId: userId, ...(status ? { status } : {}) },
      orderBy: { appliedAt: 'desc' },
    });
    return { success: true, data: leaves.map((l) => this.toLeaveDto(l)) };
  }

  async cancelLeave(userId: string, id: string) {
    const leave = await this.prisma.workerLeaveRequest.findUnique({ where: { id } });
    if (!leave) throw new NotFoundException('Leave request not found');
    if (leave.workerId !== userId) throw new ForbiddenException('This leave request does not belong to you');
    if (leave.status !== LeaveRequestStatus.PENDING) {
      throw new BadRequestException('Only a pending leave request can be cancelled');
    }

    // Nothing to refund — balance is only ever deducted at final approval, never at apply time.
    await this.prisma.workerLeaveRequest.update({
      where: { id },
      data: { status: LeaveRequestStatus.CANCELLED },
    });
    return { success: true, message: 'Leave request cancelled' };
  }

  // ─── Manager (own leave) ──────────────────────────────────────────────────────
  // Reuses the exact same WorkerLeaveRequest model/table as applyLeave() above — a manager's
  // own leave is stored the same way (workerId column holds whichever user actually applied,
  // worker or manager). Differs only in approver resolution: a worker's request starts at
  // MANAGER level via resolveManagerUserId(); a manager has no one above them but ADMIN, so
  // their own request skips straight to ADMIN level (managerId stays null) — it then flows
  // through the existing, unmodified adminList/adminApprove/adminReject endpoints.

  async applyManagerLeave(userId: string, dto: ApplyLeaveDto) {
    await this.assertApplicable(userId, dto);

    const leave = await this.prisma.workerLeaveRequest.create({
      data: {
        workerId: userId,
        date: new Date(dto.date),
        type: dto.type,
        reason: dto.reason,
        managerId: null,
        currentLevel: LeaveApprovalLevel.ADMIN,
        adminApprovalRequired: true,
      },
    });

    this.auditLogs
      .log({
        actorId: userId,
        entityType: 'WorkerLeaveRequest',
        entityId: leave.id,
        action: AuditAction.CREATE,
        newValue: { date: dto.date, type: dto.type },
      })
      .catch(() => {});

    return { success: true, message: 'Leave request submitted', data: this.toLeaveDto(leave) };
  }

  // ─── Manager (team) ───────────────────────────────────────────────────────────

  async managerList(actor: AuthUser, query: QueryLeaveRequestsDto) {
    return this.listRequests(
      { managerId: actor.id, ...(query.status ? { status: query.status } : {}) },
      query,
    );
  }

  async managerDetail(actor: AuthUser, id: string) {
    const request = await this.prisma.workerLeaveRequest.findFirst({
      where: { id, managerId: actor.id },
      include: REQUEST_INCLUDE,
    });
    if (!request) throw new NotFoundException('Leave request not found in your team');
    return this.buildDetail(request);
  }

  async managerApprove(id: string, dto: ApproveLeaveRequestDto, actor: AuthUser) {
    const request = await this.getPendingAtLevel(id, LeaveApprovalLevel.MANAGER);
    if (request.managerId !== actor.id) {
      throw new ForbiddenException('This request is not in your team');
    }

    if (request.adminApprovalRequired) {
      const updated = await this.prisma.workerLeaveRequest.update({
        where: { id: request.id },
        data: {
          managerDecision: LeaveRequestStatus.APPROVED,
          managerDecidedById: actor.id,
          managerDecidedAt: new Date(),
          managerRemark: dto.remark,
          currentLevel: LeaveApprovalLevel.ADMIN,
        },
        include: REQUEST_INCLUDE,
      });
      this.logDecision(actor, request.id, 'approved — escalated to admin');
      return {
        success: true,
        message: 'Approved — escalated to admin for final approval',
        data: this.toLeaveDto(updated),
      };
    }

    return this.finalizeApproval(request, actor, dto.remark, 'manager');
  }

  async managerReject(id: string, dto: RejectLeaveRequestDto, actor: AuthUser) {
    const request = await this.getPendingAtLevel(id, LeaveApprovalLevel.MANAGER);
    if (request.managerId !== actor.id) {
      throw new ForbiddenException('This request is not in your team');
    }
    return this.finalizeRejection(request, actor, dto.remark, 'manager');
  }

  // ─── Admin ────────────────────────────────────────────────────────────────────

  // Defaults to the live pending-approval queue (unchanged from before) when no status is
  // given, but — unlike before — now actually honors an explicit ?status=, the same way
  // managerList already does. Previously this hardcoded status: PENDING unconditionally, so an
  // admin had no way to ever see APPROVED/REJECTED/CANCELLED history — only the current queue.
  async adminList(query: QueryLeaveRequestsDto) {
    return this.listRequests(
      {
        currentLevel: LeaveApprovalLevel.ADMIN,
        status: query.status ?? LeaveRequestStatus.PENDING,
      },
      query,
    );
  }

  async adminApprove(id: string, dto: ApproveLeaveRequestDto, actor: AuthUser) {
    const request = await this.getPendingAtLevel(id, LeaveApprovalLevel.ADMIN);
    return this.finalizeApproval(request, actor, dto.remark, 'admin');
  }

  async adminReject(id: string, dto: RejectLeaveRequestDto, actor: AuthUser) {
    const request = await this.getPendingAtLevel(id, LeaveApprovalLevel.ADMIN);
    return this.finalizeRejection(request, actor, dto.remark, 'admin');
  }

  // ─── Shared helpers ───────────────────────────────────────────────────────────

  private async listRequests(
    where: Prisma.WorkerLeaveRequestWhereInput,
    query: QueryLeaveRequestsDto,
  ) {
    const { page = 1, limit = 20 } = query;
    const skip = (page - 1) * limit;
    const [requests, total] = await this.prisma.$transaction([
      this.prisma.workerLeaveRequest.findMany({
        where,
        include: REQUEST_INCLUDE,
        skip,
        take: limit,
        orderBy: { appliedAt: 'desc' },
      }),
      this.prisma.workerLeaveRequest.count({ where }),
    ]);
    return {
      success: true,
      data: {
        requests: requests.map((r) => this.toLeaveDto(r)),
        meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
      },
    };
  }

  private async buildDetail(
    request: Prisma.WorkerLeaveRequestGetPayload<{ include: typeof REQUEST_INCLUDE }>,
  ) {
    const [attendanceSummary, leaveBalance] = await Promise.all([
      this.attendanceService.getMonthlySummary(request.workerId, {}),
      this.leavePolicyService.getBalance(request.workerId),
    ]);

    return {
      success: true,
      data: {
        workerProfile: {
          id: request.worker.id,
          name: request.worker.name,
          email: request.worker.email,
          phone: request.worker.phone,
          profileImage: request.worker.profileImage,
        },
        attendanceSummary: attendanceSummary.data,
        leaveBalance: leaveBalance.data,
        leaveDetails: this.toLeaveDto(request),
        approvalHistory: {
          manager: request.managerDecidedByUser
            ? {
                decision: request.managerDecision,
                decidedBy: request.managerDecidedByUser,
                decidedAt: request.managerDecidedAt,
                remark: request.managerRemark,
              }
            : null,
          admin: request.adminDecidedByUser
            ? {
                decision: request.adminDecision,
                decidedBy: request.adminDecidedByUser,
                decidedAt: request.adminDecidedAt,
                remark: request.adminRemark,
              }
            : null,
        },
      },
    };
  }

  private async getPendingAtLevel(id: string, level: LeaveApprovalLevel): Promise<PendingRequest> {
    const request = await this.prisma.workerLeaveRequest.findUnique({
      where: { id },
      select: {
        id: true,
        workerId: true,
        type: true,
        date: true,
        status: true,
        currentLevel: true,
        adminApprovalRequired: true,
        managerId: true,
      },
    });
    if (!request) throw new NotFoundException('Leave request not found');
    if (request.status !== LeaveRequestStatus.PENDING || request.currentLevel !== level) {
      throw new BadRequestException(`Request is not pending at the ${level.toLowerCase()} level`);
    }
    return request;
  }

  private async finalizeApproval(
    request: PendingRequest,
    actor: AuthUser,
    remark: string | undefined,
    level: 'manager' | 'admin',
  ) {
    if (POLICY_GOVERNED_TYPES.has(request.type)) {
      await this.leavePolicyService.deductForApprovedLeave(
        request.workerId,
        request.type as PolicyGovernedType,
        LEAVE_REQUEST_DAYS,
        `Leave request approved for ${fmtDate(request.date)}`,
      );
    }

    const updated = await this.prisma.workerLeaveRequest.update({
      where: { id: request.id },
      data: {
        status: LeaveRequestStatus.APPROVED,
        ...(level === 'manager'
          ? {
              managerDecision: LeaveRequestStatus.APPROVED,
              managerDecidedById: actor.id,
              managerDecidedAt: new Date(),
              managerRemark: remark,
            }
          : {
              adminDecision: LeaveRequestStatus.APPROVED,
              adminDecidedById: actor.id,
              adminDecidedAt: new Date(),
              adminRemark: remark,
            }),
      },
      include: REQUEST_INCLUDE,
    });

    this.logDecision(actor, request.id, 'approved');
    return { success: true, message: 'Leave request approved', data: this.toLeaveDto(updated) };
  }

  private async finalizeRejection(
    request: PendingRequest,
    actor: AuthUser,
    remark: string | undefined,
    level: 'manager' | 'admin',
  ) {
    const updated = await this.prisma.workerLeaveRequest.update({
      where: { id: request.id },
      data: {
        status: LeaveRequestStatus.REJECTED,
        ...(level === 'manager'
          ? {
              managerDecision: LeaveRequestStatus.REJECTED,
              managerDecidedById: actor.id,
              managerDecidedAt: new Date(),
              managerRemark: remark,
            }
          : {
              adminDecision: LeaveRequestStatus.REJECTED,
              adminDecidedById: actor.id,
              adminDecidedAt: new Date(),
              adminRemark: remark,
            }),
      },
      include: REQUEST_INCLUDE,
    });

    this.logDecision(actor, request.id, 'rejected');
    return { success: true, message: 'Leave request rejected', data: this.toLeaveDto(updated) };
  }

  private logDecision(actor: AuthUser, requestId: string, outcome: string): void {
    this.auditLogs
      .log({
        actorId: actor.id,
        entityType: 'WorkerLeaveRequest',
        entityId: requestId,
        action: AuditAction.UPDATE,
        newValue: { outcome },
      })
      .catch(() => {});
    this.activityLog.log({
      action: ActivityAction.WORKER_UPDATED,
      module: ActivityModule.WORKER,
      description: `${actor.name} ${outcome} a leave request`,
      actor: { id: actor.id, name: actor.name, role: actor.role },
      target: { id: requestId, type: 'WorkerLeaveRequest' },
    });
  }

  // Shared by applyLeave (worker) and applyManagerLeave (manager) — same validation either way,
  // since both apply onto the same WorkerLeaveRequest table. Rejects a past date and blocks a
  // second request landing on a date that already has a PENDING or APPROVED one (prevents
  // double-applying/overlap for the same day) — neither check existed before. Deliberately does
  // NOT reject for insufficient balance: that's an intentional existing design choice (see
  // deductForApprovedLeave's own comment) — an over-budget request still gets created and is
  // decided normally, any shortfall just settles as Leave Without Pay at approval time, exactly
  // as it already does today. Preserved, not changed.
  private async assertApplicable(userId: string, dto: ApplyLeaveDto): Promise<void> {
    const requestedDate = new Date(dto.date);
    if (isNaN(requestedDate.getTime())) throw new BadRequestException('Invalid date');

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (requestedDate < today) {
      throw new BadRequestException('Cannot apply for leave on a past date');
    }

    const existing = await this.prisma.workerLeaveRequest.findFirst({
      where: {
        workerId: userId,
        date: requestedDate,
        status: { in: [LeaveRequestStatus.PENDING, LeaveRequestStatus.APPROVED] },
      },
      select: { id: true, status: true },
    });
    if (existing) {
      throw new BadRequestException(
        existing.status === LeaveRequestStatus.APPROVED
          ? 'An approved leave request already exists for this date'
          : 'A pending leave request already exists for this date',
      );
    }
  }

  // Same "worker's manager" resolution AttendanceService.resolveManagerUserId /
  // WorkerService.getReportingManager use — first ManagerArea match for the worker's area.
  private async resolveManagerUserId(areaId: string | null): Promise<string | null> {
    if (!areaId) return null;
    const managerArea = await this.prisma.managerArea.findFirst({
      where: { areaId },
      select: { manager: { select: { userId: true } } },
    });
    return managerArea?.manager.userId ?? null;
  }

  private toLeaveDto(leave: {
    id: string;
    date: Date;
    type: string;
    reason: string;
    status: string;
    appliedAt: Date;
    currentLevel?: string;
    adminApprovalRequired?: boolean;
    managerRemark?: string | null;
    adminRemark?: string | null;
  }) {
    return {
      id: leave.id,
      date: fmtDate(leave.date),
      type: leave.type.toLowerCase(),
      reason: leave.reason,
      status: leave.status.toLowerCase(),
      appliedAt: fmtDate(leave.appliedAt),
      ...(leave.currentLevel !== undefined ? { currentLevel: leave.currentLevel } : {}),
      ...(leave.adminApprovalRequired !== undefined ? { adminApprovalRequired: leave.adminApprovalRequired } : {}),
      ...(leave.managerRemark !== undefined ? { managerRemark: leave.managerRemark } : {}),
      ...(leave.adminRemark !== undefined ? { adminRemark: leave.adminRemark } : {}),
    };
  }
}
