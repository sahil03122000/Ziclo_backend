import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';

import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePlanDto } from './dto/create-plan.dto';
import { UpdatePlanDto } from './dto/update-plan.dto';

const PLAN_SELECT = {
  id: true,
  name: true,
  tier: true,
  description: true,
  price: true,
  maxUsers: true,
  maxStorageGb: true,
  features: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.PlanSelect;

@Injectable()
export class PlansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async create(dto: CreatePlanDto, actorId: string) {
    const existing = await this.prisma.plan.findUnique({ where: { tier: dto.tier }, select: { id: true } });
    if (existing) throw new ConflictException(`A plan with tier ${dto.tier} already exists`);

    const plan = await this.prisma.plan.create({
      data: {
        name: dto.name,
        tier: dto.tier,
        description: dto.description,
        price: dto.price,
        maxUsers: dto.maxUsers,
        maxStorageGb: dto.maxStorageGb,
        features: dto.features,
      },
      select: PLAN_SELECT,
    });

    this.auditLogs
      .log({ actorId, entityType: 'Plan', entityId: plan.id, action: AuditAction.CREATE, newValue: { tier: plan.tier } })
      .catch(() => {});

    return { success: true, message: 'Plan created successfully', data: plan };
  }

  async findAll() {
    const plans = await this.prisma.plan.findMany({
      select: PLAN_SELECT,
      orderBy: { price: 'asc' },
    });
    return { success: true, data: plans };
  }

  async findAllActive() {
    const plans = await this.prisma.plan.findMany({
      where: { isActive: true },
      select: PLAN_SELECT,
      orderBy: { price: 'asc' },
    });
    return { success: true, data: plans };
  }

  async findOne(id: string) {
    const plan = await this.prisma.plan.findUnique({ where: { id }, select: PLAN_SELECT });
    if (!plan) throw new NotFoundException('Plan not found');
    return { success: true, data: plan };
  }

  async update(id: string, dto: UpdatePlanDto, actorId: string) {
    await this.assertExists(id);

    const plan = await this.prisma.plan.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.price !== undefined && { price: dto.price }),
        ...(dto.maxUsers !== undefined && { maxUsers: dto.maxUsers }),
        ...(dto.maxStorageGb !== undefined && { maxStorageGb: dto.maxStorageGb }),
        ...(dto.features !== undefined && { features: dto.features }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
      select: PLAN_SELECT,
    });

    this.auditLogs
      .log({ actorId, entityType: 'Plan', entityId: id, action: AuditAction.UPDATE, newValue: { ...dto } })
      .catch(() => {});

    return { success: true, message: 'Plan updated successfully', data: plan };
  }

  async remove(id: string, actorId: string) {
    await this.assertExists(id);

    const subscriptionCount = await this.prisma.subscription.count({ where: { planId: id } });
    if (subscriptionCount > 0) {
      throw new ConflictException('Cannot delete a plan that has active subscriptions. Deactivate it instead.');
    }

    await this.prisma.plan.delete({ where: { id } });

    this.auditLogs
      .log({ actorId, entityType: 'Plan', entityId: id, action: AuditAction.DELETE })
      .catch(() => {});

    return { success: true, message: 'Plan deleted successfully' };
  }

  async findByTier(tier: string) {
    const plan = await this.prisma.plan.findUnique({
      where: { tier: tier as Prisma.EnumPlanTierFilter['equals'] },
      select: PLAN_SELECT,
    });
    return plan;
  }

  private async assertExists(id: string) {
    const plan = await this.prisma.plan.findUnique({ where: { id }, select: { id: true } });
    if (!plan) throw new NotFoundException('Plan not found');
    return plan;
  }
}
