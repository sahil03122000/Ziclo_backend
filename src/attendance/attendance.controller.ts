import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '@prisma/client';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RoleGuard } from '../common/guards/role.guard';
import type { AuthUser } from '../common/types/auth-user.type';
import { AttendanceService } from './attendance.service';
import { AttendanceSummaryQueryDto } from './dto/attendance-summary-query.dto';
import {
  AttendanceAdminQueryDto,
  AttendanceHistoryQueryDto,
} from './dto/attendance-query.dto';
import { CheckInDto } from './dto/check-in.dto';
import { CheckOutDto } from './dto/check-out.dto';
import { CorrectAttendanceDto } from './dto/correct-attendance.dto';

@ApiTags('Attendance')
@ApiBearerAuth('JWT')
@UseGuards(JwtAuthGuard, RoleGuard)
@Controller('attendance')
export class AttendanceController {
  constructor(private readonly attendanceService: AttendanceService) {}

  @Roles(Role.WORKER, Role.MANAGER)
  @Post('checkin')
  @ApiOperation({
    summary: 'Check in with GPS coordinates and selfie — WORKER / MANAGER',
    description:
      'Records a check-in for the day. GPS coordinates are validated against the assigned office location geofence. ' +
      'Selfie URL should be from a prior `POST /uploads` call. ' +
      'Only one check-in allowed per day — returns an error if already checked in. ' +
      'For MANAGER callers only (WORKER behavior is unchanged): officeLocationId must be one ' +
      "of the manager's own assigned offices, its area must be one of the manager's own " +
      'assigned areas, and — if a shift is assigned — check-in must fall on a working day ' +
      'within the shift window (+ grace period at the start). Each check is skipped if the ' +
      "manager has no such assignment configured yet, so an incomplete profile doesn't lock " +
      'them out entirely.',
  })
  @ApiResponse({
    status: 201,
    description:
      "Checked in successfully — the response's data also includes attendanceStatus, " +
      'checkInTime, workingDuration (seconds elapsed, ~0 right after check-in), and ' +
      'todaySummary (the same shape as GET attendance/me/today) so the caller never needs a ' +
      "second request to reflect today's attendance immediately.",
    schema: {
      example: {
        success: true,
        data: {
          id: 'uuid',
          status: 'CHECKED_IN',
          checkInTime: '2026-06-21T09:00:00Z',
          checkInLatitude: 12.9716,
          checkInLongitude: 77.5946,
          attendanceStatus: 'CHECKED_IN',
          workingDuration: 0,
          todaySummary: {
            id: 'uuid',
            status: 'CHECKED_IN',
            checkInTime: '2026-06-21T09:00:00Z',
            checkOutTime: null,
            officeLocation: { id: 'uuid', name: 'HSR Office' },
          },
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description:
      'Already checked in today, outside geofence radius, not a working day, or outside shift hours',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({
    status: 403,
    description:
      "Forbidden — WORKER or MANAGER required, or (MANAGER only) office/area is not one of the manager's own assignments",
  })
  checkIn(@CurrentUser() user: AuthUser, @Body() dto: CheckInDto) {
    return this.attendanceService.checkIn(user.id, dto, user);
  }

  @Roles(Role.WORKER, Role.MANAGER)
  @Post('checkout')
  @ApiOperation({
    summary: 'Check out with GPS coordinates and selfie — WORKER / MANAGER',
    description:
      'Records check-out time. Must have an active check-in for today. ' +
      'For MANAGER callers only (WORKER behavior is unchanged): GPS coordinates are ' +
      "re-validated against the same office's geofence used at check-in.",
  })
  @ApiResponse({
    status: 201,
    description: 'Checked out successfully',
    schema: {
      example: {
        success: true,
        data: {
          id: 'uuid',
          status: 'CHECKED_OUT',
          checkOutTime: '2026-06-21T18:00:00Z',
          totalHours: 9,
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description:
      'No active check-in found for today, or (MANAGER only) outside geofence radius',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({
    status: 403,
    description: 'Forbidden — WORKER or MANAGER required',
  })
  checkOut(@CurrentUser() user: AuthUser, @Body() dto: CheckOutDto) {
    return this.attendanceService.checkOut(user.id, dto, user);
  }

  @Get(['me/today', 'today'])
  @ApiOperation({
    summary:
      "Today's attendance record for the authenticated user (WORKER / MANAGER) — own record only, resolved from the JWT",
  })
  @ApiResponse({
    status: 200,
    description: "Today's attendance or null if no check-in yet",
    schema: {
      example: {
        success: true,
        data: {
          id: 'uuid',
          status: 'CHECKED_IN',
          checkInTime: '2026-06-21T09:00:00Z',
          checkOutTime: null,
        },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  getTodayAttendance(@CurrentUser() user: AuthUser) {
    return this.attendanceService.getTodayAttendance(user.id);
  }

  @Get('me/history')
  @ApiOperation({
    summary: 'Paginated attendance history for the authenticated user',
  })
  @ApiResponse({ status: 200, description: 'Attendance history list' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  getHistory(
    @CurrentUser() user: AuthUser,
    @Query() query: AttendanceHistoryQueryDto,
  ) {
    return this.attendanceService.getHistory(user.id, query);
  }

  @Get(['me/summary', 'monthly'])
  @ApiOperation({
    summary:
      'Monthly attendance summary for the authenticated user (WORKER / MANAGER) — own record only — ?month=6&year=2026',
    description:
      'Scoped to exactly the requested calendar month (defaults to the current month) — never ' +
      'leaks previous-month or future-month records. For the current, still-in-progress month, ' +
      'totalDays (and therefore absentCount/attendancePercentage) only counts days up to today ' +
      '— future days in the month are never counted as "should have attended". totalHours ' +
      'includes a still-open session from today (elapsed time so far), not just completed ' +
      "attendance. presentCount/halfDayCount are split using the user's own assigned Shift's " +
      'fullDayHours/halfDayHours thresholds when a shift is assigned; without one, every ' +
      'attendance row counts as present (unchanged legacy behavior). totalDays also respects ' +
      "the assigned shift's workingDays; without one, defaults to every day except Sunday " +
      '(unchanged legacy behavior). leaveCount is always 0 — no leave/absence-request tracking ' +
      'exists in this schema yet. attendancePercentage = round(presentCount / totalDays * 100).',
  })
  @ApiResponse({
    status: 200,
    description: 'Monthly summary',
    schema: {
      example: {
        success: true,
        data: {
          month: 6,
          year: 2026,
          totalDays: 26,
          presentCount: 20,
          absentCount: 4,
          totalHours: 176.5,
          avgHoursPerDay: 8.83,
          halfDayCount: 2,
          leaveCount: 0,
          attendancePercentage: 77,
        },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  getMonthlySummary(
    @CurrentUser() user: AuthUser,
    @Query() query: AttendanceSummaryQueryDto,
  ) {
    return this.attendanceService.getMonthlySummary(user.id, query);
  }

  @Roles(Role.ADMIN)
  @Get()
  @ApiOperation({ summary: 'All attendance records with filters — ADMIN' })
  @ApiResponse({ status: 200, description: 'Paginated attendance list' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — ADMIN required' })
  findAll(@Query() query: AttendanceAdminQueryDto) {
    return this.attendanceService.findAll(query);
  }

  @Roles(Role.ADMIN)
  @Get(':id')
  @ApiOperation({ summary: 'Single attendance record by ID — ADMIN' })
  @ApiParam({ name: 'id', description: 'Attendance UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Attendance record' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — ADMIN required' })
  @ApiResponse({ status: 404, description: 'Record not found' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.attendanceService.findOne(id);
  }

  @Roles(Role.ADMIN)
  @Patch(':id')
  @ApiOperation({
    summary: 'Admin correction of check-in / check-out times — ADMIN',
    description:
      'Used to manually correct erroneous check-in or check-out timestamps. Logged in audit trail.',
  })
  @ApiParam({ name: 'id', description: 'Attendance UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Attendance corrected' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — ADMIN required' })
  @ApiResponse({ status: 404, description: 'Record not found' })
  correct(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CorrectAttendanceDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.attendanceService.correct(id, dto, user.id);
  }
}
