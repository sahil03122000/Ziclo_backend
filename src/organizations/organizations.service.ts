import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditAction,
  PlanTier,
  Prisma,
  Role,
  SubscriptionStatus,
} from '@prisma/client';

import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { PrismaService } from '../prisma/prisma.service';
import { TenantAccessService } from '../tenant/tenant-access.service';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { OrganizationQueryDto } from './dto/organization-query.dto';
import { UpdateOrganizationDto } from './dto/update-organization.dto';

const ORG_SELECT = {
  id: true,
  name: true,
  slug: true,
  email: true,
  phone: true,
  address: true,
  logoUrl: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.OrganizationSelect;

const ORG_WITH_SUBSCRIPTION = {
  ...ORG_SELECT,
  subscription: {
    include: { plan: true },
  },
} satisfies Prisma.OrganizationSelect;

@Injectable()
export class OrganizationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly tenantAccess: TenantAccessService,
  ) {}

  // ─── Create org + auto-enrol founder + start TRIAL subscription ───────────────

  async create(dto: CreateOrganizationDto, founderId: string) {
    const slug = dto.slug ?? this.toSlug(dto.name);

    const slugConflict = await this.prisma.organization.findUnique({
      where: { slug },
      select: { id: true },
    });
    if (slugConflict)
      throw new ConflictException(
        `Organization slug "${slug}" is already taken`,
      );

    const trialPlan = await this.prisma.plan.findUnique({
      where: { tier: PlanTier.TRIAL },
      select: { id: true },
    });
    if (!trialPlan)
      throw new BadRequestException(
        'TRIAL plan has not been seeded. Create it first via POST /plans.',
      );

    const now = new Date();
    const trialEndsAt = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

    const org = await this.prisma.$transaction(async (tx) => {
      const created = await tx.organization.create({
        data: {
          name: dto.name,
          slug,
          email: dto.email,
          phone: dto.phone,
          address: dto.address,
          logoUrl: dto.logoUrl,
        },
        select: ORG_WITH_SUBSCRIPTION,
      });

      // Membership is recorded exclusively via OrganizationUser — the single
      // source of truth for "which orgs does this user belong to" (a user can
      // belong to many; User.organizationId is a legacy scalar that can only
      // point to one and is never read for authorization anywhere in this
      // codebase, so it is deliberately not written here either).
      await tx.organizationUser.create({
        data: {
          organizationId: created.id,
          userId: founderId,
          role: Role.ADMIN,
        },
      });

      await tx.subscription.create({
        data: {
          organizationId: created.id,
          planId: trialPlan.id,
          status: SubscriptionStatus.TRIALING,
          trialEndsAt,
          currentPeriodStart: now,
          currentPeriodEnd: trialEndsAt,
        },
      });

      return created;
    });

    this.auditLogs
      .log({
        actorId: founderId,
        entityType: 'Organization',
        entityId: org.id,
        action: AuditAction.CREATE,
        newValue: { name: org.name, slug: org.slug },
      })
      .catch(() => {});

    return {
      success: true,
      message: 'Organization created with 14-day trial',
      data: org,
    };
  }

  // ─── Member-accessible read ────────────────────────────────────────────────────

  async findOne(id: string) {
    const org = await this.prisma.organization.findUnique({
      where: { id },
      select: ORG_WITH_SUBSCRIPTION,
    });
    if (!org) throw new NotFoundException('Organization not found');
    return { success: true, data: org };
  }

  async findMyOrganizations(userId: string) {
    const memberships = await this.prisma.organizationUser.findMany({
      where: { userId, isActive: true },
      include: {
        organization: { select: ORG_WITH_SUBSCRIPTION },
      },
      orderBy: { joinedAt: 'desc' },
    });
    return { success: true, data: memberships };
  }

  // ─── Dashboard ────────────────────────────────────────────────────────────────

  async getDashboard(orgId: string) {
    const [orgMemberships, subscription] = await Promise.all([
      // Member user ids come from OrganizationUser (the single source of truth for
      // membership) — never from the legacy User.organizationId scalar, which can only
      // point to one org and goes stale the moment a user joins a second one. Also
      // used for memberCount below, replacing a separate count() query.
      this.prisma.organizationUser.findMany({
        where: { organizationId: orgId, isActive: true },
        select: { userId: true },
      }),
      this.prisma.subscription.findUnique({
        where: { organizationId: orgId },
        include: { plan: true },
      }),
    ]);

    const memberCount = orgMemberships.length;
    const userIds = orgMemberships.map((m) => m.userId);

    const [taskCount, bookingCount, invoiceCount, recentAuditLogs] =
      await Promise.all([
        userIds.length > 0
          ? this.prisma.task.count({ where: { createdById: { in: userIds } } })
          : Promise.resolve(0),
        userIds.length > 0
          ? this.prisma.booking.count({
              where: { customerId: { in: userIds } },
            })
          : Promise.resolve(0),
        userIds.length > 0
          ? this.prisma.invoice.count({
              where: { customerId: { in: userIds } },
            })
          : Promise.resolve(0),
        this.prisma.auditLog.findMany({
          where:
            userIds.length > 0 ? { actorId: { in: userIds } } : { id: 'none' },
          take: 10,
          orderBy: { createdAt: 'desc' },
          include: { actor: { select: { id: true, name: true, email: true } } },
        }),
      ]);

    const isTrialExpired =
      subscription?.status === SubscriptionStatus.TRIALING &&
      subscription.trialEndsAt &&
      subscription.trialEndsAt < new Date();

    return {
      success: true,
      data: {
        memberCount,
        subscription: { ...subscription, isTrialExpired },
        stats: {
          tasks: taskCount,
          bookings: bookingCount,
          invoices: invoiceCount,
        },
        recentActivity: recentAuditLogs,
      },
    };
  }

  // ─── Update / Delete (ADMIN only — enforced in service) ───────────────────────

  async update(id: string, dto: UpdateOrganizationDto, actorId: string) {
    await this.assertOrgAdmin(id, actorId);

    const org = await this.prisma.organization.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.email !== undefined && { email: dto.email }),
        ...(dto.phone !== undefined && { phone: dto.phone }),
        ...(dto.address !== undefined && { address: dto.address }),
        ...(dto.logoUrl !== undefined && { logoUrl: dto.logoUrl }),
      },
      select: ORG_WITH_SUBSCRIPTION,
    });

    this.auditLogs
      .log({
        actorId,
        entityType: 'Organization',
        entityId: id,
        action: AuditAction.UPDATE,
        newValue: { ...dto },
      })
      .catch(() => {});

    return {
      success: true,
      message: 'Organization updated successfully',
      data: org,
    };
  }

  async remove(id: string, actorId: string) {
    const org = await this.prisma.organization.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!org) throw new NotFoundException('Organization not found');

    await this.assertOrgAdmin(id, actorId);
    await this.prisma.organization.delete({ where: { id } });

    this.auditLogs
      .log({
        actorId,
        entityType: 'Organization',
        entityId: id,
        action: AuditAction.DELETE,
      })
      .catch(() => {});

    return { success: true, message: 'Organization deleted successfully' };
  }

  // ─── Super Admin list ─────────────────────────────────────────────────────────

  async findAll(query: OrganizationQueryDto) {
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
        select: ORG_WITH_SUBSCRIPTION,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.organization.count({ where }),
    ]);

    return {
      success: true,
      data: {
        orgs,
        meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
      },
    };
  }

  async toggleStatus(id: string, actorId: string) {
    const org = await this.prisma.organization.findUnique({
      where: { id },
      select: { id: true, isActive: true },
    });
    if (!org) throw new NotFoundException('Organization not found');

    const updated = await this.prisma.organization.update({
      where: { id },
      data: { isActive: !org.isActive },
      select: ORG_SELECT,
    });

    this.auditLogs
      .log({
        actorId,
        entityType: 'Organization',
        entityId: id,
        action: AuditAction.STATUS_CHANGE,
        oldValue: { isActive: org.isActive },
        newValue: { isActive: !org.isActive },
      })
      .catch(() => {});

    return {
      success: true,
      message: `Organization ${updated.isActive ? 'activated' : 'deactivated'}`,
      data: updated,
    };
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────────

  // "Organization not found" (404) is a Organizations-CRUD-specific concern, checked
  // here; the actual admin/membership check is not re-implemented — it delegates
  // wholesale to TenantAccessService, the single source of truth for that logic.
  async assertOrgAdmin(orgId: string, userId: string): Promise<void> {
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      select: { id: true },
    });
    if (!org) throw new NotFoundException('Organization not found');

    await this.tenantAccess.requireOrgAdmin(userId, orgId);
  }

  private toSlug(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .trim()
      .substring(0, 60);
  }
}
