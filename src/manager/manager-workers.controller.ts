import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Request } from 'express';

import { AttendanceHistoryQueryDto } from '../attendance/dto/attendance-query.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RoleGuard } from '../common/guards/role.guard';
import { AuthUser } from '../common/types/auth-user.type';
import { AssignTaskDto } from './dto/assign-task.dto';
import { CreateManagerWorkerDto } from './dto/create-manager-worker.dto';
import { UpdateManagerWorkerDto } from './dto/update-manager-worker.dto';
import { ManagerWorkerListQueryDto } from './dto/worker-list-query.dto';
import { ManagerService } from './manager.service';

@ApiTags('Manager Workers')
@ApiBearerAuth('JWT')
@UseGuards(JwtAuthGuard, RoleGuard)
@Roles(Role.MANAGER)
@Controller('managers/workers')
export class ManagerWorkersController {
  constructor(private readonly managerService: ManagerService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create a worker — MANAGER, own offices/areas only',
    description:
      'officeLocationIds must all belong to the manager; areaIds must all belong to ' +
      'the selected offices (the deprecated assignedAreaIds is still accepted — either field ' +
      'is required). shiftId (optional) must reference an existing, active Shift ' +
      '(from GET managers/shifts) and is persisted on the worker. WorkerProfile has no ' +
      'multi-office/multi-area join table, so only areaIds[0] is actually saved; the ' +
      "worker's office(s) are derived from that area's own office links. Optional profile " +
      '(gender, dateOfBirth, address), KYC (aadhaarNumber, aadhaarFrontImage, aadhaarBackImage, ' +
      'panNumber, panImage), employment ' +
      '(employmentType: SALARY | COMMISSION, monthlySalary, paymentCycle: MONTHLY | WEEKLY, ' +
      'salaryStartDate, commissionRules), bank details (bankDetails: accountHolderName, ' +
      'bankName, accountNumber, ifscCode, branchName, upiId), and remarks (max 1000 chars) ' +
      'are also accepted and persisted. The deprecated flat bank fields, joiningDate, ' +
      'commissions, and remark are still accepted for backward compatibility.',
  })
  @ApiCreatedResponse({
    description: 'Worker created',
    schema: {
      example: {
        success: true,
        message: 'Worker created successfully',
        data: {
          id: 'uuid',
          name: 'Ravi Kumar',
          email: 'ravi@example.com',
          phone: '9876543210',
          role: 'WORKER',
          isActive: true,
          employeeCode: 'WRK-3A9F2C',
          shiftId: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
          shift: {
            id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
            name: 'Shift A',
            startTime: '08:00',
            endTime: '17:00',
          },
          officeLocationIds: ['uuid1'],
          officeLocations: [
            { id: 'uuid1', name: 'HSR Office', address: '...' },
          ],
          areaIds: ['areaUuid1'],
          assignedAreaIds: ['areaUuid1'],
          assignedAreas: [
            { id: 'areaUuid1', name: 'HSR Layout', pincode: '560102' },
          ],
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description:
      'Office/area does not belong to the manager, or invalid combination',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — MANAGER required' })
  @ApiResponse({ status: 409, description: 'Email or phone already in use' })
  createWorker(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateManagerWorkerDto,
  ) {
    return this.managerService.createWorker(user, dto);
  }

  // ─── Scoped views (must be registered before the ':id' routes below) ────────

  @Get('present')
  @ApiOperation({
    summary: "Today's checked-in workers — MANAGER, own team only",
  })
  @ApiResponse({
    status: 200,
    description: 'Paginated list of present workers',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — MANAGER required' })
  getPresentWorkers(
    @CurrentUser() user: AuthUser,
    @Query() query: ManagerWorkerListQueryDto,
  ) {
    return this.managerService.getPresentWorkers(user, query);
  }

  @Get('absent')
  @ApiOperation({ summary: "Today's absent workers — MANAGER, own team only" })
  @ApiResponse({ status: 200, description: 'Paginated list of absent workers' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — MANAGER required' })
  getAbsentWorkers(
    @CurrentUser() user: AuthUser,
    @Query() query: ManagerWorkerListQueryDto,
  ) {
    return this.managerService.getAbsentWorkers(user, query);
  }

  @Get()
  @ApiOperation({
    summary: "Logged-in manager's worker list — MANAGER, own team only",
    description:
      'Includes `todayAttendanceStatus` (PRESENT | ABSENT | HALF_DAY | LEAVE | NO_CHECKIN — ' +
      'only PRESENT/NO_CHECKIN are currently reachable) alongside the existing `todayAttendance` object.',
  })
  @ApiResponse({
    status: 200,
    description: "Paginated, filterable list of the manager's own workers",
    schema: {
      example: {
        success: true,
        data: {
          workers: [
            {
              id: 'uuid',
              name: 'Ravi Kumar',
              phone: '9876543210',
              profileImage: null,
              status: 'active',
              todayAttendance: {
                status: 'CHECKED_IN',
                checkInTime: '09:00',
                checkOutTime: null,
                workingHours: '02:15',
              },
              todayAttendanceStatus: 'PRESENT',
              assignedArea: { id: 'uuid', name: 'HSR Layout' },
              officeLocation: { id: 'uuid', name: 'HSR Office' },
              currentTask: 'AC Repair',
              rating: null,
              totalJobs: 42,
              completedJobs: 38,
            },
          ],
          meta: { total: 1, page: 1, limit: 20, totalPages: 1 },
        },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — MANAGER required' })
  getWorkerList(
    @CurrentUser() user: AuthUser,
    @Query() query: ManagerWorkerListQueryDto,
  ) {
    return this.managerService.getWorkerList(user, query);
  }

  // ─── Single-worker views ──────────────────────────────────────────────────

  @Get(':id')
  @ApiOperation({
    summary:
      'Worker detail: profile, attendance, tasks, earnings — MANAGER, own team only',
    description:
      'Includes `todayAttendanceStatus` (PRESENT | ABSENT | HALF_DAY | LEAVE | NO_CHECKIN — ' +
      'only PRESENT/NO_CHECKIN are currently reachable) alongside the existing `todayAttendance` object.',
  })
  @ApiParam({ name: 'id', description: 'Worker user UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Worker detail' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — MANAGER required' })
  @ApiResponse({ status: 404, description: 'Worker not found in your team' })
  getWorkerDetails(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.managerService.getWorkerDetails(user, id, req.organizationId);
  }

  @Patch(':id')
  @ApiOperation({
    summary:
      'Update a worker — profile, office/area/shift, KYC, employment, bank details — MANAGER, own team only',
    description:
      'Partial update — only fields sent are changed. Email/phone/aadhaarNumber/panNumber must ' +
      'remain globally unique. Profile fields (gender, dateOfBirth, address) are each updated ' +
      'independently when sent. officeLocationIds (if sent) must all belong to the manager; ' +
      'areaIds (if sent) must each belong to at least one of officeLocationIds, or — if ' +
      "officeLocationIds is omitted — one of the manager's own offices. Only areaIds[0] is " +
      "persisted as the worker's new area (mirrors createWorker). shiftId (if sent) must " +
      'reference an existing, active Shift. When employmentType is sent as SALARY, ' +
      'monthlySalary is required in the same request; when sent as COMMISSION, at least one ' +
      'commissionRules record is required (the deprecated commissions field is also accepted). ' +
      "Sending commissionRules fully replaces the worker's existing commission rates. " +
      'bankDetails (accountHolderName, bankName, accountNumber, ifscCode, branchName, upiId) ' +
      'sub-fields and remarks (max 1000 chars) are each updated independently when sent. The ' +
      'deprecated flat bank fields, joiningDate/salaryStartDate, and remark/remarks are aliases ' +
      'of each other — the new name wins if both are sent.',
  })
  @ApiParam({ name: 'id', description: 'Worker user UUID', format: 'uuid' })
  @ApiOkResponse({ description: 'Worker updated' })
  @ApiResponse({
    status: 400,
    description:
      'Invalid KYC format, office/area does not belong to the manager, area does not belong to ' +
      'the selected offices, shift not found/inactive, missing monthlySalary/commissionRules ' +
      'for the resolved employmentType, or email/phone/Aadhaar/PAN already registered',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — MANAGER required' })
  @ApiResponse({ status: 404, description: 'Worker not found in your team' })
  updateWorker(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateManagerWorkerDto,
  ) {
    return this.managerService.updateWorker(user, id, dto);
  }

  @Get(':id/attendance')
  @ApiOperation({
    summary:
      "A worker's attendance history — MANAGER, own team only — ?startDate=&endDate=",
  })
  @ApiParam({ name: 'id', description: 'Worker user UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Paginated attendance history' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — MANAGER required' })
  @ApiResponse({ status: 404, description: 'Worker not found in your team' })
  getWorkerAttendanceHistory(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: AttendanceHistoryQueryDto,
  ) {
    return this.managerService.getWorkerAttendanceHistory(user, id, query);
  }

  @Post(':id/assign-task')
  @ApiOperation({
    summary: 'Assign a worker to a task — MANAGER, own team only',
    description:
      'Validates the worker belongs to the manager, is active, and has no in-progress task before assigning.',
  })
  @ApiParam({ name: 'id', description: 'Worker user UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Worker assigned to the task' })
  @ApiResponse({
    status: 400,
    description: 'Worker is inactive or already has an in-progress task',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — MANAGER required' })
  @ApiResponse({ status: 404, description: 'Worker or task not found' })
  assignTask(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignTaskDto,
    @Req() req: Request,
  ) {
    return this.managerService.assignWorkerToTask(
      user,
      id,
      dto,
      req.organizationId,
    );
  }

  @Get(':id/status')
  @ApiOperation({
    summary: 'Live status of one worker — MANAGER, own team only',
  })
  @ApiParam({ name: 'id', description: 'Worker user UUID', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Live worker status',
    schema: {
      example: {
        success: true,
        data: {
          online: true,
          status: 'active',
          currentLocation: { latitude: 12.97, longitude: 77.59 },
          battery: null,
          lastUpdated: '2026-07-15T09:30:00Z',
          currentTask: 'AC Repair',
        },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — MANAGER required' })
  @ApiResponse({ status: 404, description: 'Worker not found in your team' })
  getWorkerLiveStatus(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.managerService.getWorkerLiveStatus(user, id);
  }
}
