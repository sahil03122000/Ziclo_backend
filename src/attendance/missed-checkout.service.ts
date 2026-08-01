import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ActivityAction,
  ActivityModule,
  AttendanceStatus,
  AuditAction,
  CheckoutStatus,
  MissedCheckoutApprovalLevel,
  MissedCheckoutRequestStatus,
  Prisma,
} from '@prisma/client';

import { ActivityLogService } from '../activity-log/activity-log.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import type { AuthUser } from '../common/types/auth-user.type';
import { LeavePolicyService } from '../leave-policy/leave-policy.service';
import { PrismaService } from '../prisma/prisma.service';
import { AttendanceService } from './attendance.service';
import { ApproveMissedCheckoutRequestDto } from './dto/approve-missed-checkout-request.dto';
import { QueryMissedCheckoutRequestsDto } from './dto/query-missed-checkout-requests.dto';
import { RejectMissedCheckoutRequestDto } from './dto/reject-missed-checkout-request.dto';
import { ResubmitMissedCheckoutRequestDto } from './dto/resubmit-missed-checkout-request.dto';

const REQUEST_INCLUDE = {
  attendance: {
    select: {
      id: true,
      userId: true,
      checkInTime: true,
      checkOutTime: true,
      status: true,
      officeLocationId: true,
      officeLocation: { select: { id: true, name: true } },
    },
  },
  requestedByUser: { select: { id: true, name: true, role: true } },
  managerUser: { select: { id: true, name: true } },
  managerDecidedByUser: { select: { id: true, name: true } },
  adminDecidedByUser: { select: { id: true, name: true } },
} satisfies Prisma.MissedCheckoutRequestInclude;

type PendingRequest = Prisma.MissedCheckoutRequestGetPayload<{
  include: {
    attendance: {
      select: {
        id: true;
        userId: true;
        checkInTime: true;
        officeLocationId: true;
      };
    };
  };
}>;

