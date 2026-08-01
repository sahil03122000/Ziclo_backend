import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RoleGuard } from '../common/guards/role.guard';
import { AuthUser } from '../common/types/auth-user.type';
import { DashboardService } from './dashboard.service';

@ApiTags('Dashboard')
@ApiBearerAuth('JWT')
@Controller('dashboard')
@UseGuards(JwtAuthGuard, RoleGuard)
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('admin')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Admin dashboard: user counts, task stats, overdue — ADMIN (cached 60s)' })
  @ApiResponse({
    status: 200,
    description: 'Admin dashboard metrics',
    schema: {
      example: {
        success: true,
        data: {
          totalUsers: 142, activeWorkers: 38, pendingTasks: 12, overdueTasks: 4,
          todayCheckIns: 29, recentBookings: 7, pendingInvoices: 3,
        },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — ADMIN required' })
  getAdminDashboard() {
    return this.dashboardService.getAdminDashboard();
  }

  @Get('manager')
  @Roles(Role.MANAGER)
  @ApiOperation({ summary: 'Manager dashboard: team workers, tasks, check-ins — MANAGER (cached 60s)' })
  @ApiResponse({
    status: 200,
    description: 'Manager dashboard for their assigned team',
    schema: {
      example: {
        success: true,
        data: {
          teamSize: 8, checkedInToday: 6, pendingTasks: 3, completedTasks: 20, awaitingApproval: 2,
        },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — MANAGER required' })
  getManagerDashboard(@CurrentUser() user: AuthUser) {
    return this.dashboardService.getManagerDashboard(user.id);
  }

  @Get('worker')
  @Roles(Role.WORKER)
  @ApiOperation({ summary: 'Worker dashboard: attendance summary, task counts — WORKER (always fresh from the Attendance table, not cached)' })
  @ApiResponse({
    status: 200,
    description: 'Worker personal dashboard',
    schema: {
      example: {
        success: true,
        data: {
          todayStatus: 'CHECKED_IN', checkInTime: '2026-06-21T09:00:00Z',
          pendingTasks: 2, inProgressTasks: 1, completedThisMonth: 45, presentDaysThisMonth: 18,
        },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — WORKER required' })
  getWorkerDashboard(@CurrentUser() user: AuthUser) {
    return this.dashboardService.getWorkerDashboard(user.id);
  }

  @Get('super-admin')
  @Roles(Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Super-admin platform overview: org/user/booking/invoice/revenue counts — SUPER_ADMIN (cached 60s)' })
  @ApiResponse({
    status: 200,
    description: 'Platform-wide stats',
    schema: {
      example: {
        success: true,
        data: {
          totalOrganizations: 24, activeOrganizations: 21, totalUsers: 1842,
          totalBookings: 8740, totalRevenue: 3248000, mrr: 144000,
        },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — SUPER_ADMIN required' })
  getSuperAdminDashboard() {
    return this.dashboardService.getSuperAdminDashboard();
  }
}
