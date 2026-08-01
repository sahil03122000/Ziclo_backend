import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Request } from 'express';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RoleGuard } from '../common/guards/role.guard';
import { AuthUser } from '../common/types/auth-user.type';
import { AssignWorkerDto } from './dto/assign-worker.dto';
import { CompleteTaskDto } from './dto/complete-task.dto';
import { CreateTaskDto } from './dto/create-task.dto';
import { RejectTaskDto } from './dto/reject-task.dto';
import { TaskQueryDto } from './dto/task-query.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { TasksService } from './tasks.service';

@ApiTags('Tasks')
@ApiBearerAuth('JWT')
@Controller('tasks')
@UseGuards(JwtAuthGuard, RoleGuard)
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  // ─── Scoped views (before /:id) ──────────────────────────────────────────

  @Get('my-team')
  @Roles(Role.MANAGER)
  @ApiOperation({ summary: 'Tasks assigned to workers in my team — MANAGER' })
  @ApiResponse({ status: 200, description: 'Paginated task list' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — MANAGER required' })
  getMyTeamTasks(@CurrentUser() user: AuthUser, @Query() query: TaskQueryDto, @Req() req: Request) {
    return this.tasksService.getMyTeamTasks(user.id, query, req.organizationId);
  }

  @Get('my-tasks')
  @Roles(Role.WORKER)
  @ApiOperation({ summary: 'Tasks assigned to me — WORKER' })
  @ApiResponse({ status: 200, description: 'Paginated task list' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — WORKER required' })
  getMyTasks(@CurrentUser() user: AuthUser, @Query() query: TaskQueryDto, @Req() req: Request) {
    return this.tasksService.getMyTasks(user.id, query, req.organizationId);
  }

  // ─── ADMIN CRUD ───────────────────────────────────────────────────────────

  @Post()
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Create a new task — ADMIN' })
  @ApiResponse({ status: 201, description: 'Task created with status PENDING', schema: { example: { success: true, data: { id: 'uuid', title: 'Panel inspection', status: 'PENDING', priority: 'HIGH' } } } })
  @ApiResponse({ status: 400, description: 'Validation error or pincode not found' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — ADMIN required' })
  create(@Body() dto: CreateTaskDto, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.tasksService.create(dto, user.id, req.organizationId);
  }

  @Get()
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'List all tasks with filters and cursor/offset pagination — ADMIN' })
  @ApiResponse({ status: 200, description: 'Paginated task list' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — ADMIN required' })
  findAll(@Query() query: TaskQueryDto, @Req() req: Request) {
    return this.tasksService.findAll(query, req.organizationId);
  }

  @Get(':id')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Task detail with full history — ADMIN' })
  @ApiParam({ name: 'id', description: 'Task UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Task detail' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — ADMIN required' })
  @ApiResponse({ status: 404, description: 'Task not found' })
  findOne(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.tasksService.findOne(id, req.organizationId);
  }

  @Patch(':id')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Update task title, description, priority, or due date — ADMIN' })
  @ApiParam({ name: 'id', description: 'Task UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Task updated' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — ADMIN required' })
  @ApiResponse({ status: 404, description: 'Task not found' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTaskDto, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.tasksService.update(id, dto, user.id, req.organizationId);
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Delete a task — ADMIN' })
  @ApiParam({ name: 'id', description: 'Task UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Task deleted' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — ADMIN required' })
  @ApiResponse({ status: 404, description: 'Task not found' })
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.tasksService.remove(id, user.id, req.organizationId);
  }

  // ─── MANAGER actions ─────────────────────────────────────────────────────

  @Patch(':id/assign-worker')
  @Roles(Role.MANAGER)
  @ApiOperation({ summary: 'Reassign a task to a worker within the manager\'s area — MANAGER' })
  @ApiParam({ name: 'id', description: 'Task UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Worker reassigned' })
  @ApiResponse({ status: 400, description: 'Worker not in manager\'s area' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — MANAGER required' })
  @ApiResponse({ status: 404, description: 'Task or worker not found' })
  assignWorker(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AssignWorkerDto, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.tasksService.assignWorker(id, user.id, dto, req.organizationId);
  }

  @Post(':id/approve')
  @Roles(Role.MANAGER)
  @ApiOperation({ summary: 'Approve a completed task: COMPLETED → APPROVED — MANAGER' })
  @ApiParam({ name: 'id', description: 'Task UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Task approved' })
  @ApiResponse({ status: 400, description: 'Task is not in COMPLETED status' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — MANAGER required' })
  @ApiResponse({ status: 404, description: 'Task not found' })
  approveTask(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.tasksService.approveTask(id, user.id, req.organizationId);
  }

  @Post(':id/reject')
  @Roles(Role.MANAGER)
  @ApiOperation({ summary: 'Reject completed task and return it to IN_PROGRESS — MANAGER' })
  @ApiParam({ name: 'id', description: 'Task UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Task rejected — returned to worker' })
  @ApiResponse({ status: 400, description: 'Task is not in COMPLETED status' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — MANAGER required' })
  @ApiResponse({ status: 404, description: 'Task not found' })
  rejectTask(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RejectTaskDto, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.tasksService.rejectTask(id, user.id, dto, req.organizationId);
  }

  // ─── WORKER actions ───────────────────────────────────────────────────────

  @Post(':id/start')
  @Roles(Role.WORKER)
  @ApiOperation({ summary: 'Start task: PENDING → IN_PROGRESS — WORKER' })
  @ApiParam({ name: 'id', description: 'Task UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Task started' })
  @ApiResponse({ status: 400, description: 'Task is not in PENDING status or not assigned to this worker' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — WORKER required' })
  @ApiResponse({ status: 404, description: 'Task not found' })
  startTask(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.tasksService.startTask(id, user.id, req.organizationId);
  }

  @Post(':id/complete')
  @Roles(Role.WORKER)
  @ApiOperation({
    summary: 'Complete task with before/after photos — WORKER',
    description: 'Transitions task to COMPLETED. Before and after photo URLs (from `POST /uploads`) are optional but recommended.',
  })
  @ApiParam({ name: 'id', description: 'Task UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Task completed — manager notified for approval' })
  @ApiResponse({ status: 400, description: 'Task is not IN_PROGRESS or not assigned to this worker' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — WORKER required' })
  @ApiResponse({ status: 404, description: 'Task not found' })
  completeTask(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CompleteTaskDto, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.tasksService.completeTask(id, user.id, dto, req.organizationId);
  }
}