@Injectable()
export class MissedCheckoutService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly attendanceService: AttendanceService,
    private readonly leavePolicyService: LeavePolicyService,
    private readonly auditLogs: AuditLogsService,
    private readonly activityLog: ActivityLogService,
  ) {}

  // ─── Worker ───────────────────────────────────────────────────────────────────

  // The request itself is auto-created by AttendanceService.markMissedCheckout the moment an
  // attendance row is flagged as a missed checkout — this only fills in / edits the
  // reason/evidence/requestedCheckOutTime while it's still awaiting a decision.
  async resubmit(
    attendanceId: string,
    dto: ResubmitMissedCheckoutRequestDto,
    actor: AuthUser,
  ) {
    const request = await this.prisma.missedCheckoutRequest.findUnique({
      where: { attendanceId },
      include: { attendance: { select: { id: true, userId: true, checkInTime: true } } },
    });
    if (!request) {
      throw new NotFoundException('No missed checkout request exists for this attendance record');
    }
    if (request.attendance.userId !== actor.id) {
      throw new ForbiddenException('You can only edit your own missed checkout request');
    }
    if (request.status !== MissedCheckoutRequestStatus.PENDING) {
      throw new BadRequestException(
        'This request has already been decided and can no longer be edited',
      );
    }

    let requestedCheckOutTime: Date | undefined;
    if (dto.requestedCheckOutTime) {
      requestedCheckOutTime = new Date(dto.requestedCheckOutTime);
      if (requestedCheckOutTime <= request.attendance.checkInTime) {
        throw new BadRequestException('requestedCheckOutTime must be after checkInTime');
      }
    }

    const updated = await this.prisma.missedCheckoutRequest.update({
      where: { id: request.id },
      data: {
        reason: dto.reason,
        note: dto.note,
        imageUrl: dto.imageUrl,
        ...(requestedCheckOutTime ? { requestedCheckOutTime } : {}),
      },
      include: REQUEST_INCLUDE,
    });

    this.auditLogs
      .log({
        actorId: actor.id,
        entityType: 'MissedCheckoutRequest',
        entityId: request.id,
        action: AuditAction.UPDATE,
        newValue: { attendanceId, reason: dto.reason },
      })
      .catch(() => {});
    this.activityLog.log({
      action: ActivityAction.ATTENDANCE_UPDATED,
      module: ActivityModule.ATTENDANCE,
      description: `${actor.name} submitted a reason for a missed checkout request`,
      actor: { id: actor.id, name: actor.name, role: actor.role },
      target: { id: request.id, type: 'MissedCheckoutRequest' },
    });

    return { success: true, message: 'Missed checkout request updated', data: updated };
  }

  async myRequests(actor: AuthUser, query: QueryMissedCheckoutRequestsDto) {
    return this.listRequests({ requestedById: actor.id }, query);
  }

  // Flat, unpaginated summary list — kept for the legacy
  // GET attendance/missed-checkout-requests/me alias (see LegacyMissedCheckoutController).
  // GET workers/me/missed-checkout (myRequests above) is the canonical, paginated endpoint.
  async myRequestsSummary(actor: AuthUser) {
    const requests = await this.prisma.missedCheckoutRequest.findMany({
      where: { requestedById: actor.id },
      select: {
        id: true,
        attendanceId: true,
        status: true,
        reason: true,
        managerDecision: true,
        adminDecision: true,
        createdAt: true,
        attendance: { select: { checkInTime: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return {
      success: true,
      data: requests.map((r) => ({
        id: r.id,
        attendanceId: r.attendanceId,
        attendanceDate: r.attendance.checkInTime.toISOString().slice(0, 10),
        status: r.status,
        reason: r.reason,
        managerStatus: r.managerDecision,
        adminStatus: r.adminDecision,
        createdAt: r.createdAt,
      })),
    };
  }

  // ─── Manager ──────────────────────────────────────────────────────────────────

  async managerPending(actor: AuthUser, query: QueryMissedCheckoutRequestsDto) {
    return this.listRequests(
      {
        managerId: actor.id,
        currentLevel: MissedCheckoutApprovalLevel.MANAGER,
        status: MissedCheckoutRequestStatus.PENDING,
      },
      query,
    );
  }

  async managerApprove(id: string, dto: ApproveMissedCheckoutRequestDto, actor: AuthUser) {
    const request = await this.getPendingAtLevel(id, MissedCheckoutApprovalLevel.MANAGER);
    if (request.managerId !== actor.id) {
      throw new ForbiddenException('This request is not in your team');
    }

    if (request.adminApprovalRequired) {
      const updated = await this.prisma.missedCheckoutRequest.update({
        where: { id: request.id },
        data: {
          managerDecision: MissedCheckoutRequestStatus.APPROVED,
          managerDecidedById: actor.id,
          managerDecidedAt: new Date(),
          managerRemark: dto.remark,
          currentLevel: MissedCheckoutApprovalLevel.ADMIN,
        },
        include: REQUEST_INCLUDE,
      });
      this.logDecision(actor, request.id, 'approved — escalated to admin');
      return {
        success: true,
        message: 'Approved — escalated to admin for final approval',
        data: updated,
      };
    }

    return this.finalizeApproval(request, actor, dto.remark, dto.checkOutTime, 'manager');
  }

  async managerReject(id: string, dto: RejectMissedCheckoutRequestDto, actor: AuthUser) {
    const request = await this.getPendingAtLevel(id, MissedCheckoutApprovalLevel.MANAGER);
    if (request.managerId !== actor.id) {
      throw new ForbiddenException('This request is not in your team');
    }
    return this.finalizeRejection(request, actor, dto.remark, 'manager');
  }

  // ─── Admin ────────────────────────────────────────────────────────────────────

  async adminPending(query: QueryMissedCheckoutRequestsDto) {
    return this.listRequests(
      {
        currentLevel: MissedCheckoutApprovalLevel.ADMIN,
        status: MissedCheckoutRequestStatus.PENDING,
      },
      query,
    );
  }

  async adminApprove(id: string, dto: ApproveMissedCheckoutRequestDto, actor: AuthUser) {
    const request = await this.getPendingAtLevel(id, MissedCheckoutApprovalLevel.ADMIN);
    return this.finalizeApproval(request, actor, dto.remark, dto.checkOutTime, 'admin');
  }

  async adminReject(id: string, dto: RejectMissedCheckoutRequestDto, actor: AuthUser) {
    const request = await this.getPendingAtLevel(id, MissedCheckoutApprovalLevel.ADMIN);
    return this.finalizeRejection(request, actor, dto.remark, 'admin');
  }

  // ─── Shared helpers ───────────────────────────────────────────────────────────

  private async listRequests(
    where: Prisma.MissedCheckoutRequestWhereInput,
    query: QueryMissedCheckoutRequestsDto,
  ) {
    const { page = 1, limit = 20 } = query;
    const skip = (page - 1) * limit;
    const [requests, total] = await this.prisma.$transaction([
      this.prisma.missedCheckoutRequest.findMany({
        where,
        include: REQUEST_INCLUDE,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.missedCheckoutRequest.count({ where }),
    ]);
    return {
      success: true,
      data: {
        requests,
        meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
      },
    };
  }

  private async getPendingAtLevel(
    id: string,
    level: MissedCheckoutApprovalLevel,
  ): Promise<PendingRequest> {
    const request = await this.prisma.missedCheckoutRequest.findUnique({
      where: { id },
      include: {
        attendance: {
          select: { id: true, userId: true, checkInTime: true, officeLocationId: true },
        },
      },
    });
    if (!request) throw new NotFoundException('Missed checkout request not found');
    if (
      request.status !== MissedCheckoutRequestStatus.PENDING ||
      request.currentLevel !== level
    ) {
      throw new BadRequestException(
        `Request is not pending at the ${level.toLowerCase()} level`,
      );
    }
    return request;
  }

  private async finalizeApproval(
    request: PendingRequest,
    actor: AuthUser,
    remark: string | undefined,
    checkOutTimeInput: string | undefined,
    level: 'manager' | 'admin',
  ) {
    // Defaults to the worker's own claimed check-out time (requestedCheckOutTime) — an
    // approver overriding it is the exception. If the worker never submitted one, the
    // approver must supply checkOutTime explicitly.
    const checkOutTime = checkOutTimeInput
      ? new Date(checkOutTimeInput)
      : request.requestedCheckOutTime;
    if (!checkOutTime) {
      throw new BadRequestException(
        'checkOutTime is required — the worker has not submitted a requested check-out time yet',
      );
    }
    if (checkOutTime <= request.attendance.checkInTime) {
      throw new BadRequestException('checkOutTime must be after checkInTime');
    }

    const hoursWorked =
      (checkOutTime.getTime() - request.attendance.checkInTime.getTime()) / 3_600_000;
    const finalStatus = await this.attendanceService.resolveAttendanceOutcome(
      request.attendance.userId,
      hoursWorked,
    );

    const [, updatedRequest] = await this.prisma.$transaction([
      this.prisma.attendance.update({
        where: { id: request.attendance.id },
        data: {
          checkOutTime,
          status: finalStatus,
          checkoutStatus: CheckoutStatus.MISSED_REQUEST,
          approvedBy: actor.id,
          approvedAt: new Date(),
          approvalRemark: remark,
        },
      }),
      this.prisma.missedCheckoutRequest.update({
        where: { id: request.id },
        data: {
          status: MissedCheckoutRequestStatus.APPROVED,
          approvedCheckOutTime: checkOutTime,
          ...(level === 'manager'
            ? {
                managerDecision: MissedCheckoutRequestStatus.APPROVED,
                managerDecidedById: actor.id,
                managerDecidedAt: new Date(),
                managerRemark: remark,
              }
            : {
                adminDecision: MissedCheckoutRequestStatus.APPROVED,
                adminDecidedById: actor.id,
                adminDecidedAt: new Date(),
                adminRemark: remark,
              }),
        },
        include: REQUEST_INCLUDE,
      }),
    ]);

    // The day is no longer an unpaid absence — reverse the Leave Without Pay charge that was
    // recorded when this attendance was first flagged as a missed checkout.
    if (finalStatus === AttendanceStatus.PRESENT || finalStatus === AttendanceStatus.HALF_DAY) {
      await this.leavePolicyService.recordUnpaidAbsence(request.attendance.userId, -1);
    }

    this.logDecision(actor, request.id, `approved (${finalStatus})`);
    return { success: true, message: 'Missed checkout request approved', data: updatedRequest };
  }

  private async finalizeRejection(
    request: PendingRequest,
    actor: AuthUser,
    remark: string | undefined,
    level: 'manager' | 'admin',
  ) {
    const [, updatedRequest] = await this.prisma.$transaction([
      this.prisma.attendance.update({
        where: { id: request.attendance.id },
        data: {
          status: AttendanceStatus.ABSENT,
          checkoutStatus: CheckoutStatus.MISSED_REQUEST,
        },
      }),
      this.prisma.missedCheckoutRequest.update({
        where: { id: request.id },
        data: {
          status: MissedCheckoutRequestStatus.REJECTED,
          ...(level === 'manager'
            ? {
                managerDecision: MissedCheckoutRequestStatus.REJECTED,
                managerDecidedById: actor.id,
                managerDecidedAt: new Date(),
                managerRemark: remark,
              }
            : {
                adminDecision: MissedCheckoutRequestStatus.REJECTED,
                adminDecidedById: actor.id,
                adminDecidedAt: new Date(),
                adminRemark: remark,
              }),
        },
        include: REQUEST_INCLUDE,
      }),
    ]);

    this.logDecision(actor, request.id, 'rejected');
    return { success: true, message: 'Missed checkout request rejected', data: updatedRequest };
  }

  private logDecision(actor: AuthUser, requestId: string, outcome: string): void {
    this.auditLogs
      .log({
        actorId: actor.id,
        entityType: 'MissedCheckoutRequest',
        entityId: requestId,
        action: AuditAction.UPDATE,
        newValue: { outcome },
      })
      .catch(() => {});
    this.activityLog.log({
      action: ActivityAction.ATTENDANCE_UPDATED,
      module: ActivityModule.ATTENDANCE,
      description: `${actor.name} ${outcome} a missed checkout request`,
      actor: { id: actor.id, name: actor.name, role: actor.role },
      target: { id: requestId, type: 'MissedCheckoutRequest' },
    });
  }
}
