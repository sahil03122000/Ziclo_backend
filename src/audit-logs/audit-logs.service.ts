import { Injectable } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { AuditLogQueryDto } from './dto/audit-log-query.dto';

export interface LogPayload {
  actorId?: string;
  entityType: string;
  entityId: string;
  action: AuditAction;
  oldValue?: Record<string, unknown>;
  newValue?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}

const ACTOR_SELECT = { id: true, name: true, email: true, role: true } satisfies Prisma.UserSelect;

@Injectable()
export class AuditLogsService {
  constructor(private readonly prisma: PrismaService) {}

  async log(payload: LogPayload): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          actorId: payload.actorId,
          entityType: payload.entityType,
          entityId: payload.entityId,
          action: payload.action,
          oldValue: payload.oldValue as Prisma.InputJsonValue,
          newValue: payload.newValue as Prisma.InputJsonValue,
          ipAddress: payload.ipAddress,
          userAgent: payload.userAgent,
        },
      });
    } catch {
      // Never block the calling operation
    }
  }

  async findAll(query: AuditLogQueryDto) {
    const { page = 1, limit = 20, actorId, entityType, entityId, action, startDate, endDate } = query;
    const skip = (page - 1) * limit;
    const where = this.buildWhere({ actorId, entityType, entityId, action, startDate, endDate });

    const [logs, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: { actor: { select: ACTOR_SELECT } },
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return { success: true, data: { logs, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } } };
  }

  async findRecent(limit = 50) {
    const logs = await this.prisma.auditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { actor: { select: ACTOR_SELECT } },
    });
    return { success: true, data: logs };
  }

  private buildWhere(filters: {
    actorId?: string;
    entityType?: string;
    entityId?: string;
    action?: AuditAction;
    startDate?: string;
    endDate?: string;
  }): Prisma.AuditLogWhereInput {
    const where: Prisma.AuditLogWhereInput = {};
    if (filters.actorId) where.actorId = filters.actorId;
    if (filters.entityType) where.entityType = filters.entityType;
    if (filters.entityId) where.entityId = filters.entityId;
    if (filters.action) where.action = filters.action;
    if (filters.startDate || filters.endDate) {
      where.createdAt = {};
      if (filters.startDate) where.createdAt.gte = new Date(filters.startDate);
      if (filters.endDate) where.createdAt.lte = new Date(filters.endDate);
    }
    return where;
  }
}
