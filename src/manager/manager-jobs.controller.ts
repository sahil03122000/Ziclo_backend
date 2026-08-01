import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '@prisma/client';

import { AssignWorkerDto } from '../booking/bookings/dto/assign-worker.dto';
import { CancelBookingDto } from '../booking/bookings/dto/cancel-booking.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RoleGuard } from '../common/guards/role.guard';
import { AuthUser } from '../common/types/auth-user.type';
import { ManagerJobQueryDto } from './dto/manager-job-query.dto';
import { ManagerService } from './manager.service';

@ApiTags('Manager Jobs')
@ApiBearerAuth('JWT')
@UseGuards(JwtAuthGuard, RoleGuard)
@Roles(Role.MANAGER)
@Controller('managers/jobs')
export class ManagerJobsController {
  constructor(private readonly managerService: ManagerService) {}

  @Get('dashboard')
  @ApiOperation({
    summary: 'Jobs dashboard — MANAGER, own team only',
    description:
      'Booking status counts scoped to this manager: jobs assigned to them directly or ' +
      'performed by one of their own workers. pendingJobs groups PENDING+CONFIRMED; ' +
      'cancelledJobs groups CANCELLED+NO_SHOW.',
  })
  @ApiOkResponse({ description: 'Job status counts' })
  getDashboard(@CurrentUser() user: AuthUser) {
    return this.managerService.getJobsDashboard(user);
  }

  @Get()
  @ApiOperation({
    summary: 'List jobs — MANAGER, own team only',
    description:
      'Filters: status, serviceId, workerId, officeLocationId, areaId, customerId, search, ' +
      "startDate, endDate. Never returns jobs outside this manager's own office locations, " +
      'areas, or workers.',
  })
  @ApiOkResponse({ description: 'Paginated job list' })
  getJobs(@CurrentUser() user: AuthUser, @Query() query: ManagerJobQueryDto) {
    return this.managerService.getJobsList(user, query);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Job detail — MANAGER, own team only',
    description:
      'Customer, worker, service, office locations, area, timeline (status history), ' +
      'payment, remarks. beforeImages/afterImages are always empty — no image storage exists ' +
      'for bookings in this schema (only Task-level photos exist).',
  })
  @ApiParam({ name: 'id', description: 'Booking UUID', format: 'uuid' })
  @ApiOkResponse({ description: 'Job detail' })
  @ApiResponse({ status: 404, description: 'Job not found in your team' })
  getJobDetail(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.managerService.getJobDetail(user, id);
  }

  @Patch(':id/assign-worker')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Assign a worker to a job (first assignment) — MANAGER, own team only',
    description:
      "The worker must belong to this manager's own team. Fails if the job already has a " +
      'worker assigned — use reassign-worker instead.',
  })
  @ApiParam({ name: 'id', description: 'Booking UUID', format: 'uuid' })
  @ApiBody({ type: AssignWorkerDto })
  @ApiOkResponse({ description: 'Worker assigned, job set to ASSIGNED' })
  @ApiResponse({
    status: 400,
    description: 'Job already has a worker assigned',
  })
  @ApiResponse({
    status: 404,
    description: 'Job or worker not found in your team',
  })
  assignWorker(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignWorkerDto,
  ) {
    return this.managerService.assignJobWorker(user, id, dto);
  }

  @Patch(':id/reassign-worker')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Reassign a job to a different worker — MANAGER, own team only',
    description:
      "The new worker must belong to this manager's own team. Fails if the job has no " +
      'worker assigned yet — use assign-worker instead.',
  })
  @ApiParam({ name: 'id', description: 'Booking UUID', format: 'uuid' })
  @ApiBody({ type: AssignWorkerDto })
  @ApiOkResponse({ description: 'Worker reassigned' })
  @ApiResponse({ status: 400, description: 'Job has no worker assigned yet' })
  @ApiResponse({
    status: 404,
    description: 'Job or worker not found in your team',
  })
  reassignWorker(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignWorkerDto,
  ) {
    return this.managerService.reassignJobWorker(user, id, dto);
  }

  @Patch(':id/start')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Start a job on behalf of its assigned worker — MANAGER, own team only',
    description:
      'Requires a worker already assigned. Fails if not currently in a startable status.',
  })
  @ApiParam({ name: 'id', description: 'Booking UUID', format: 'uuid' })
  @ApiOkResponse({ description: 'Job set to IN_PROGRESS' })
  @ApiResponse({
    status: 400,
    description: 'No worker assigned, or invalid status transition',
  })
  @ApiResponse({ status: 404, description: 'Job not found in your team' })
  start(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.managerService.startJob(user, id);
  }

  @Patch(':id/complete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Complete a job — MANAGER, own team only' })
  @ApiParam({ name: 'id', description: 'Booking UUID', format: 'uuid' })
  @ApiOkResponse({ description: 'Job set to COMPLETED' })
  @ApiResponse({
    status: 400,
    description: 'Job is not in a completable status',
  })
  @ApiResponse({ status: 404, description: 'Job not found in your team' })
  complete(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.managerService.completeJob(user, id);
  }

  @Patch(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel a job — MANAGER, own team only' })
  @ApiParam({ name: 'id', description: 'Booking UUID', format: 'uuid' })
  @ApiBody({ type: CancelBookingDto })
  @ApiOkResponse({ description: 'Job set to CANCELLED' })
  @ApiResponse({
    status: 400,
    description: 'Job is already in a terminal state',
  })
  @ApiResponse({ status: 404, description: 'Job not found in your team' })
  cancel(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelBookingDto,
  ) {
    return this.managerService.cancelJob(user, id, dto);
  }
}
