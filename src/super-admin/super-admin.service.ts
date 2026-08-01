import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, Prisma, SubscriptionStatus } from '@prisma/client';

import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { PrismaService } from '../prisma/prisma.service';
import { OrganizationQueryDto } from '../organizations/dto/organization-query.dto';
import { StartSubscriptionDto } from '../organizations/dto/start-subscription.dto';
import { SubscriptionsService } from '../organizations/subscriptions.service';
import { UsersQueryDto } from '../users/dto/users-query.dto';

@Injectable()
export class SuperAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptionsService: SubscriptionsService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  // ─── Platform stats ───────────────────────────────────────────────────────────

  async getPlatformStats() {
    const [totalOrgs, activeOrgs, totalUsers, activeUsers, subscriptionBreakdown, trialOrgs] = await Promise.all([
      this.prisma.organization.count(),
      this.prisma.organization.count({ where: { isActive: true } }),
      this.prisma.user.count(),
      this.prisma.user.count({ where: { isActive: true } }),
      this.prisma.subscription.groupBy({
        by: ['status'],
        _count: { id: true },
      }),
      this.prisma.subscription.count({ where: { status: SubscriptionStatus.TRIALING } }),
    ]);

    return {
      success: true,
      data: {
        organizations: { total: totalOrgs, active: activeOrgs, inactive: totalOrgs - activeOrgs },
        users: { total: totalUsers, active: activeUsers },
        subscriptions: {
          trialing: trialOrgs,
          breakdown: Object.fromEntries(subscriptionBreakdown.map((r) => [r.status, r._count.id])),
        },
      },
    };
  }

  // ─── Organization management ──────────────────────────────────────────────────

  async listOrganizations(query: OrganizationQueryDto) {
    const { page = 1, limit = 20, search, isActive } = query;
    const skip = (page - 1) * limit;
    const where: Prisma.OrganizationWhereInput = {};

    if (isActive !== undefined) where.isActive = isActive;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { slug: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [orgs, total] = await this.prisma.$transaction([
      this.prisma.organization.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          subscription: { include: { plan: true } },
          _count: { select: { members: true, users: true } },
        },
      }),
      this.prisma.organization.count({ where }),
    ]);

    return {
      success: true,
      data: { orgs, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } },
    };
  }

  async getOrganizationDetail(orgId: string) {
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      include: {
        subscription: { include: { plan: true } },
        members: {
          where: { isActive: true },
          include: { user: { select: { id: true, name: true, email: true, role: true, isActive: true } } },
          orderBy: { joinedAt: 'asc' },
        },
        _count: { select: { users: true, members: true } },
      },
    });
    if (!org) throw new NotFoundException('Organization not found');
    return { success: true, data: org };
  }

  async toggleOrgStatus(orgId: string, actorId: string) {
    const org = await this.prisma.organization.findUnique({ where: { id: orgId }, select: { id: true, isActive: true, name: true } });
    if (!org) throw new NotFoundException('Organization not found');

    const updated = await this.prisma.organization.update({
      where: { id: orgId },
      data: { isActive: !org.isActive },
      select: { id: true, name: true, slug: true, isActive: true },
    });

    this.auditLogs
      .log({ actorId, entityType: 'Organization', entityId: orgId, action: AuditAction.STATUS_CHANGE, oldValue: { isActive: org.isActive }, newValue: { isActive: !org.isActive } })
      .catch(() => {});

    return { success: true, message: `Organization ${updated.isActive ? 'activated' : 'deactivated'}`, data: updated };
  }

  async overrideSubscription(orgId: string, dto: StartSubscriptionDto, actorId: string) {
    return this.subscriptionsService.start(orgId, dto, actorId);
  }

  async hardDeleteOrganization(orgId: string, actorId: string) {
    const org = await this.prisma.organization.findUnique({ where: { id: orgId }, select: { id: true, name: true } });
    if (!org) throw new NotFoundException('Organization not found');

    await this.prisma.organization.delete({ where: { id: orgId } });

    this.auditLogs
      .log({ actorId, entityType: 'Organization', entityId: orgId, action: AuditAction.DELETE, newValue: { name: org.name } })
      .catch(() => {});

    return { success: true, message: 'Organization permanently deleted' };
  }

  // ─── User management ──────────────────────────────────────────────────────────

  async listUsers(query: UsersQueryDto) {
    const { page = 1, limit = 20, role, search } = query;
    const skip = (page - 1) * limit;
    const where: Prisma.UserWhereInput = {};

    if (role) where.role = role;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } },
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
          role: true,
          isActive: true,
          organizationId: true,
          organization: { select: { id: true, name: true, slug: true } },
          createdAt: true,
        },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      success: true,
      data: { users, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } },
    };
  }
}
