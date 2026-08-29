import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AttendanceStatus, AuditAction, LeaveRequestStatus, Prisma, Role, Task, TaskPhotoType, TaskStatus } from '@prisma/client';

import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { getTodayRange } from '../common/utils/date.util';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { AssignWorkerDto } from './dto/assign-worker.dto';
import { CompleteTaskDto } from './dto/complete-task.dto';
import { CreateTaskDto } from './dto/create-task.dto';
import { RejectTaskDto } from './dto/reject-task.dto';
import { TaskQueryDto } from './dto/task-query.dto';
import { UpdateTaskDto } from './dto/update-task.dto';

// ─── Select shapes ─────────────────────────────────────────────────────────────

const TASK_USER_SELECT = {
  id: true,
  name: true,
  email: true,
  role: true,
  profileImage: true,
} satisfies Prisma.UserSelect;

const TASK_AREA_SELECT = {
  id: true,
  name: true,
  city: true,
  state: true,
} satisfies Prisma.AreaSelect;

const TASK_PINCODE_SELECT = {
  id: true,
  pincode: true,
  city: true,
  state: true,
} satisfies Prisma.PincodeSelect;

const TASK_PHOTO_SELECT = {
  id: true,
  type: true,
  imageUrl: true,
  createdAt: true,
} satisfies Prisma.TaskPhotoSelect;

const TASK_INCLUDE = {
  area: { select: TASK_AREA_SELECT },
  pincode: { select: TASK_PINCODE_SELECT },
  assignedManager: { select: TASK_USER_SELECT },
  assignedWorker: { select: TASK_USER_SELECT },
  createdBy: { select: TASK_USER_SELECT },
  photos: { select: TASK_PHOTO_SELECT },
} satisfies Prisma.TaskInclude;

// ─── Status transitions ────────────────────────────────────────────────────────

const ALLOWED_TRANSITIONS: Partial<Record<TaskStatus, TaskStatus[]>> = {
  [TaskStatus.PENDING]: [TaskStatus.IN_PROGRESS],
  [TaskStatus.IN_PROGRESS]: [TaskStatus.COMPLETED_PENDING_APPROVAL],
  [TaskStatus.COMPLETED_PENDING_APPROVAL]: [TaskStatus.COMPLETED, TaskStatus.IN_PROGRESS],
};

