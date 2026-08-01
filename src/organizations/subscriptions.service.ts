import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, SubscriptionStatus } from '@prisma/client';

import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { PrismaService } from '../prisma/prisma.service';
import { ChangePlanDto } from './dto/change-plan.dto';
import { StartSubscriptionDto } from './dto/start-subscription.dto';
import { OrganizationsService } from './organizations.service';

const SUB_INCLUDE = {
  plan: true,
  organization: { select: { id: true, name: true, slug: true } },
};

@Injectable()
export class SubscriptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orgsService: OrganizationsService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async findOne(orgId: string) {
    const sub = await this.prisma.subscription.findUnique({
      where: { organizationId: orgId },
      include: SUB_INCLUDE,
    });
    if (!sub) throw new NotFoundException('No subscription found for this organization');

    const isExpired =
      (sub.status === SubscriptionStatus.TRIALING && sub.trialEndsAt && sub.trialEndsAt < new Date()) ||
      (sub.status === SubscriptionStatus.ACTIVE && sub.currentPeriodEnd < new Date());

    return { success: true, data: { ...sub, isExpired } };
  }

  async start(orgId: string, dto: StartSubscriptionDto, actorId: string) {
    await this.orgsService.assertOrgAdmin(orgId, actorId);

    const existing = await this.prisma.subscription.findUnique({ where: { organizationId: orgId } });
    if (existing && existing.status === SubscriptionStatus.ACTIVE) {
      throw new BadRequestException('Organization already has an active subscription. Use change-plan instead.');
    }

    const plan = await this.prisma.plan.findUnique({ where: { id: dto.planId }, select: { id: true, isActive: true, name: true } });
    if (!plan) throw new NotFoundException('Plan not found');
    if (!plan.isActive) throw new BadRequestException('Selected plan is not available');

    const now = new Date();
    const periodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    const sub = existing
      ? await this.prisma.subscription.update({
          where: { organizationId: orgId },
          data: {
            planId: dto.planId,
            status: SubscriptionStatus.ACTIVE,
            currentPeriodStart: now,
            currentPeriodEnd: periodEnd,
            trialEndsAt: null,
            cancelledAt: null,
          },
          include: SUB_INCLUDE,
        })
      : await this.prisma.subscription.create({
          data: {
            organizationId: orgId,
            planId: dto.planId,
            status: SubscriptionStatus.ACTIVE,
            currentPeriodStart: now,
            currentPeriodEnd: periodEnd,
          },
          include: SUB_INCLUDE,
        });

    this.auditLogs
      .log({ actorId, entityType: 'Subscription', entityId: sub.id, action: AuditAction.CREATE, newValue: { orgId, planId: dto.planId, status: SubscriptionStatus.ACTIVE } })
      .catch(() => {});

    return { success: true, message: `Subscription started on ${plan.name}`, data: sub };
  }

  async changePlan(orgId: string, dto: ChangePlanDto, actorId: string) {
    await this.orgsService.assertOrgAdmin(orgId, actorId);

    const sub = await this.prisma.subscription.findUnique({ where: { organizationId: orgId }, select: { id: true, planId: true, status: true } });
    if (!sub) throw new NotFoundException('No subscription found');
    if (sub.status === SubscriptionStatus.CANCELLED) throw new BadRequestException('Cannot change plan on a cancelled subscription');

    const plan = await this.prisma.plan.findUnique({ where: { id: dto.planId }, select: { id: true, isActive: true, name: true } });
    if (!plan) throw new NotFoundException('Plan not found');
    if (!plan.isActive) throw new BadRequestException('Selected plan is not available');
    if (sub.planId === dto.planId) throw new BadRequestException('Organization is already on this plan');

    const updated = await this.prisma.subscription.update({
      where: { organizationId: orgId },
      data: { planId: dto.planId, status: SubscriptionStatus.ACTIVE },
      include: SUB_INCLUDE,
    });

    this.auditLogs
      .log({ actorId, entityType: 'Subscription', entityId: sub.id, action: AuditAction.UPDATE, oldValue: { planId: sub.planId }, newValue: { planId: dto.planId } })
      .catch(() => {});

    return { success: true, message: `Plan changed to ${plan.name}`, data: updated };
  }

  async renew(orgId: string, actorId: string) {
    await this.orgsService.assertOrgAdmin(orgId, actorId);

    const sub = await this.prisma.subscription.findUnique({
      where: { organizationId: orgId },
      select: { id: true, status: true, currentPeriodEnd: true, planId: true },
    });
    if (!sub) throw new NotFoundException('No subscription found for this organization');
    if (sub.status === SubscriptionStatus.CANCELLED) throw new BadRequestException('Cannot renew a cancelled subscription. Start a new one instead.');

    const base = sub.currentPeriodEnd > new Date() ? sub.currentPeriodEnd : new Date();
    const newPeriodEnd = new Date(base.getTime() + 30 * 24 * 60 * 60 * 1000);

    const updated = await this.prisma.subscription.update({
      where: { organizationId: orgId },
      data: {
        status: SubscriptionStatus.ACTIVE,
        currentPeriodEnd: newPeriodEnd,
        cancelledAt: null,
      },
      include: SUB_INCLUDE,
    });

    this.auditLogs
      .log({ actorId, entityType: 'Subscription', entityId: sub.id, action: AuditAction.UPDATE, oldValue: { status: sub.status, currentPeriodEnd: sub.currentPeriodEnd }, newValue: { status: SubscriptionStatus.ACTIVE, currentPeriodEnd: newPeriodEnd } })
      .catch(() => {});

    return { success: true, message: 'Subscription renewed successfully', data: updated };
  }

  async getOrgInvoices(orgId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;

    const [invoices, total] = await this.prisma.$transaction([
      this.prisma.invoice.findMany({
        where: {
          OR: [
            { booking: { organizationId: orgId } },
            { customer: { organizationId: orgId } },
          ],
        },
        select: {
          id: true,
          invoiceNumber: true,
          status: true,
          total: true,
          paidAt: true,
          dueDate: true,
          createdAt: true,
          customer: { select: { id: true, name: true, email: true } },
        },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.invoice.count({
        where: {
          OR: [
            { booking: { organizationId: orgId } },
            { customer: { organizationId: orgId } },
          ],
        },
      }),
    ]);

    return {
      success: true,
      data: { invoices, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } },
    };
  }

  async cancel(orgId: string, actorId: string) {
    await this.orgsService.assertOrgAdmin(orgId, actorId);

    const sub = await this.prisma.subscription.findUnique({ where: { organizationId: orgId }, select: { id: true, status: true } });
    if (!sub) throw new NotFoundException('No subscription found');
    if (sub.status === SubscriptionStatus.CANCELLED) throw new BadRequestException('Subscription is already cancelled');

    const updated = await this.prisma.subscription.update({
      where: { organizationId: orgId },
      data: { status: SubscriptionStatus.CANCELLED, cancelledAt: new Date() },
      include: SUB_INCLUDE,
    });

    this.auditLogs
      .log({ actorId, entityType: 'Subscription', entityId: sub.id, action: AuditAction.STATUS_CHANGE, oldValue: { status: sub.status }, newValue: { status: SubscriptionStatus.CANCELLED } })
      .catch(() => {});

    return { success: true, message: 'Subscription cancelled. Access continues until the current period ends.', data: updated };
  }
}
