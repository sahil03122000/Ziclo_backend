import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RoleGuard } from '../common/guards/role.guard';
import type { AuthUser } from '../common/types/auth-user.type';
import { ApproveLeaveRequestDto } from './dto/approve-leave-request.dto';
import { QueryLeaveRequestsDto } from './dto/query-leave-requests.dto';
import { RejectLeaveRequestDto } from './dto/reject-leave-request.dto';
import { LeaveRequestService } from './leave-request.service';

@ApiTags('Admin / Leave Requests')
@ApiBearerAuth('JWT')
@UseGuards(JwtAuthGuard, RoleGuard)
@Roles(Role.ADMIN, Role.SUPER_ADMIN, Role.ORGANIZATION_ADMIN)
@Controller('admin/leave-requests')
export class AdminLeaveRequestsController {
  constructor(private readonly leaveRequestService: LeaveRequestService) {}

  @Get()
  @ApiOperation({ summary: 'Leave requests awaiting admin approval — ADMIN' })
  @ApiResponse({ status: 200, description: 'Paginated pending request list' })
  pending(@Query() query: QueryLeaveRequestsDto) {
    return this.leaveRequestService.adminList(query);
  }

  @Patch(':id/approve')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Final approve a leave request — ADMIN' })
  @ApiResponse({ status: 200, description: 'Decision recorded' })
  @ApiResponse({ status: 404, description: 'Request not found' })
  approve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApproveLeaveRequestDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.leaveRequestService.adminApprove(id, dto, user);
  }

  @Patch(':id/reject')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Final reject a leave request — ADMIN' })
  @ApiResponse({ status: 200, description: 'Decision recorded' })
  @ApiResponse({ status: 404, description: 'Request not found' })
  reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectLeaveRequestDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.leaveRequestService.adminReject(id, dto, user);
  }
}