@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  // ─── ADMIN ────────────────────────────────────────────────────────────────────

  async create(dto: CreateTaskDto, adminId: string, orgId?: string) {
    await this.validatePincode(dto.pincodeId);
    if (dto.assignedManagerId) await this.validateManagerForPincode(dto.assignedManagerId, dto.pincodeId);
    if (dto.assignedWorkerId) await this.validateWorkerForPincode(dto.assignedWorkerId, dto.pincodeId);

    const task = await this.prisma.task.create({
      data: {
        title: dto.title,
        description: dto.description,
        priority: dto.priority,
        dueDate: new Date(dto.dueDate),
        pincodeId: dto.pincodeId,
        areaId: dto.areaId,
        assignedManagerId: dto.assignedManagerId,
        assignedWorkerId: dto.assignedWorkerId,
        createdById: adminId,
        organizationId: orgId ?? null,
      },
      include: TASK_INCLUDE,
    });

    this.auditLogs
      .log({ actorId: adminId, entityType: 'Task', entityId: task.id, action: AuditAction.CREATE, newValue: { title: task.title, priority: task.priority, status: task.status } })
      .catch(() => {});

    if (dto.assignedWorkerId) {
      this.notifications
        .notify(dto.assignedWorkerId, 'New Task Assigned', `You have been assigned: ${task.title}`, { taskId: task.id })
        .catch(() => {});
    }

    return { success: true, message: 'Task created successfully', data: task };
  }

  async findAll(query: TaskQueryDto, orgId?: string) {
    const { page = 1, limit = 20, status, priority, pincodeId, areaId, assignedManagerId, assignedWorkerId, search, dueDateFrom, dueDateTo, cursor } = query;

    const where = this.buildTaskWhere({ status, priority, pincodeId, areaId, assignedManagerId, assignedWorkerId, search, dueDateFrom, dueDateTo, organizationId: orgId });

    const paginationArgs: Prisma.TaskFindManyArgs = cursor
      ? { cursor: { id: cursor }, skip: 1, take: limit }
      : { skip: (page - 1) * limit, take: limit };

    const [tasks, total] = await Promise.all([
      this.prisma.task.findMany({ where, ...paginationArgs, include: TASK_INCLUDE, orderBy: { createdAt: 'desc' } }),
      cursor ? Promise.resolve(null) : this.prisma.task.count({ where }),
    ]);

    const nextCursor = tasks.length === limit ? tasks[tasks.length - 1].id : null;

    return {
      success: true,
      data: {
        tasks,
        meta: cursor
          ? { count: tasks.length, nextCursor }
          : { total: total!, page, limit, totalPages: Math.ceil(total! / limit), nextCursor },
      },
    };
  }

  async findOne(id: string, orgId?: string) {
    const task = await this.prisma.task.findUnique({ where: { id }, include: TASK_INCLUDE });
    if (!task) throw new NotFoundException('Task not found');
    if (orgId && task.organizationId !== orgId) throw new NotFoundException('Task not found');
    return { success: true, data: task };
  }

  async update(id: string, dto: UpdateTaskDto, actorId?: string, orgId?: string) {
    const task = await this.requireTask(id, orgId);

    if (dto.pincodeId && dto.pincodeId !== task.pincodeId) await this.validatePincode(dto.pincodeId);
    const targetPincodeId = dto.pincodeId ?? task.pincodeId;

    if (dto.assignedManagerId && targetPincodeId) {
      await this.validateManagerForPincode(dto.assignedManagerId, targetPincodeId);
    }
    if (dto.assignedWorkerId && targetPincodeId) {
      await this.validateWorkerForPincode(dto.assignedWorkerId, targetPincodeId);
    }

    const updated = await this.prisma.task.update({
      where: { id },
      data: {
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.priority !== undefined && { priority: dto.priority }),
        ...(dto.dueDate !== undefined && { dueDate: new Date(dto.dueDate) }),
        ...(dto.pincodeId !== undefined && { pincodeId: dto.pincodeId }),
        ...(dto.areaId !== undefined && { areaId: dto.areaId }),
        ...(dto.assignedManagerId !== undefined && { assignedManagerId: dto.assignedManagerId }),
        ...(dto.assignedWorkerId !== undefined && { assignedWorkerId: dto.assignedWorkerId }),
      },
      include: TASK_INCLUDE,
    });

    this.auditLogs
      .log({ actorId, entityType: 'Task', entityId: id, action: AuditAction.UPDATE, oldValue: { title: task.title }, newValue: { ...dto } })
      .catch(() => {});

    return { success: true, message: 'Task updated successfully', data: updated };
  }

  async remove(id: string, actorId?: string, orgId?: string) {
    const task = await this.requireTask(id, orgId);
    await this.prisma.task.delete({ where: { id } });

    this.auditLogs
      .log({ actorId, entityType: 'Task', entityId: id, action: AuditAction.DELETE, oldValue: { title: task.title, status: task.status } })
      .catch(() => {});

    return { success: true, message: 'Task deleted successfully' };
  }

  // ─── MANAGER ──────────────────────────────────────────────────────────────────

  async getMyTeamTasks(managerId: string, query: TaskQueryDto, orgId?: string) {
    const { page = 1, limit = 20, status, priority, search, dueDateFrom, dueDateTo, cursor } = query;

    const where: Prisma.TaskWhereInput = {
      assignedManagerId: managerId,
      ...this.buildTaskWhere({ status, priority, search, dueDateFrom, dueDateTo, organizationId: orgId }),
    };

    const paginationArgs: Prisma.TaskFindManyArgs = cursor
      ? { cursor: { id: cursor }, skip: 1, take: limit }
      : { skip: (page - 1) * limit, take: limit };

    const [tasks, total] = await Promise.all([
      this.prisma.task.findMany({ where, ...paginationArgs, include: TASK_INCLUDE, orderBy: { createdAt: 'desc' } }),
      cursor ? Promise.resolve(null) : this.prisma.task.count({ where }),
    ]);

    const nextCursor = tasks.length === limit ? tasks[tasks.length - 1].id : null;
    return {
      success: true,
      data: {
        tasks,
        meta: cursor
          ? { count: tasks.length, nextCursor }
          : { total: total!, page, limit, totalPages: Math.ceil(total! / limit), nextCursor },
      },
    };
  }

  async assignWorker(taskId: string, managerId: string, dto: AssignWorkerDto, orgId?: string) {
    const task = await this.requireTask(taskId, orgId);

    if (task.assignedManagerId !== managerId) throw new ForbiddenException('You are not the assigned manager for this task');
    if (task.status === TaskStatus.COMPLETED) throw new BadRequestException('Cannot reassign on a completed task');

    if (task.pincodeId) {
      await this.validateWorkerForPincode(dto.workerId, task.pincodeId);
      await this.validateWorkerInManagerPincodes(dto.workerId, managerId);
    }

    // Re-checked at the exact moment of assignment (not earlier, e.g. when the manager's
    // assignment screen was opened) — a worker who checks out between screen-open and the
    // manager pressing "Assign" must still be blocked here.
    await this.assertWorkerOnDuty(dto.workerId);

    const updated = await this.prisma.task.update({
      where: { id: taskId },
      data: { assignedWorkerId: dto.workerId },
      include: TASK_INCLUDE,
    });

    this.auditLogs
      .log({ actorId: managerId, entityType: 'Task', entityId: taskId, action: AuditAction.ASSIGN, oldValue: { workerId: task.assignedWorkerId }, newValue: { workerId: dto.workerId } })
      .catch(() => {});

    this.notifications
      .notify(dto.workerId, 'Task Assigned', `You have been assigned: ${task.title}`, { taskId })
      .catch(() => {});

    return { success: true, message: 'Worker assigned successfully', data: updated };
  }

  async approveTask(taskId: string, managerId: string, orgId?: string) {
    const task = await this.requireTask(taskId, orgId);

    if (task.assignedManagerId !== managerId) throw new ForbiddenException('You are not the assigned manager for this task');
    if (task.status !== TaskStatus.COMPLETED_PENDING_APPROVAL) {
      throw new BadRequestException(`Task must be COMPLETED_PENDING_APPROVAL to approve. Current: ${task.status}`);
    }

    const updated = await this.prisma.task.update({
      where: { id: taskId },
      data: { status: TaskStatus.COMPLETED, completedAt: new Date() },
      include: TASK_INCLUDE,
    });

    this.auditLogs
      .log({ actorId: managerId, entityType: 'Task', entityId: taskId, action: AuditAction.STATUS_CHANGE, oldValue: { status: task.status }, newValue: { status: TaskStatus.COMPLETED } })
      .catch(() => {});

    if (task.assignedWorkerId) {
      this.notifications
        .notify(task.assignedWorkerId, 'Task Approved', `Your task "${task.title}" has been approved.`, { taskId })
        .catch(() => {});
    }

    return { success: true, message: 'Task approved and marked as completed', data: updated };
  }

  async rejectTask(taskId: string, managerId: string, dto: RejectTaskDto, orgId?: string) {
    const task = await this.requireTask(taskId, orgId);

    if (task.assignedManagerId !== managerId) throw new ForbiddenException('You are not the assigned manager for this task');
    if (task.status !== TaskStatus.COMPLETED_PENDING_APPROVAL) {
      throw new BadRequestException(`Task must be COMPLETED_PENDING_APPROVAL to reject. Current: ${task.status}`);
    }

    const updated = await this.prisma.task.update({
      where: { id: taskId },
      data: {
        status: TaskStatus.IN_PROGRESS,
        completionNote: task.completionNote
          ? `${task.completionNote}\n\n[REJECTED] ${dto.rejectionNote ?? ''}`
          : `[REJECTED] ${dto.rejectionNote ?? ''}`,
      },
      include: TASK_INCLUDE,
    });

    this.auditLogs
      .log({ actorId: managerId, entityType: 'Task', entityId: taskId, action: AuditAction.STATUS_CHANGE, oldValue: { status: task.status }, newValue: { status: TaskStatus.IN_PROGRESS, rejectionNote: dto.rejectionNote } })
      .catch(() => {});

    if (task.assignedWorkerId) {
      this.notifications
        .notify(task.assignedWorkerId, 'Task Rejected', `Your task "${task.title}" was rejected. ${dto.rejectionNote ?? ''}`.trim(), { taskId })
        .catch(() => {});
    }

    return { success: true, message: 'Task rejected and returned to in-progress', data: updated };
  }

  // ─── WORKER ───────────────────────────────────────────────────────────────────

  async getMyTasks(workerId: string, query: TaskQueryDto, orgId?: string) {
    const { page = 1, limit = 20, status, priority, search, dueDateFrom, dueDateTo, cursor } = query;

    const where: Prisma.TaskWhereInput = {
      assignedWorkerId: workerId,
      ...this.buildTaskWhere({ status, priority, search, dueDateFrom, dueDateTo, organizationId: orgId }),
    };

    const paginationArgs: Prisma.TaskFindManyArgs = cursor
      ? { cursor: { id: cursor }, skip: 1, take: limit }
      : { skip: (page - 1) * limit, take: limit };

    const [tasks, total] = await Promise.all([
      this.prisma.task.findMany({ where, ...paginationArgs, include: TASK_INCLUDE, orderBy: { dueDate: 'asc' } }),
      cursor ? Promise.resolve(null) : this.prisma.task.count({ where }),
    ]);

    const nextCursor = tasks.length === limit ? tasks[tasks.length - 1].id : null;
    return {
      success: true,
      data: {
        tasks,
        meta: cursor
          ? { count: tasks.length, nextCursor }
          : { total: total!, page, limit, totalPages: Math.ceil(total! / limit), nextCursor },
      },
    };
  }

  async startTask(taskId: string, workerId: string, orgId?: string) {
    const task = await this.requireTask(taskId, orgId);
    if (task.assignedWorkerId !== workerId) throw new ForbiddenException('This task is not assigned to you');
    this.assertTransition(task.status, TaskStatus.IN_PROGRESS);

    const updated = await this.prisma.task.update({
      where: { id: taskId },
      data: { status: TaskStatus.IN_PROGRESS },
      include: TASK_INCLUDE,
    });

    this.auditLogs
      .log({ actorId: workerId, entityType: 'Task', entityId: taskId, action: AuditAction.STATUS_CHANGE, oldValue: { status: task.status }, newValue: { status: TaskStatus.IN_PROGRESS } })
      .catch(() => {});

    if (task.assignedManagerId) {
      this.notifications
        .notify(task.assignedManagerId, 'Task Started', `Worker has started: "${task.title}"`, { taskId })
        .catch(() => {});
    }

    return { success: true, message: 'Task started', data: updated };
  }

  async completeTask(taskId: string, workerId: string, dto: CompleteTaskDto, orgId?: string) {
    const task = await this.requireTask(taskId, orgId);
    if (task.assignedWorkerId !== workerId) throw new ForbiddenException('This task is not assigned to you');
    this.assertTransition(task.status, TaskStatus.COMPLETED_PENDING_APPROVAL);

    const updated = await this.prisma.task.update({
      where: { id: taskId },
      data: {
        status: TaskStatus.COMPLETED_PENDING_APPROVAL,
        completionNote: dto.completionNote,
        photos: {
          create: [
            { imageUrl: dto.beforeImageUrl, type: TaskPhotoType.BEFORE },
            { imageUrl: dto.afterImageUrl, type: TaskPhotoType.AFTER },
          ],
        },
      },
      include: TASK_INCLUDE,
    });

    this.auditLogs
      .log({ actorId: workerId, entityType: 'Task', entityId: taskId, action: AuditAction.STATUS_CHANGE, oldValue: { status: task.status }, newValue: { status: TaskStatus.COMPLETED_PENDING_APPROVAL } })
      .catch(() => {});

    if (task.assignedManagerId) {
      this.notifications
        .notify(task.assignedManagerId, 'Task Awaiting Approval', `"${task.title}" is ready for your review.`, { taskId })
        .catch(() => {});
    }

    return { success: true, message: 'Task submitted for approval', data: updated };
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────────

  private buildTaskWhere(filters: {
    status?: TaskStatus;
    priority?: any;
    pincodeId?: string;
    areaId?: string;
    assignedManagerId?: string;
    assignedWorkerId?: string;
    search?: string;
    dueDateFrom?: string;
    dueDateTo?: string;
    organizationId?: string;
  }): Prisma.TaskWhereInput {
    const where: Prisma.TaskWhereInput = {};
    if (filters.organizationId) where.organizationId = filters.organizationId;
    if (filters.status) where.status = filters.status;
    if (filters.priority) where.priority = filters.priority;
    if (filters.pincodeId) where.pincodeId = filters.pincodeId;
    else if (filters.areaId) where.areaId = filters.areaId;
    if (filters.assignedManagerId) where.assignedManagerId = filters.assignedManagerId;
    if (filters.assignedWorkerId) where.assignedWorkerId = filters.assignedWorkerId;
    if (filters.search) {
      where.OR = [
        { title: { contains: filters.search, mode: 'insensitive' } },
        { description: { contains: filters.search, mode: 'insensitive' } },
      ];
    }
    if (filters.dueDateFrom || filters.dueDateTo) {
      where.dueDate = {};
      if (filters.dueDateFrom) where.dueDate.gte = new Date(filters.dueDateFrom);
      if (filters.dueDateTo) where.dueDate.lte = new Date(filters.dueDateTo);
    }
    return where;
  }

  // Fetch task by id; throws 404 if not found or if orgId is set and doesn't match.
  // Using findUnique (PK lookup) + post-fetch org check keeps this fast while
  // never leaking the existence of cross-tenant tasks.
  private async requireTask(id: string, orgId?: string): Promise<Task> {
    const task = await this.prisma.task.findUnique({ where: { id } });
    if (!task) throw new NotFoundException('Task not found');
    if (orgId && task.organizationId !== orgId) throw new NotFoundException('Task not found');
    return task;
  }

  private assertTransition(from: TaskStatus, to: TaskStatus): void {
    const allowed = ALLOWED_TRANSITIONS[from] ?? [];
    if (!allowed.includes(to)) {
      throw new BadRequestException(`Invalid status transition from ${from} to ${to}`);
    }
  }

  private async validatePincode(pincodeId: string): Promise<void> {
    const pincode = await this.prisma.pincode.findUnique({ where: { id: pincodeId } });
    if (!pincode) throw new NotFoundException('Pincode not found');
    if (!pincode.isActive) throw new BadRequestException('Pincode is not active');
  }

  private async validateManagerForPincode(managerId: string, pincodeId: string): Promise<void> {
    const manager = await this.prisma.user.findUnique({
      where: { id: managerId },
      select: { role: true, isActive: true, managerProfile: { select: { pincodes: { select: { pincodeId: true } } } } },
    });
    if (!manager || manager.role !== Role.MANAGER) throw new BadRequestException('Assigned manager is not a valid manager');
    if (!manager.isActive) throw new BadRequestException('Assigned manager account is inactive');

    const pincodes = manager.managerProfile?.pincodes.map((p) => p.pincodeId) ?? [];
    if (!pincodes.includes(pincodeId)) throw new BadRequestException('Manager is not assigned to the specified pincode');
  }

  private async validateWorkerForPincode(workerId: string, pincodeId: string): Promise<void> {
    const worker = await this.prisma.user.findUnique({
      where: { id: workerId },
      select: { role: true, isActive: true, workerProfile: { select: { pincodeId: true } } },
    });
    if (!worker || worker.role !== Role.WORKER) throw new BadRequestException('Assigned worker is not a valid worker');
    if (!worker.isActive) throw new BadRequestException('Assigned worker account is inactive');
    if (worker.workerProfile?.pincodeId !== pincodeId) throw new BadRequestException('Worker is not assigned to the specified pincode');
  }

  private async validateWorkerInManagerPincodes(workerId: string, managerId: string): Promise<void> {
    const [worker, managerProfile] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: workerId }, select: { workerProfile: { select: { pincodeId: true } } } }),
      this.prisma.managerProfile.findUnique({ where: { userId: managerId }, select: { pincodes: { select: { pincodeId: true } } } }),
    ]);

    const workerPincodeId = worker?.workerProfile?.pincodeId;
    const managerPincodeIds = managerProfile?.pincodes.map((p) => p.pincodeId) ?? [];
    if (!workerPincodeId || !managerPincodeIds.includes(workerPincodeId)) {
      throw new ForbiddenException('Worker does not belong to your pincode area');
    }
  }

  // Business rule: a task can only be assigned to a Worker who is currently on duty — active,
  // not on approved leave today, and has a currently-OPEN check-in session for TODAY (checking
  // in then checking out still blocks assignment; an open session from a previous day does not
  // count — see getTodayRange). Reuses the exact same "open session for today" query
  // AttendanceService already uses everywhere else (attendance.service.ts) rather than
  // inventing a second attendance-status system; duplicated here (not injected) because
  // AttendanceModule isn't wired into TasksModule and importing it would need to be checked
  // for circularity — this is a handful of direct Prisma reads against the same existing
  // tables, not a new one.
  private async assertWorkerOnDuty(workerId: string): Promise<void> {
    const NOT_ON_DUTY_MESSAGE = 'Worker is not checked in. Task cannot be assigned until the worker checks in.';

    const worker = await this.prisma.user.findUnique({
      where: { id: workerId },
      select: { isActive: true },
    });
    if (!worker || !worker.isActive) throw new BadRequestException(NOT_ON_DUTY_MESSAGE);

    const { start, end } = getTodayRange();

    // Same exact-match convention leave-request.service.ts's own duplicate-date check already
    // uses (WorkerLeaveRequest.date is stored as new Date(dateOnlyString), i.e. UTC midnight of
    // that calendar date) — not getTodayRange's local-time window, which is specific to
    // Attendance.checkInTime (a true timestamp), a different field with different semantics.
    const todayDateOnly = new Date(new Date().toISOString().split('T')[0]);
    const onApprovedLeave = await this.prisma.workerLeaveRequest.findFirst({
      where: { workerId, status: LeaveRequestStatus.APPROVED, date: todayDateOnly },
      select: { id: true },
    });
    if (onApprovedLeave) throw new BadRequestException(NOT_ON_DUTY_MESSAGE);

    const openSession = await this.prisma.attendance.findFirst({
      where: { userId: workerId, checkInTime: { gte: start, lt: end }, status: AttendanceStatus.CHECKED_IN },
      select: { id: true },
    });
    if (!openSession) throw new BadRequestException(NOT_ON_DUTY_MESSAGE);
  }
}
