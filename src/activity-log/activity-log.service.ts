import { Injectable, NotFoundException } from '@nestjs/common';
import { ActivityAction, ActivityModule, Prisma, Role } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { QueryActivityLogDto } from './dto/query-activity-log.dto';

export interface ActivityLogPayload {
  action: ActivityAction;
  module: ActivityModule;
  description: string;
  actor: {
    id?: string;
    name: string;
    role: Role;
  };
  target?: {
    id: string;
    type: string;
  };
  organizationId?: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  device?: string;
  platform?: string;
}

@Injectable()
export class ActivityLogService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Write (fire-and-forget — never blocks the calling request) ───────────────

  log(payload: ActivityLogPayload): void {
    this.prisma.activityLog
      .create({
        data: {
          action: payload.action,
          module: payload.module,
          description: payload.description,
          actorId: payload.actor.id,
          actorName: payload.actor.name,
          actorRole: payload.actor.role,
          targetId: payload.target?.id,
          targetType: payload.target?.type,
          organizationId: payload.organizationId,
          metadata: payload.metadata as Prisma.InputJsonValue,
          ipAddress: payload.ipAddress,
          device: payload.device,
          platform: payload.platform,
        },
      })
      .catch(() => {});
  }

  // ─── Read ─────────────────────────────────────────────────────────────────────

  async findAll(query: QueryActivityLogDto) {
    const { page = 1, limit = 20, search, module, action, actorRole, organizationId, fromDate, toDate, sort = 'desc' } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.ActivityLogWhereInput = {};
    if (module) where.module = module;
    if (action) where.action = action;
    if (actorRole) where.actorRole = actorRole;
    if (organizationId) where.organizationId = organizationId;
    if (search) {
      where.OR = [
        { description: { contains: search, mode: 'insensitive' } },
        { actorName: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (fromDate || toDate) {
      where.createdAt = {};
      if (fromDate) where.createdAt.gte = new Date(fromDate);
      if (toDate) {
        const end = new Date(toDate);
        end.setHours(23, 59, 59, 999);
        where.createdAt.lte = end;
      }
    }

    const [logs, total] = await this.prisma.$transaction([
      this.prisma.activityLog.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: sort },
      }),
      this.prisma.activityLog.count({ where }),
    ]);

    return {
      success: true,
      data: {
        logs,
        meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
      },
    };
  }

  async findOne(id: string) {
    const log = await this.prisma.activityLog.findUnique({ where: { id } });
    if (!log) throw new NotFoundException('Activity log not found');
    return { success: true, data: log };
  }

  async getRecentActivities(limit = 20) {
    const logs = await this.prisma.activityLog.findMany({
      take: limit,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        action: true,
        module: true,
        description: true,
        actorName: true,
        actorRole: true,
        createdAt: true,
        metadata: true,
      },
    });

    return {
      success: true,
      data: logs.map((l) => ({
        id: l.id,
        time: l.createdAt,
        icon: l.module.toLowerCase(),
        title: l.description,
        description: (l.metadata as Record<string, unknown>)?.summary as string | undefined,
        module: l.module,
        actorName: l.actorName,
        actorRole: l.actorRole,
        action: l.action,
      })),
    };
  }

  async getStats() {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);
    const todayFilter: Prisma.ActivityLogWhereInput = {
      createdAt: { gte: todayStart, lte: todayEnd },
    };

    const [
      todayTotal,
      todayBookings,
      todayPayments,
      todayWorkerCheckins,
      todayComplaints,
      todayManagerActions,
      todayAdminActions,
    ] = await this.prisma.$transaction([
      this.prisma.activityLog.count({ where: todayFilter }),
      this.prisma.activityLog.count({ where: { ...todayFilter, module: ActivityModule.BOOKING } }),
      this.prisma.activityLog.count({ where: { ...todayFilter, module: ActivityModule.PAYMENT } }),
      this.prisma.activityLog.count({ where: { ...todayFilter, action: ActivityAction.WORKER_CHECKIN } }),
      this.prisma.activityLog.count({ where: { ...todayFilter, module: ActivityModule.SUPPORT } }),
      this.prisma.activityLog.count({ where: { ...todayFilter, actorRole: Role.MANAGER } }),
      this.prisma.activityLog.count({ where: { ...todayFilter, actorRole: Role.ADMIN } }),
    ]);

    return {
      success: true,
      data: {
        todayTotal,
        todayBookings,
        todayPayments,
        todayWorkerCheckins,
        todayComplaints,
        todayManagerActions,
        todayAdminActions,
      },
    };
  }
}
