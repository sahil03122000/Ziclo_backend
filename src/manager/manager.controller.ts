import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Request } from 'express';

import { QueryLiveWorkersDto } from '../admin/dto/query-live-workers.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RoleGuard } from '../common/guards/role.guard';
import { AuthUser } from '../common/types/auth-user.type';
import { ManagerAreaQueryDto } from './dto/manager-area-query.dto';
import { ManagerService } from './manager.service';

@ApiTags('Manager')
@ApiBearerAuth('JWT')
@UseGuards(JwtAuthGuard, RoleGuard)
@Roles(Role.MANAGER)
@Controller('managers/me')
export class ManagerController {
  constructor(private readonly managerService: ManagerService) {}

  @Get('dashboard')
  @ApiOperation({
    summary: "Logged-in manager's Home dashboard — MANAGER",
    description:
      "Team stats plus the manager's own attendanceStatus/checkInTime/checkOutTime/" +
      'workingDuration/currentShift/office/area/monthlySummary/history/historyMeta (all ' +
      'reused from GET managers/me/attendance — not re-derived or re-queried here). Covers ' +
      'Today Attendance, current-month Monthly Summary, and recent Attendance History in a ' +
      'single call — the frontend never needs GET attendance/me/today or ' +
      'attendance/me/summary separately.',
  })
  @ApiResponse({
    status: 200,
    description: 'Manager dashboard metrics',
    schema: {
      example: {
        success: true,
        data: {
          totalWorkers: 12,
          activeWorkers: 10,
          presentToday: 8,
          absentToday: 2,
          pendingJobs: 5,
          completedJobs: 20,
          todaysJobs: 6,
          revenueToday: 4500,
          recentActivities: [],
          unreadNotifications: 3,
          attendanceStatus: 'CHECKED_IN',
          checkInTime: '2026-07-19T09:00:00Z',
          checkOutTime: null,
          workingDuration: 3600,
          currentShift: { id: 'uuid', name: 'Morning Shift' },
          office: { id: 'uuid', name: 'HSR Office' },
          area: { id: 'uuid', name: 'HSR Layout' },
          monthlySummary: {
            month: 7,
            year: 2026,
            totalDays: 19,
            presentCount: 15,
            absentCount: 4,
            totalHours: 132.5,
            avgHoursPerDay: 8.83,
            halfDayCount: 1,
            leaveCount: 0,
            attendancePercentage: 79,
          },
          history: [],
          historyMeta: { total: 1, page: 1, limit: 10, totalPages: 1 },
        },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — MANAGER required' })
  getDashboard(@CurrentUser() user: AuthUser) {
    return this.managerService.getDashboard(user);
  }

  @Get('attendance')
  @ApiOperation({
    summary:
      "Logged-in manager's attendance — Today, Monthly Summary, and History — MANAGER",
    description:
      'Also serves as the Manager Timer: workingDuration is a live elapsed-time figure ' +
      '(seconds) computed from checkInTime to now while still checked in, or to checkOutTime ' +
      'once checked out. checkIn/checkOut are kept for backward compatibility alongside the ' +
      'additive checkInTime/checkOutTime/workingDuration/currentShift/office/area fields. ' +
      'monthlySummary (current calendar month, reused from AttendanceService.getMonthlySummary) ' +
      'and history/historyMeta (10 most recent records, reused from ' +
      'AttendanceService.getHistory) are also included so the frontend never needs a separate ' +
      'GET attendance/me/today or attendance/me/summary call for this screen.',
  })
  @ApiResponse({
    status: 200,
    description:
      "Today's attendance, current month summary, and recent history",
    schema: {
      example: {
        success: true,
        data: {
          checkIn: '2026-07-14T09:00:00Z',
          checkOut: null,
          workingHours: null,
          attendanceStatus: 'CHECKED_IN',
          checkInTime: '2026-07-14T09:00:00Z',
          checkOutTime: null,
          workingDuration: 3600,
          currentShift: { id: 'uuid', name: 'Morning Shift' },
          office: { id: 'uuid', name: 'HSR Office' },
          area: { id: 'uuid', name: 'HSR Layout' },
          monthlySummary: {
            month: 7,
            year: 2026,
            totalDays: 19,
            presentCount: 15,
            absentCount: 4,
            totalHours: 132.5,
            avgHoursPerDay: 8.83,
            halfDayCount: 1,
            leaveCount: 0,
            attendancePercentage: 79,
          },
          history: [],
          historyMeta: { total: 1, page: 1, limit: 10, totalPages: 1 },
        },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — MANAGER required' })
  getAttendance(@CurrentUser() user: AuthUser) {
    return this.managerService.getAttendance(user);
  }

  @Get('areas')
  @ApiOperation({
    summary:
      "Logged-in manager's office location and assigned areas — MANAGER — " +
      'optionally ?officeLocationIds=id1,id2,id3',
    description:
      'Without officeLocationIds: returns { officeLocation, assignedAreas } (unchanged, ' +
      'used by Manager Home). With officeLocationIds: returns a flat array of areas across ' +
      "the given office(s), scoped to the manager's own offices — used by Add/Edit Worker.",
  })
  @ApiResponse({
    status: 200,
    description: 'Office location and assigned areas, or a filtered area list',
    schema: {
      example: {
        success: true,
        data: {
          officeLocation: {
            id: 'uuid',
            name: 'HSR Office',
            address: '...',
            latitude: 12.9,
            longitude: 77.6,
            radius: 200,
          },
          assignedAreas: [
            {
              id: 'uuid',
              name: 'HSR Layout',
              pincode: '560102',
              city: 'Bengaluru',
              district: null,
              state: 'Karnataka',
            },
          ],
        },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — MANAGER required' })
  @ApiResponse({ status: 404, description: 'Manager profile not found' })
  getAreas(@CurrentUser() user: AuthUser, @Query() query: ManagerAreaQueryDto) {
    return this.managerService.getAreas(user, query.officeLocationIds);
  }

  @Get('support')
  @ApiOperation({
    summary: "Logged-in manager's support ticket summary — MANAGER",
    description:
      "Scoped to this manager's own team: tickets tied to a booking they manage directly " +
      "or that one of their own workers performed. Never another manager's tickets.",
  })
  @ApiResponse({
    status: 200,
    description: 'Support ticket counts and recent tickets',
    schema: {
      example: {
        success: true,
        data: { openTickets: 4, resolvedTickets: 15, recentTickets: [] },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — MANAGER required' })
  getSupport(@CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.managerService.getSupport(user, req.organizationId);
  }

  @Get('live-workers')
  @ApiOperation({
    summary:
      "Live status of the logged-in manager's own team — MANAGER — managerId is always resolved from the JWT, never from the client",
  })
  @ApiResponse({
    status: 200,
    description:
      "Live worker tracking list scoped to the manager's assigned areas",
    schema: {
      example: {
        success: true,
        message: 'Live workers fetched successfully',
        data: {
          workers: [
            {
              id: 'uuid',
              name: 'Ravi Kumar',
              phone: '9876543210',
              status: 'active',
              currentJob: 'AC Repair',
              currentLocation: { latitude: 12.97, longitude: 77.59 },
              lastUpdated: '2026-07-15T09:30:00Z',
              distanceFromOffice: 1.2,
              isAvailable: false,
            },
          ],
          meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
        },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — MANAGER required' })
  getLiveWorkers(
    @CurrentUser() user: AuthUser,
    @Query() query: QueryLiveWorkersDto,
  ) {
    return this.managerService.getLiveWorkers(user, query);
  }

  @Get('office-locations')
  @ApiOperation({
    summary:
      'ALL office locations directly assigned to the logged-in manager — MANAGER',
  })
  @ApiResponse({
    status: 200,
    description: 'Office locations directly assigned to the manager',
    schema: {
      example: {
        success: true,
        data: [
          {
            id: 'uuid',
            name: 'HSR Office',
            address: '123 HSR Layout, Bengaluru',
          },
          {
            id: 'uuid2',
            name: 'Koramangala Office',
            address: '456 Koramangala, Bengaluru',
          },
        ],
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — MANAGER required' })
  getOfficeLocations(@CurrentUser() user: AuthUser) {
    return this.managerService.getOfficeLocations(user);
  }
}
