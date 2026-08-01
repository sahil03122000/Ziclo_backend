import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AuthUser } from '../common/types/auth-user.type';
import { OrganizationQueryDto } from '../organizations/dto/organization-query.dto';
import { StartSubscriptionDto } from '../organizations/dto/start-subscription.dto';
import { SuperAdminGuard } from '../tenant/super-admin.guard';
import { UsersQueryDto } from '../users/dto/users-query.dto';
import { SuperAdminService } from './super-admin.service';

@ApiTags('Super Admin')
@ApiBearerAuth('JWT')
@UseGuards(JwtAuthGuard, SuperAdminGuard)
@Controller('super-admin')
export class SuperAdminController {
  constructor(private readonly superAdminService: SuperAdminService) {}

  @Get('stats')
  @ApiOperation({ summary: 'Platform-wide statistics — orgs, users, subscriptions — SUPER_ADMIN' })
  @ApiResponse({
    status: 200,
    description: 'Platform stats',
    schema: {
      example: {
        success: true,
        data: {
          totalOrgs: 24, activeOrgs: 21, trialOrgs: 3, totalUsers: 1842,
          totalActiveSubscriptions: 18, mrr: 44982,
        },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — SUPER_ADMIN required' })
  getPlatformStats() {
    return this.superAdminService.getPlatformStats();
  }

  // ─── Organizations ────────────────────────────────────────────────────────

  @Get('organizations')
  @ApiOperation({ summary: 'List all organizations with subscription and member count — SUPER_ADMIN' })
  @ApiResponse({ status: 200, description: 'Paginated organization list' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — SUPER_ADMIN required' })
  listOrganizations(@Query() query: OrganizationQueryDto) {
    return this.superAdminService.listOrganizations(query);
  }

  @Get('organizations/:id')
  @ApiOperation({ summary: 'Organization full detail — members + subscription + counts — SUPER_ADMIN' })
  @ApiParam({ name: 'id', description: 'Organization UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Organization detail' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — SUPER_ADMIN required' })
  @ApiResponse({ status: 404, description: 'Organization not found' })
  getOrganizationDetail(@Param('id', ParseUUIDPipe) id: string) {
    return this.superAdminService.getOrganizationDetail(id);
  }

  @Patch('organizations/:id/toggle-status')
  @ApiOperation({ summary: 'Activate / deactivate an organization — SUPER_ADMIN' })
  @ApiParam({ name: 'id', description: 'Organization UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Organization status toggled' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — SUPER_ADMIN required' })
  @ApiResponse({ status: 404, description: 'Organization not found' })
  toggleOrgStatus(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.superAdminService.toggleOrgStatus(id, user.id);
  }

  @Post('organizations/:id/subscription')
  @ApiOperation({ summary: 'Override / force-set a subscription for an org — SUPER_ADMIN' })
  @ApiParam({ name: 'id', description: 'Organization UUID', format: 'uuid' })
  @ApiResponse({ status: 201, description: 'Subscription overridden' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — SUPER_ADMIN required' })
  @ApiResponse({ status: 404, description: 'Organization not found' })
  overrideSubscription(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: StartSubscriptionDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.superAdminService.overrideSubscription(id, dto, user.id);
  }

  @Delete('organizations/:id')
  @ApiOperation({ summary: 'Permanently delete an organization and all its data — SUPER_ADMIN' })
  @ApiParam({ name: 'id', description: 'Organization UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Organization permanently deleted' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — SUPER_ADMIN required' })
  @ApiResponse({ status: 404, description: 'Organization not found' })
  hardDeleteOrg(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.superAdminService.hardDeleteOrganization(id, user.id);
  }

  // ─── Users ────────────────────────────────────────────────────────────────

  @Get('users')
  @ApiOperation({ summary: 'List all users across all organizations — SUPER_ADMIN' })
  @ApiResponse({ status: 200, description: 'Paginated user list' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — SUPER_ADMIN required' })
  listUsers(@Query() query: UsersQueryDto) {
    return this.superAdminService.listUsers(query);
  }
}
