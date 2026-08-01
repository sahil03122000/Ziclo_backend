import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '@prisma/client';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RoleGuard } from '../common/guards/role.guard';
import { AuthUser } from '../common/types/auth-user.type';
import { BookingReportQueryDto } from '../reports/dto/booking-report-query.dto';
import { WorkerReportQueryDto } from '../reports/dto/worker-report-query.dto';
import { ManagerAttendanceReportQueryDto } from './dto/manager-attendance-report-query.dto';
import { ManagerService } from './manager.service';

@ApiTags('Manager Reports')
@ApiBearerAuth('JWT')
@UseGuards(JwtAuthGuard, RoleGuard)
@Roles(Role.MANAGER)
@Controller('managers/reports')
export class ManagerReportsController {
  constructor(private readonly managerService: ManagerService) {}

  @Get('dashboard')
  @ApiOperation({
    summary: 'Reports dashboard — MANAGER, own team only',
    description:
      'totalJobs/completedJobs/pendingJobs/cancelledJobs are Booking counts for this manager. ' +
      'totalWorkers/presentWorkers/absentWorkers reuse the same source as the Home dashboard. ' +
      'monthlyRevenue/monthlyCommission/monthlySalaryPayable are all scoped to the current ' +
      'calendar month.',
  })
  @ApiOkResponse({ description: 'Dashboard summary' })
  getDashboard(@CurrentUser() user: AuthUser) {
    return this.managerService.getReportsDashboard(user);
  }

  @Get('attendance')
  @ApiOperation({
    summary: 'Attendance report — MANAGER, own team only',
    description:
      'Filters: period (today/week/month), startDate/endDate (win over period when sent), ' +
      "workerId (must belong to the manager's own team).",
  })
  @ApiOkResponse({ description: 'Paginated attendance report' })
  getAttendance(
    @CurrentUser() user: AuthUser,
    @Query() query: ManagerAttendanceReportQueryDto,
  ) {
    return this.managerService.getReportsAttendance(user, query);
  }

  @Get('jobs')
  @ApiOperation({
    summary: 'Jobs (bookings) report — MANAGER, own team only',
    description:
      'Filters: workerId, serviceId, status, startDate, endDate. managerId is always forced ' +
      "to the caller — a manager can never see another manager's bookings.",
  })
  @ApiOkResponse({ description: 'Paginated jobs report' })
  getJobs(
    @CurrentUser() user: AuthUser,
    @Query() query: BookingReportQueryDto,
  ) {
    return this.managerService.getReportsJobs(user, query);
  }

  @Get('earnings')
  @ApiOperation({
    summary: 'Earnings summary — MANAGER, own team only',
    description:
      'totalEarnings/cashPayments/onlinePayments are successful payments; pendingPayments are ' +
      "payments not yet settled. All scoped to this manager's bookings.",
  })
  @ApiOkResponse({ description: 'Earnings summary' })
  getEarnings(@CurrentUser() user: AuthUser) {
    return this.managerService.getReportsEarnings(user);
  }

  @Get('workers')
  @ApiOperation({
    summary: 'Worker performance report — MANAGER, own team only',
    description:
      'Per-worker completedJobs, attendancePercentage, and earnings this period. rating is ' +
      'always null — no rating feature exists yet in this codebase.',
  })
  @ApiOkResponse({ description: 'Paginated worker performance report' })
  getWorkers(
    @CurrentUser() user: AuthUser,
    @Query() query: WorkerReportQueryDto,
  ) {
    return this.managerService.getReportsWorkers(user, query);
  }
}
