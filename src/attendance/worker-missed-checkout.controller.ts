import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RoleGuard } from '../common/guards/role.guard';
import type { AuthUser } from '../common/types/auth-user.type';
import { QueryMissedCheckoutRequestsDto } from './dto/query-missed-checkout-requests.dto';
import { ResubmitMissedCheckoutRequestDto } from './dto/resubmit-missed-checkout-request.dto';
import { MissedCheckoutService } from './missed-checkout.service';

@ApiTags('Worker / Missed Checkout')
@ApiBearerAuth('JWT')
@UseGuards(JwtAuthGuard, RoleGuard)
@Roles(Role.WORKER)
@Controller('workers/me/missed-checkout')
export class WorkerMissedCheckoutController {
  constructor(private readonly missedCheckoutService: MissedCheckoutService) {}

  @Get()
  @ApiOperation({ summary: "Logged-in worker's missed checkout request history — WORKER" })
  @ApiResponse({ status: 200, description: 'Paginated missed checkout request list' })
  myRequests(@CurrentUser() user: AuthUser, @Query() query: QueryMissedCheckoutRequestsDto) {
    return this.missedCheckoutService.myRequests(user, query);
  }

  @Post(':attendanceId')
  @ApiParam({ name: 'attendanceId', format: 'uuid' })
  @ApiOperation({
    summary: 'Resubmit/edit the reason for a missed checkout — WORKER',
    description:
      'The missed checkout request itself is created automatically the moment attendance is ' +
      'flagged (ABSENT, missedCheckout=true) — this only fills in or edits the ' +
      'reason/evidence/requestedCheckOutTime while it is still PENDING.',
  })
  @ApiResponse({ status: 201, description: 'Request updated' })
  @ApiResponse({ status: 400, description: 'Already decided — no longer editable' })
  @ApiResponse({ status: 403, description: 'Not your own attendance record' })
  @ApiResponse({ status: 404, description: 'No missed checkout request exists for this attendance record' })
  resubmit(
    @Param('attendanceId', ParseUUIDPipe) attendanceId: string,
    @Body() dto: ResubmitMissedCheckoutRequestDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.missedCheckoutService.resubmit(attendanceId, dto, user);
  }
}
