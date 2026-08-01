import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ActivityAction,
  ActivityModule,
  AuditAction,
  Prisma,
  Role,
  SalaryType,
} from '@prisma/client';
import { Response } from 'express';
import { randomBytes } from 'crypto';
import * as bcrypt from 'bcrypt';

import { ActivityLogService } from '../activity-log/activity-log.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuthUser } from '../common/types/auth-user.type';
import { DuplicateCheckService } from '../common/services/duplicate-check.service';
import { PrismaService } from '../prisma/prisma.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UpdateUserRoleDto } from './dto/update-user-role.dto';
import { UsersQueryDto } from './dto/users-query.dto';

// Numeric rank used to enforce "actor must outrank target" rule.
const ROLE_RANK: Record<Role, number> = {
  [Role.USER]: 0,
  [Role.WORKER]: 1,
  [Role.MANAGER]: 2,
  [Role.ORGANIZATION_ADMIN]: 3,
  [Role.ADMIN]: 3,
  [Role.SUPER_ADMIN]: 4,
};

// Which roles each actor is permitted to assign.
// SUPER_ADMIN is never in any list — it cannot be assigned via the API.
const ROLE_CAN_ASSIGN: Partial<Record<Role, Role[]>> = {
  [Role.SUPER_ADMIN]: [Role.ADMIN, Role.MANAGER, Role.WORKER, Role.USER],
  [Role.ADMIN]: [Role.MANAGER, Role.WORKER, Role.USER],
  [Role.ORGANIZATION_ADMIN]: [Role.MANAGER, Role.WORKER, Role.USER],
  [Role.MANAGER]: [Role.WORKER],
};

