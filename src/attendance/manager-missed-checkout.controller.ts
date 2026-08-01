import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RoleGuard } from '../common/guards/role.guard';
import type { AuthUser } from '../common/types/auth-user.type';
import { ApproveMissedCheckoutRequestDto } from './dto/approve-missed-checkout-request.dto';
import { QueryMissedCheckoutRequestsDto } from './dto/query-missed-checkout-requests.dto';
import { RejectMissedCheckoutRequestDto } from './dto/reject-missed-checkout-request.dto';
import { MissedCheckoutService } from './missed-checkout.service';

@ApiTags('Manager / Missed Checkout')
@ApiBearerAuth('JWT')
@UseGuards(JwtAuthGuard, RoleGuard)
@Roles(Role.MANAGER)
@Controller('managers/missed-checkout')
export class ManagerMissedCheckoutController {
  constructor(private readonly missedCheckoutService: MissedCheckoutService) {}

  @Get('pending')
  @ApiOperation({ summary: 'Missed checkout requests pending my approval — MANAGER, own team only' })
  @ApiResponse({ status: 200, description: 'Paginated pending request list' })
  pending(@CurrentUser() user: AuthUser, @Query() query: QueryMissedCheckoutRequestsDto) {
    return this.missedCheckoutService.managerPending(user, query);
  }

  @Patch(':id/approve')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    summary: 'Approve a missed checkout request — MANAGER',
    description:
      'If the request was created with adminApprovalRequired=true, this escalates to ADMIN ' +
      'instead of finalizing the attendance outcome.',
  })
  @ApiResponse({ status: 200, description: 'Decision recorded' })
  @ApiResponse({ status: 403, description: 'Request is not in your team' })
  @ApiResponse({ status: 404, description: 'Request not found' })
  approve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApproveMissedCheckoutRequestDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.missedCheckoutService.managerApprove(id, dto, user);
  }

  @Patch(':id/reject')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Reject a missed checkout request — MANAGER', description: 'Final at manager level — never escalates.' })
  @ApiResponse({ status: 200, description: 'Decision recorded' })
  @ApiResponse({ status: 403, description: 'Request is not in your team' })
  @ApiResponse({ status: 404, description: 'Request not found' })
  reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectMissedCheckoutRequestDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.missedCheckoutService.managerReject(id, dto, user);
  }
}
