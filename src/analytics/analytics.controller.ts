import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';

import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RoleGuard } from '../common/guards/role.guard';
import { AnalyticsService } from './analytics.service';
import { AnalyticsQueryDto } from './dto/analytics-query.dto';

@ApiTags('Analytics')
@ApiBearerAuth('JWT')
@Controller('analytics')
@UseGuards(JwtAuthGuard, RoleGuard)
@Roles(Role.ADMIN)
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('overview')
  @ApiOperation({
    summary: 'Overview: user growth, attendance trends, task trends, area + manager performance — ADMIN',
    description: 'Pass `?startDate=2026-01-01&endDate=2026-06-30` to scope the date range. Defaults to the last 30 days.',
  })
  @ApiResponse({
    status: 200,
    description: 'Analytics overview',
    schema: {
      example: {
        success: true,
        data: {
          userGrowth: [{ date: '2026-06-01', newUsers: 5 }],
          attendanceTrends: [{ date: '2026-06-01', checkIns: 32, checkOuts: 31 }],
          taskTrends: [{ date: '2026-06-01', created: 12, completed: 9 }],
          areaPerformance: [{ areaName: 'South Bangalore', completionRate: 0.92 }],
          managerPerformance: [{ managerId: 'uuid', name: 'Rahul', approvalRate: 0.88 }],
        },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — ADMIN required' })
  getOverview(@Query() query: AnalyticsQueryDto) {
    return this.analyticsService.getOverview(query);
  }
}
