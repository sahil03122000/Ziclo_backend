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

@ApiTags('Admin / Missed Checkout')
@ApiBearerAuth('JWT')
@UseGuards(JwtAuthGuard, RoleGuard)
@Roles(Role.ADMIN, Role.SUPER_ADMIN, Role.ORGANIZATION_ADMIN)
@Controller('admin/missed-checkout')
export class AdminMissedCheckoutController {
  constructor(private readonly missedCheckoutService: MissedCheckoutService) {}

  @Get('pending')
  @ApiOperation({
    summary: 'Missed checkout requests awaiting admin approval — ADMIN',
    description:
      'Populated once a manager approves a request created with adminApprovalRequired=true, ' +
      "or immediately for a manager's own missed checkout (always requires admin).",
  })
  @ApiResponse({ status: 200, description: 'Paginated pending request list' })
  pending(@Query() query: QueryMissedCheckoutRequestsDto) {
    return this.missedCheckoutService.adminPending(query);
  }

  @Patch(':id/approve')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Final approve a missed checkout request — ADMIN' })
  @ApiResponse({ status: 200, description: 'Decision recorded' })
  @ApiResponse({ status: 404, description: 'Request not found' })
  approve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApproveMissedCheckoutRequestDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.missedCheckoutService.adminApprove(id, dto, user);
  }

  @Patch(':id/reject')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Final reject a missed checkout request — ADMIN' })
  @ApiResponse({ status: 200, description: 'Decision recorded' })
  @ApiResponse({ status: 404, description: 'Request not found' })
  reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectMissedCheckoutRequestDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.missedCheckoutService.adminReject(id, dto, user);
  }
}
