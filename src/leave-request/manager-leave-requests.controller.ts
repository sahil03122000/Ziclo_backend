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

@ApiTags('Manager / Leave Requests')
@ApiBearerAuth('JWT')
@UseGuards(JwtAuthGuard, RoleGuard)
@Roles(Role.MANAGER)
@Controller('managers/me/leave-requests')
export class ManagerLeaveRequestsController {
  constructor(private readonly leaveRequestService: LeaveRequestService) {}

  @Get()
  @ApiOperation({
    summary: 'Leave requests for my team — MANAGER',
    description: 'Pending, Approved, Rejected, and Cancelled — only workers assigned to this manager. Optionally filter by ?status=.',
  })
  @ApiResponse({ status: 200, description: 'Paginated leave request list' })
  list(@CurrentUser() user: AuthUser, @Query() query: QueryLeaveRequestsDto) {
    return this.leaveRequestService.managerList(user, query);
  }

  @Get(':id')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    summary: 'Leave request detail — MANAGER',
    description: 'Worker Profile, Attendance Summary, Leave Balance, Leave Details, and Approval History.',
  })
  @ApiResponse({ status: 200, description: 'Leave request detail' })
  @ApiResponse({ status: 404, description: 'Not found in your team' })
  detail(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.leaveRequestService.managerDetail(user, id);
  }

  @Patch(':id/approve')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    summary: 'Approve a leave request — MANAGER',
    description: 'If the request was created with adminApprovalRequired=true, this escalates to ADMIN instead of finalizing.',
  })
  @ApiResponse({ status: 200, description: 'Decision recorded' })
  @ApiResponse({ status: 403, description: 'Request is not in your team' })
  @ApiResponse({ status: 404, description: 'Request not found' })
  approve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApproveLeaveRequestDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.leaveRequestService.managerApprove(id, dto, user);
  }

  @Patch(':id/reject')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Reject a leave request — MANAGER', description: 'Final at manager level — never escalates.' })
  @ApiResponse({ status: 200, description: 'Decision recorded' })
  @ApiResponse({ status: 403, description: 'Request is not in your team' })
  @ApiResponse({ status: 404, description: 'Request not found' })
  reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectLeaveRequestDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.leaveRequestService.managerReject(id, dto, user);
  }
}
