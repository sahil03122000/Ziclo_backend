import { Injectable } from '@nestjs/common';
import { TaskStatus } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { AnalyticsPeriod, AnalyticsQueryDto } from './dto/analytics-query.dto';

interface TimePoint { period: string; count: number }

@Injectable()
export class AnalyticsService {
  // Simple in-memory cache: key → { data, expiresAt }
  private readonly cache = new Map<string, { data: unknown; expiresAt: number }>();

  constructor(private readonly prisma: PrismaService) {}

  async getOverview(query: AnalyticsQueryDto) {
    const cacheKey = `analytics:${query.period}:${query.pincodeId ?? query.areaId ?? 'all'}`;
    const cached = this.getCache<unknown>(cacheKey);
    if (cached) return { success: true, data: cached };

    const { start } = this.getPeriodRange(query.period ?? AnalyticsPeriod.MONTHLY);
    const taskFilter = query.pincodeId
      ? { pincodeId: query.pincodeId }
      : query.areaId
      ? { areaId: query.areaId }
      : {};

    const [users, checkIns, tasks, pincodePerformance, managerPerformance] = await Promise.all([
      this.prisma.user.findMany({ where: { createdAt: { gte: start } }, select: { createdAt: true } }),
      this.prisma.attendance.findMany({ where: { checkInTime: { gte: start } }, select: { checkInTime: true } }),
      this.prisma.task.findMany({
        where: { createdAt: { gte: start }, ...taskFilter },
        select: { createdAt: true, status: true, completedAt: true, pincodeId: true },
      }),
      this.prisma.task.groupBy({
        by: ['pincodeId'],
        where: { pincodeId: { not: null }, ...taskFilter },
        _count: { _all: true },
      }).then(async (groups) => {
        const pincodeIds = groups.filter((g) => g.pincodeId).map((g) => g.pincodeId!);
        const pincodes = await this.prisma.pincode.findMany({
          where: { id: { in: pincodeIds } },
          select: { id: true, pincode: true, city: true },
        });
        const completedCounts = await Promise.all(
          pincodeIds.map((id) =>
            this.prisma.task.count({ where: { pincodeId: id, status: TaskStatus.COMPLETED } }),
          ),
        );
        return groups.map((g, i) => ({
          pincode: pincodes.find((p) => p.id === g.pincodeId) ?? { id: g.pincodeId, pincode: 'Unknown', city: '' },
          totalTasks: g._count._all,
          completedTasks: completedCounts[i],
          completionRate:
            g._count._all > 0 ? +((completedCounts[i] / g._count._all) * 100).toFixed(1) : 0,
        }));
      }),
      this.prisma.user.findMany({
        where: { role: 'MANAGER', isActive: true },
        select: {
          id: true,
          name: true,
          managedTasks: {
            where: { createdAt: { gte: start } },
            select: { status: true },
          },
        },
        take: 20,
      }).then((managers) =>
        managers.map((m) => ({
          managerId: m.id,
          managerName: m.name,
          totalTasks: m.managedTasks.length,
          completedTasks: m.managedTasks.filter((t) => t.status === TaskStatus.COMPLETED).length,
          completionRate:
            m.managedTasks.length > 0
              ? +(
                  (m.managedTasks.filter((t) => t.status === TaskStatus.COMPLETED).length /
                    m.managedTasks.length) *
                  100
                ).toFixed(1)
              : 0,
        })),
      ),
    ]);

    const granularity = this.getGranularity(query.period ?? AnalyticsPeriod.MONTHLY);

    const data = {
      period: query.period,
      userGrowth: this.groupByTime(users, 'createdAt', granularity),
      attendanceTrends: this.groupByTime(checkIns, 'checkInTime', granularity),
      taskTrends: {
        created: this.groupByTime(tasks, 'createdAt', granularity),
        completed: this.groupByTime(
          tasks.filter((t) => t.status === TaskStatus.COMPLETED && t.completedAt),
          'completedAt',
          granularity,
        ),
      },
      pincodePerformance,
      managerPerformance,
    };

    this.setCache(cacheKey, data, 300); // 5-minute cache
    return { success: true, data };
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────────

  private getPeriodRange(period: AnalyticsPeriod): { start: Date } {
    const now = new Date();
    if (period === AnalyticsPeriod.WEEKLY) return { start: new Date(now.getTime() - 84 * 24 * 60 * 60 * 1000) }; // 12 weeks
    if (period === AnalyticsPeriod.YEARLY) return { start: new Date(now.getTime() - 5 * 365 * 24 * 60 * 60 * 1000) }; // 5 years
    return { start: new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000) }; // 12 months
  }

  private getGranularity(period: AnalyticsPeriod): 'day' | 'month' | 'year' {
    if (period === AnalyticsPeriod.WEEKLY) return 'day';
    if (period === AnalyticsPeriod.YEARLY) return 'year';
    return 'month';
  }

  private groupByTime(
    items: Record<string, unknown>[],
    dateField: string,
    granularity: 'day' | 'month' | 'year',
  ): TimePoint[] {
    const groups: Record<string, number> = {};
    for (const item of items) {
      const date = new Date(item[dateField] as string | Date);
      if (isNaN(date.getTime())) continue;
      const key =
        granularity === 'day'
          ? date.toISOString().slice(0, 10)
          : granularity === 'month'
          ? date.toISOString().slice(0, 7)
          : String(date.getFullYear());
      groups[key] = (groups[key] ?? 0) + 1;
    }
    return Object.entries(groups)
      .map(([period, count]) => ({ period, count }))
      .sort((a, b) => a.period.localeCompare(b.period));
  }

  private getCache<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry || entry.expiresAt < Date.now()) {
      this.cache.delete(key);
      return null;
    }
    return entry.data as T;
  }

  private setCache(key: string, data: unknown, ttlSeconds: number): void {
    this.cache.set(key, { data, expiresAt: Date.now() + ttlSeconds * 1000 });
  }
}
