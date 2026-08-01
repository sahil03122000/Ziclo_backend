import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Response } from 'express';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RoleGuard } from '../common/guards/role.guard';
import { AuthUser } from '../common/types/auth-user.type';
import { ChangePasswordDto } from './dto/change-password.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UpdateUserRoleDto } from './dto/update-user-role.dto';
import { UsersQueryDto } from './dto/users-query.dto';
import { UsersService } from './users.service';

@ApiTags('Users')
@ApiBearerAuth('JWT')
@UseGuards(JwtAuthGuard, RoleGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  // ─── Self-service (before /:id) ──────────────────────────────────────────

  @Get('me')
  @ApiOperation({ summary: 'Get own profile' })
  @ApiResponse({ status: 200, description: 'Own user profile', schema: { example: { success: true, data: { id: 'uuid', name: 'Ravi Kumar', email: 'ravi@example.com', role: 'USER', isActive: true } } } })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  getMyProfile(@CurrentUser() user: AuthUser) {
    return this.usersService.getMyProfile(user.id);
  }

  @Patch('me')
  @ApiOperation({ summary: 'Update own profile — name, email, phone, avatar' })
  @ApiResponse({ status: 200, description: 'Profile updated' })
  @ApiResponse({ status: 400, description: 'Validation error or email/phone conflict' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  updateMyProfile(@CurrentUser() user: AuthUser, @Body() dto: UpdateProfileDto) {
    return this.usersService.updateMyProfile(user.id, dto);
  }

  @Patch('me/password')
  @ApiOperation({
    summary: 'Change own password — invalidates all existing sessions',
    description: 'Requires `currentPassword` verification. All refresh tokens are revoked on success.',
  })
  @ApiResponse({ status: 200, description: 'Password changed — all sessions invalidated' })
  @ApiResponse({ status: 400, description: 'Current password incorrect or validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  changePassword(@CurrentUser() user: AuthUser, @Body() dto: ChangePasswordDto) {
    return this.usersService.changePassword(user.id, dto);
  }

  // ─── Admin ────────────────────────────────────────────────────────────────

  @Roles(Role.ADMIN)
  @Get('worker-stats')
  @ApiOperation({ summary: 'Worker & manager counts with today\'s attendance breakdown — ADMIN' })
  @ApiResponse({
    status: 200,
    description: 'Worker and manager stats including today check-in, absent, on-leave',
    schema: {
      example: {
        success: true,
        data: {
          workers: { total: 45, active: 38, inactive: 7, todayCheckedIn: 25, onLeave: 0, absent: 13 },
          managers: { total: 20, active: 17, inactive: 3, todayCheckedIn: 12, onLeave: 0, absent: 5 },
        },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — ADMIN required' })
  getWorkerStats() {
    return this.usersService.getWorkerStats();
  }

  @Roles(Role.ADMIN)
  @Get()
  @ApiOperation({ summary: 'List all users with filters and pagination — ADMIN' })
  @ApiResponse({ status: 200, description: 'Paginated user list' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — ADMIN required' })
  findAll(@Query() query: UsersQueryDto) {
    return this.usersService.findAll(query);
  }

  @Roles(Role.ADMIN)
  @Get('export')
  @ApiOperation({ summary: 'Export users as CSV (same filters as list) — ADMIN' })
  @ApiResponse({ status: 200, description: 'CSV file download', content: { 'text/csv': {} } })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — ADMIN required' })
  exportCsv(@Query() query: UsersQueryDto, @Res() res: Response) {
    return this.usersService.exportCsv(query, res);
  }

  @Roles(Role.ADMIN)
  @Get(':id')
  @ApiOperation({ summary: 'Get a single user by ID — ADMIN' })
  @ApiParam({ name: 'id', description: 'User UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'User detail' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — ADMIN required' })
  @ApiResponse({ status: 404, description: 'User not found' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.usersService.findOne(id);
  }

  @Roles(Role.ADMIN, Role.MANAGER)
  @Patch(':id/role')
  @ApiOperation({
    summary: 'Assign a role to a user — ADMIN / MANAGER',
    description:
      'Permission matrix:\n' +
      '- **ADMIN** → can assign MANAGER, WORKER, USER\n' +
      '- **MANAGER** → can assign WORKER only\n\n' +
      'SUPER_ADMIN is seed-only and never API-assignable.\n\n' +
      'When assigning **MANAGER**: `profileImage`, `officeLocationId`, and `shift` are required.\n' +
      'When assigning **WORKER**: `profileImage` and `areaId` are required.\n\n' +
      'ManagerProfile and WorkerProfile are created/updated automatically in the same transaction.',
  })
  @ApiParam({ name: 'id', description: 'User UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Role assigned — profile created/updated' })
  @ApiResponse({ status: 400, description: 'Missing required profile fields or unauthorized role escalation' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'User not found' })
  updateRole(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserRoleDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.usersService.updateRole(id, dto, actor);
  }

  @Roles(Role.ADMIN)
  @Patch(':id/status')
  @ApiOperation({ summary: 'Toggle user active/inactive — ADMIN' })
  @ApiParam({ name: 'id', description: 'User UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Status toggled', schema: { example: { success: true, data: { id: 'uuid', isActive: false } } } })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — ADMIN required' })
  @ApiResponse({ status: 404, description: 'User not found' })
  toggleStatus(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthUser) {
    return this.usersService.toggleStatus(id, actor.id);
  }

  @Roles(Role.SUPER_ADMIN)
  @Delete(':id')
  @ApiOperation({ summary: 'Permanently hard-delete a user and all associated data — SUPER_ADMIN only' })
  @ApiParam({ name: 'id', description: 'User UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'User permanently deleted' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — SUPER_ADMIN required' })
  @ApiResponse({ status: 404, description: 'User not found' })
  deleteUser(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthUser) {
    return this.usersService.deleteUser(id, actor.id);
  }
}
