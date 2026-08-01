import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RoleGuard } from '../common/guards/role.guard';
import type { AuthUser } from '../common/types/auth-user.type';
import { MissedCheckoutService } from './missed-checkout.service';

// Legacy alias — the canonical, paginated endpoint is GET workers/me/missed-checkout
// (WorkerMissedCheckoutController). Kept as a route-compatible alias for older frontend
// builds still calling GET attendance/missed-checkout-requests/me.
@ApiTags('Attendance / Missed Checkout (Legacy)')
@ApiBearerAuth('JWT')
@UseGuards(JwtAuthGuard, RoleGuard)
@Roles(Role.WORKER, Role.MANAGER)
@Controller('attendance/missed-checkout-requests')
export class LegacyMissedCheckoutController {
  constructor(private readonly missedCheckoutService: MissedCheckoutService) {}

  @Get('me')
  @ApiOperation({
    summary: "Logged-in worker/manager's missed checkout requests — WORKER / MANAGER (legacy alias)",
    description:
      'Flat, unpaginated summary list — legacy alias of GET workers/me/missed-checkout, kept ' +
      'for backward compatibility with older frontend builds.',
  })
  @ApiResponse({ status: 200, description: 'Missed checkout request summary list' })
  myRequests(@CurrentUser() user: AuthUser) {
    return this.missedCheckoutService.myRequestsSummary(user);
  }
}
