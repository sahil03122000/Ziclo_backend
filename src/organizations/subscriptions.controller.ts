import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RoleGuard } from '../common/guards/role.guard';
import { AuthUser } from '../common/types/auth-user.type';
import { ChangePlanDto } from './dto/change-plan.dto';
import { StartSubscriptionDto } from './dto/start-subscription.dto';
import { SubscriptionsService } from './subscriptions.service';

@ApiTags('Organization Subscriptions')
@ApiBearerAuth('JWT')
@UseGuards(JwtAuthGuard)
@Controller('organizations/:orgId/subscription')
export class SubscriptionsController {
  constructor(private readonly subscriptionsService: SubscriptionsService) {}

  @Get()
  @ApiOperation({ summary: 'Get organization subscription and plan details' })
  @ApiParam({ name: 'orgId', description: 'Organization UUID', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Subscription detail',
    schema: {
      example: {
        success: true,
        data: { status: 'ACTIVE', plan: { name: 'Pro', price: 2499 }, currentPeriodEnd: '2026-07-21T00:00:00Z', cancelAtPeriodEnd: false },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'No subscription found' })
  findOne(@Param('orgId', ParseUUIDPipe) orgId: string) {
    return this.subscriptionsService.findOne(orgId);
  }

  @Post()
  @UseGuards(RoleGuard)
  @Roles(Role.ADMIN, Role.SUPER_ADMIN, Role.ORGANIZATION_ADMIN)
  @ApiOperation({ summary: 'Start a new paid subscription — ORG ADMIN' })
  @ApiParam({ name: 'orgId', description: 'Organization UUID', format: 'uuid' })
  @ApiResponse({ status: 201, description: 'Subscription started' })
  @ApiResponse({ status: 400, description: 'Active subscription already exists' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — ORG ADMIN required' })
  start(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() dto: StartSubscriptionDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.subscriptionsService.start(orgId, dto, user.id);
  }

  @Patch('change-plan')
  @UseGuards(RoleGuard)
  @Roles(Role.ADMIN, Role.SUPER_ADMIN, Role.ORGANIZATION_ADMIN)
  @ApiOperation({ summary: 'Upgrade or downgrade subscription plan — ORG ADMIN' })
  @ApiParam({ name: 'orgId', description: 'Organization UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Plan changed' })
  @ApiResponse({ status: 400, description: 'No active subscription or same plan selected' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — ORG ADMIN required' })
  changePlan(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() dto: ChangePlanDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.subscriptionsService.changePlan(orgId, dto, user.id);
  }

  @Patch('cancel')
  @UseGuards(RoleGuard)
  @Roles(Role.ADMIN, Role.SUPER_ADMIN, Role.ORGANIZATION_ADMIN)
  @ApiOperation({ summary: 'Cancel subscription at period end — ORG ADMIN' })
  @ApiParam({ name: 'orgId', description: 'Organization UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Subscription will cancel at period end' })
  @ApiResponse({ status: 400, description: 'No active subscription' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — ORG ADMIN required' })
  cancel(@Param('orgId', ParseUUIDPipe) orgId: string, @CurrentUser() user: AuthUser) {
    return this.subscriptionsService.cancel(orgId, user.id);
  }

  @Post('renew')
  @UseGuards(RoleGuard)
  @Roles(Role.ADMIN, Role.SUPER_ADMIN, Role.ORGANIZATION_ADMIN)
  @ApiOperation({ summary: 'Renew subscription for 30 days from current period end — ORG ADMIN' })
  @ApiParam({ name: 'orgId', description: 'Organization UUID', format: 'uuid' })
  @ApiResponse({ status: 201, description: 'Subscription renewed' })
  @ApiResponse({ status: 400, description: 'No active subscription' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — ORG ADMIN required' })
  renew(@Param('orgId', ParseUUIDPipe) orgId: string, @CurrentUser() user: AuthUser) {
    return this.subscriptionsService.renew(orgId, user.id);
  }

  @Get('invoices')
  @UseGuards(RoleGuard)
  @Roles(Role.ADMIN, Role.SUPER_ADMIN, Role.ORGANIZATION_ADMIN)
  @ApiOperation({ summary: 'List invoices belonging to this organization — ORG ADMIN / SUPER_ADMIN' })
  @ApiParam({ name: 'orgId', description: 'Organization UUID', format: 'uuid' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Paginated invoice list for the organization' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  getInvoices(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.subscriptionsService.getOrgInvoices(
      orgId,
      page ? Math.max(1, parseInt(page, 10)) : 1,
      limit ? Math.min(100, Math.max(1, parseInt(limit, 10))) : 20,
    );
  }
}
