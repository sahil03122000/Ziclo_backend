import { Injectable } from '@nestjs/common';
import { DealStage, LeadStatus } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CrmService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Pipeline ─────────────────────────────────────────────────────────────────

  async getPipeline(orgId?: string) {
    const orgFilter = orgId ? { organizationId: orgId } : {};

    const [leadsByStatus, dealsByStage] = await Promise.all([
      this.prisma.lead.groupBy({
        by: ['status'],
        where: orgFilter,
        orderBy: { status: 'asc' },
        _count: { _all: true },
      }),
      this.prisma.deal.groupBy({
        by: ['stage'],
        where: orgFilter,
        orderBy: { stage: 'asc' },
        _count: { _all: true },
        _sum: { value: true },
      }),
    ]);

    const leadsMap: Record<string, number> = Object.fromEntries(
      Object.values(LeadStatus).map((s) => [s, 0]),
    );
    for (const row of leadsByStatus) leadsMap[row.status] = row._count._all;

    const dealsPipeline = Object.values(DealStage).map((stage) => {
      const row = dealsByStage.find((r) => r.stage === stage);
      return {
        stage,
        count: row?._count._all ?? 0,
        totalValue: parseFloat((row?._sum?.value ?? 0).toFixed(2)),
      };
    });

    return {
      success: true,
      data: {
        leads: leadsMap,
        deals: dealsPipeline,
      },
    };
  }

  // ─── Dashboard ────────────────────────────────────────────────────────────────

  async getDashboard(orgId?: string) {
    const orgFilter = orgId ? { organizationId: orgId } : {};

    const [totalLeads, convertedLeads, activeDeals, forecastAgg] = await this.prisma.$transaction([
      this.prisma.lead.count({ where: orgFilter }),
      this.prisma.lead.count({ where: { ...orgFilter, status: LeadStatus.WON } }),
      this.prisma.deal.count({
        where: {
          ...orgFilter,
          stage: { notIn: [DealStage.CLOSED_WON, DealStage.CLOSED_LOST] },
        },
      }),
      this.prisma.deal.aggregate({
        where: {
          ...orgFilter,
          stage: { notIn: [DealStage.CLOSED_WON, DealStage.CLOSED_LOST] },
        },
        _sum: { value: true },
      }),
    ]);

    return {
      success: true,
      data: {
        totalLeads,
        convertedLeads,
        activeDeals,
        forecastValue: parseFloat((forecastAgg._sum.value ?? 0).toFixed(2)),
      },
    };
  }
}
