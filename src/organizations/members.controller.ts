import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RoleGuard } from '../common/guards/role.guard';
import { AuthUser } from '../common/types/auth-user.type';
import { InviteMemberDto } from './dto/invite-member.dto';
import { UpdateMemberRoleDto } from './dto/update-member-role.dto';
import { MembersService } from './members.service';

@ApiTags('Organization Members')
@ApiBearerAuth('JWT')
@UseGuards(JwtAuthGuard)
@Controller('organizations/:orgId/members')
export class MembersController {
  constructor(private readonly membersService: MembersService) {}

  @Get()
  @ApiOperation({ summary: 'List organization members' })
  @ApiParam({ name: 'orgId', description: 'Organization UUID', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Member list',
    schema: {
      example: {
        success: true,
        data: [{ userId: 'uuid', name: 'Rahul Sharma', role: 'MANAGER', joinedAt: '2026-01-15T10:00:00Z', isActive: true }],
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  findAll(@Param('orgId', ParseUUIDPipe) orgId: string) {
    return this.membersService.findAll(orgId);
  }

  @Post()
  @UseGuards(RoleGuard)
  @Roles(Role.ADMIN, Role.SUPER_ADMIN, Role.ORGANIZATION_ADMIN)
  @ApiOperation({
    summary: 'Add / re-activate a member — ORG ADMIN',
    description: 'Adds an existing user to the organization. If the user was previously removed, their membership is re-activated.',
  })
  @ApiParam({ name: 'orgId', description: 'Organization UUID', format: 'uuid' })
  @ApiResponse({ status: 201, description: 'Member added' })
  @ApiResponse({ status: 400, description: 'User not found or already an active member' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — ORG ADMIN required' })
  invite(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() dto: InviteMemberDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.membersService.invite(orgId, dto, user.id);
  }

  @Patch(':userId/role')
  @UseGuards(RoleGuard)
  @Roles(Role.ADMIN, Role.SUPER_ADMIN, Role.ORGANIZATION_ADMIN)
  @ApiOperation({ summary: 'Update a member role — ORG ADMIN' })
  @ApiParam({ name: 'orgId', description: 'Organization UUID', format: 'uuid' })
  @ApiParam({ name: 'userId', description: 'Target user UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Member role updated' })
  @ApiResponse({ status: 400, description: 'Cannot change own role or last admin' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — ORG ADMIN required' })
  @ApiResponse({ status: 404, description: 'Member not found' })
  updateRole(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: UpdateMemberRoleDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.membersService.updateRole(orgId, userId, dto, user.id);
  }

  @Delete(':userId')
  @UseGuards(RoleGuard)
  @Roles(Role.ADMIN, Role.SUPER_ADMIN, Role.ORGANIZATION_ADMIN)
  @ApiOperation({ summary: 'Remove a member — ORG ADMIN (soft-deactivates membership)' })
  @ApiParam({ name: 'orgId', description: 'Organization UUID', format: 'uuid' })
  @ApiParam({ name: 'userId', description: 'Target user UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Member removed' })
  @ApiResponse({ status: 400, description: 'Cannot remove self or last admin' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — ORG ADMIN required' })
  @ApiResponse({ status: 404, description: 'Member not found' })
  remove(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.membersService.remove(orgId, userId, user.id);
  }
}