const USER_SAFE_SELECT = {
  id: true,
  name: true,
  email: true,
  phone: true,
  role: true,
  profileImage: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly activityLog: ActivityLogService,
    private readonly duplicateCheck: DuplicateCheckService,
  ) {}

  // ─── ADMIN ────────────────────────────────────────────────────────────────────

  async getWorkerStats() {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const [
      workerTotal,
      workerActive,
      workerInactive,
      workerCheckedInToday,
      managerTotal,
      managerActive,
      managerCheckedInToday,
    ] = await this.prisma.$transaction([
      this.prisma.workerProfile.count(),
      this.prisma.workerProfile.count({ where: { user: { isActive: true } } }),
      this.prisma.workerProfile.count({ where: { user: { isActive: false } } }),
      this.prisma.attendance.count({
        where: {
          checkInTime: { gte: todayStart, lte: todayEnd },
          user: { role: Role.WORKER },
        },
      }),
      this.prisma.managerProfile.count(),
      this.prisma.managerProfile.count({ where: { user: { isActive: true } } }),
      this.prisma.attendance.count({
        where: {
          checkInTime: { gte: todayStart, lte: todayEnd },
          user: { role: Role.MANAGER },
        },
      }),
    ]);

    return {
      success: true,
      data: {
        workers: {
          total: workerTotal,
          active: workerActive,
          inactive: workerInactive,
          todayCheckedIn: workerCheckedInToday,
          onLeave: 0,
          absent: Math.max(0, workerActive - workerCheckedInToday),
        },
        managers: {
          total: managerTotal,
          active: managerActive,
          inactive: managerTotal - managerActive,
          todayCheckedIn: managerCheckedInToday,
          onLeave: 0,
          absent: Math.max(0, managerActive - managerCheckedInToday),
        },
      },
    };
  }

  async findAll(query: UsersQueryDto) {
    const { page = 1, limit = 20, role, search } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.UserWhereInput = {};
    if (role) where.role = role;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [users, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        select: USER_SAFE_SELECT,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      success: true,
      data: {
        users,
        meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
      },
    };
  }

  async findOne(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: USER_SAFE_SELECT,
    });
    if (!user) throw new NotFoundException('User not found');
    return { success: true, data: user };
  }

  async updateRole(id: string, dto: UpdateUserRoleDto, actor: AuthUser) {
    const target = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, role: true, isActive: true },
    });
    if (!target) throw new NotFoundException('User not found');

    // Actor must outrank the target's current role (cannot touch peers or superiors)
    if (ROLE_RANK[actor.role] <= ROLE_RANK[target.role]) {
      throw new ForbiddenException(
        `You cannot modify a user whose current role (${target.role}) is equal to or higher than yours`,
      );
    }

    // Actor must be permitted to assign the requested role
    const allowed = ROLE_CAN_ASSIGN[actor.role] ?? [];
    if (!allowed.includes(dto.role)) {
      throw new ForbiddenException(
        `A ${actor.role} cannot assign the ${dto.role} role`,
      );
    }

    // ── Role-specific profile validation and creation ──────────────────────────
    if (dto.role === Role.MANAGER) {
      const locationExists = await this.prisma.officeLocation.findUnique({
        where: { id: dto.officeLocationId! },
        select: { id: true },
      });
      if (!locationExists) {
        throw new BadRequestException(
          `Office location '${dto.officeLocationId}' not found`,
        );
      }

      await this.prisma.$transaction([
        this.prisma.user.update({
          where: { id },
          data: { role: Role.MANAGER, profileImage: dto.profileImage },
        }),
        this.prisma.managerProfile.upsert({
          where: { userId: id },
          create: {
            userId: id,
            employeeCode: `MGR-${randomBytes(3).toString('hex').toUpperCase()}`,
            officeLocationId: dto.officeLocationId!,
            shift: dto.shift!,
            salaryType: SalaryType.SALARY,
          },
          update: {
            officeLocationId: dto.officeLocationId!,
            shift: dto.shift!,
          },
        }),
      ]);
    } else if (dto.role === Role.WORKER) {
      const areaExists = await this.prisma.area.findUnique({
        where: { id: dto.areaId! },
        select: { id: true },
      });
      if (!areaExists) {
        throw new BadRequestException(`Area '${dto.areaId}' not found`);
      }

      await this.prisma.$transaction([
        this.prisma.user.update({
          where: { id },
          data: { role: Role.WORKER, profileImage: dto.profileImage },
        }),
        this.prisma.workerProfile.upsert({
          where: { userId: id },
          create: {
            userId: id,
            employeeCode: `WRK-${randomBytes(3).toString('hex').toUpperCase()}`,
            areaId: dto.areaId!,
            salaryType: SalaryType.SALARY,
          },
          update: {
            areaId: dto.areaId!,
          },
        }),
      ]);
    } else {
      await this.prisma.user.update({
        where: { id },
        data: { role: dto.role },
      });
    }

    const user = await this.prisma.user.findUnique({
      where: { id },
      select: USER_SAFE_SELECT,
    });

    this.auditLogs
      .log({
        actorId: actor.id,
        entityType: 'User',
        entityId: id,
        action: AuditAction.ROLE_CHANGE,
        oldValue: { role: target.role },
        newValue: { role: dto.role },
      })
      .catch(() => {});

    const roleActionMap: Partial<Record<Role, ActivityAction>> = {
      [Role.WORKER]: ActivityAction.WORKER_CREATED,
      [Role.MANAGER]: ActivityAction.MANAGER_CREATED,
      [Role.ADMIN]: ActivityAction.ADMIN_CREATED,
    };
    const roleModuleMap: Partial<Record<Role, ActivityModule>> = {
      [Role.WORKER]: ActivityModule.WORKER,
      [Role.MANAGER]: ActivityModule.MANAGER,
      [Role.ADMIN]: ActivityModule.ADMIN,
    };
    const roleAction = roleActionMap[dto.role as Role];
    if (roleAction) {
      this.activityLog.log({
        action: roleAction,
        module: roleModuleMap[dto.role as Role] ?? ActivityModule.ADMIN,
        description: `${user?.name} assigned as ${dto.role}`,
        actor: { id: actor.id, name: actor.name, role: actor.role },
        target: { id, type: 'User' },
        metadata: { previousRole: target.role, newRole: dto.role },
      });
    }

    return { success: true, data: user };
  }

  async toggleStatus(id: string, actorId?: string) {
    const existing = await this.assertExists(id);
    const user = await this.prisma.user.update({
      where: { id },
      data: { isActive: !existing.isActive },
      select: USER_SAFE_SELECT,
    });

    this.auditLogs
      .log({
        actorId,
        entityType: 'User',
        entityId: id,
        action: AuditAction.UPDATE,
        oldValue: { isActive: existing.isActive },
        newValue: { isActive: !existing.isActive },
      })
      .catch(() => {});

    return { success: true, data: user };
  }

  // ─── Profile (any authenticated user) ────────────────────────────────────────

  async getMyProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: USER_SAFE_SELECT,
    });
    if (!user) throw new NotFoundException('User not found');
    return { success: true, data: user };
  }

  async updateMyProfile(userId: string, dto: UpdateProfileDto) {
    await this.duplicateCheck.ensureUnique({
      email: dto.email,
      phone: dto.phone,
      excludeUserId: userId,
    });

    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.email !== undefined && { email: dto.email.toLowerCase() }),
        ...(dto.phone !== undefined && { phone: dto.phone }),
        ...(dto.profileImage !== undefined && {
          profileImage: dto.profileImage,
        }),
      },
      select: USER_SAFE_SELECT,
    });

    this.auditLogs
      .log({
        actorId: userId,
        entityType: 'User',
        entityId: userId,
        action: AuditAction.UPDATE,
        newValue: { ...dto },
      })
      .catch(() => {});
    this.activityLog.log({
      action: ActivityAction.PROFILE_UPDATED,
      module: ActivityModule.PROFILE,
      description: `${user.name} updated their profile`,
      actor: { id: userId, name: user.name, role: user.role },
      target: { id: userId, type: 'User' },
    });

    return {
      success: true,
      message: 'Profile updated successfully',
      data: user,
    };
  }

  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, password: true },
    });
    if (!user) throw new NotFoundException('User not found');

    const isCurrentValid = await bcrypt.compare(
      dto.currentPassword,
      user.password,
    );
    if (!isCurrentValid)
      throw new BadRequestException('Current password is incorrect');

    if (dto.currentPassword === dto.newPassword) {
      throw new BadRequestException(
        'New password must differ from current password',
      );
    }

    const hashedPassword = await bcrypt.hash(dto.newPassword, 10);

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { password: hashedPassword },
      }),
      this.prisma.refreshToken.deleteMany({ where: { userId } }),
    ]);

    this.auditLogs
      .log({
        actorId: userId,
        entityType: 'User',
        entityId: userId,
        action: AuditAction.UPDATE,
        newValue: { action: 'password_change' },
      })
      .catch(() => {});
    this.activityLog.log({
      action: ActivityAction.PASSWORD_CHANGED,
      module: ActivityModule.PROFILE,
      description: `User changed their password`,
      actor: { id: userId, name: 'User', role: Role.USER },
      target: { id: userId, type: 'User' },
    });

    return {
      success: true,
      message: 'Password changed. All sessions have been invalidated.',
    };
  }

  async exportCsv(query: UsersQueryDto, res: Response) {
    const where: Prisma.UserWhereInput = {};
    if (query.role) where.role = query.role;
    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { email: { contains: query.search, mode: 'insensitive' } },
        { phone: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const users = await this.prisma.user.findMany({
      where,
      select: { ...USER_SAFE_SELECT, organizationId: true },
      orderBy: { createdAt: 'desc' },
    });

    const escape = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const headers = [
      'id',
      'name',
      'email',
      'phone',
      'role',
      'isActive',
      'organizationId',
      'createdAt',
    ];
    const rows = users.map((u) =>
      headers.map((h) => escape((u as Record<string, unknown>)[h])).join(','),
    );
    const csv = [headers.join(','), ...rows].join('\n');

    const filename = `users-export-${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  }

  async deleteUser(id: string, actorId: string) {
    const target = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, role: true, email: true },
    });
    if (!target) throw new NotFoundException('User not found');
    if (target.role === Role.SUPER_ADMIN)
      throw new ForbiddenException(
        'SUPER_ADMIN accounts cannot be deleted via API',
      );
    if (id === actorId)
      throw new BadRequestException('You cannot delete your own account');

    await this.prisma.user.delete({ where: { id } });

    this.auditLogs
      .log({
        actorId,
        entityType: 'User',
        entityId: id,
        action: AuditAction.DELETE,
        oldValue: { email: target.email, role: target.role },
      })
      .catch(() => {});

    return { success: true, message: 'User permanently deleted' };
  }

  // ─── Private ──────────────────────────────────────────────────────────────────

  private async assertExists(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, isActive: true },
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }
}
