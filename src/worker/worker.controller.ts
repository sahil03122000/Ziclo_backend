import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RoleGuard } from '../common/guards/role.guard';
import type { AuthUser } from '../common/types/auth-user.type';
import { ApplyLeaveDto } from '../leave-request/dto/apply-leave.dto';
import { LeaveStatusQueryDto } from '../leave-request/dto/leave-status-query.dto';
import { LeaveRequestService } from '../leave-request/leave-request.service';
import { QueryAttendanceHistoryDto } from './dto/query-attendance-history.dto';
import { WorkerService } from './worker.service';

@ApiTags('Worker')
@ApiBearerAuth('JWT')
@UseGuards(JwtAuthGuard, RoleGuard)
@Roles(Role.WORKER)
@Controller('workers/me')
export class WorkerController {
  constructor(
    private readonly workerService: WorkerService,
    private readonly leaveRequestService: LeaveRequestService,
  ) {}

  @Get('dashboard')
  @ApiOperation({ summary: "Logged-in worker's Home dashboard — WORKER" })
  @ApiResponse({ status: 200, description: 'Worker dashboard: profile, today attendance, job counts, earnings' })
  getDashboard(@CurrentUser() user: AuthUser) {
    return this.workerService.getDashboard(user.id);
  }

  @Get('profile')
  @ApiOperation({ summary: "Logged-in worker's profile — WORKER (Worker Panel: Profile / Settings)" })
  @ApiResponse({ status: 200, description: 'Worker profile' })
  @ApiResponse({ status: 404, description: 'Worker profile not found' })
  getProfile(@CurrentUser() user: AuthUser) {
    return this.workerService.getProfile(user.id);
  }

  @Get('assigned-offices')
  @ApiOperation({ summary: "Offices assigned to the worker's area — WORKER (Worker Panel: Check-in geofencing + Profile)" })
  @ApiResponse({ status: 200, description: 'Assigned office list' })
  @ApiResponse({ status: 404, description: 'Worker profile not found' })
  getAssignedOffices(@CurrentUser() user: AuthUser) {
    return this.workerService.getAssignedOffices(user.id);
  }

  @Get('earnings')
  @ApiOperation({ summary: "Logged-in worker's earnings summary — WORKER" })
  @ApiResponse({ status: 200, description: 'today / thisWeek / thisMonth / total earnings, derived from completed jobs' })
  getEarnings(@CurrentUser() user: AuthUser) {
    return this.workerService.getEarnings(user.id);
  }

  @Get('attendance/today')
  @ApiOperation({ summary: "Today's attendance, grouped by session — WORKER (Worker Panel: Home / Attendance)" })
  @ApiResponse({ status: 200, description: 'Today\'s sessions, live check-in state' })
  getTodayAttendance(@CurrentUser() user: AuthUser) {
    return this.workerService.getTodayAttendance(user.id);
  }

  @Get('attendance/history')
  @ApiOperation({ summary: 'Attendance history grouped by day/session — WORKER (Worker Panel: Attendance)' })
  @ApiResponse({ status: 200, description: 'Attendance records for the requested window' })
  getAttendanceHistory(@CurrentUser() user: AuthUser, @Query() query: QueryAttendanceHistoryDto) {
    return this.workerService.getAttendanceHistory(user.id, query.days ?? 30);
  }

  @Post('leaves')
  @ApiOperation({ summary: 'Raise a leave request — WORKER (Worker Panel: Leave Request)' })
  @ApiResponse({ status: 201, description: 'Leave request submitted' })
  @ApiResponse({ status: 400, description: 'A pending request already exists for this date' })
  applyLeave(@CurrentUser() user: AuthUser, @Body() dto: ApplyLeaveDto) {
    return this.leaveRequestService.applyLeave(user.id, dto);
  }

  @Get('leaves/calendar')
  @ApiOperation({
    summary: 'Attendance-aware leave calendar data — WORKER (Worker Panel: Leave)',
    description:
      'joiningDate (WorkerProfile), per-day attendance status (PRESENT/ABSENT/LEAVE — reuses ' +
      'the same day-outcome logic as GET workers/me/attendance/history, with approved-leave ' +
      'dates filled in as LEAVE), and this worker\'s own leave requests with their type code/name ' +
      '(reused from GET workers/me/leaves, in the same paginate-free list shape) — everything the ' +
      'calendar needs in one call. ?days= controls how far back attendance is included (same ' +
      'range/default as attendance/history).',
  })
  @ApiResponse({ status: 200, description: 'Calendar data' })
  getLeaveCalendar(@CurrentUser() user: AuthUser, @Query() query: QueryAttendanceHistoryDto) {
    return this.workerService.getLeaveCalendar(user.id, query.days ?? 30);
  }

  @Get('leaves')
  @ApiOperation({
    summary: "Logged-in worker's leave request history — WORKER (Worker Panel: Leave Request)",
    description: 'Optionally filter by ?status=PENDING|APPROVED|REJECTED|CANCELLED. Omit to return the full history.',
  })
  @ApiResponse({ status: 200, description: 'Leave request list' })
  getMyLeaves(@CurrentUser() user: AuthUser, @Query() query: LeaveStatusQueryDto) {
    return this.leaveRequestService.getMyLeaves(user.id, query.status);
  }

  @Delete('leaves/:id')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Cancel a pending leave request — WORKER' })
  @ApiResponse({ status: 200, description: 'Leave request cancelled' })
  @ApiResponse({ status: 400, description: 'Only a pending request can be cancelled' })
  @ApiResponse({ status: 404, description: 'Leave request not found' })
  cancelLeave(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.leaveRequestService.cancelLeave(user.id, id);
  }
}
