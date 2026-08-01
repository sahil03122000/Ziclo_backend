import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AuthUser } from '../common/types/auth-user.type';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { OrganizationQueryDto } from './dto/organization-query.dto';
import { UpdateOrganizationDto } from './dto/update-organization.dto';
import { OrganizationsService } from './organizations.service';

@ApiTags('Organizations')
@ApiBearerAuth('JWT')
@UseGuards(JwtAuthGuard)
@Controller('organizations')
export class OrganizationsController {
  constructor(private readonly orgsService: OrganizationsService) {}

  // ─── No tenant guard — user is creating their org ─────────────────────────

  @Post()
  @ApiOperation({
    summary: 'Create an organization — caller becomes ORG ADMIN, TRIAL subscription auto-created',
    description: 'Creates the organization, adds the caller as the first ADMIN member, and starts a 14-day TRIAL subscription.',
  })
  @ApiResponse({
    status: 201,
    description: 'Organization created',
    schema: {
      example: {
        success: true,
        data: { id: 'uuid', name: 'Acme Services', slug: 'acme-services', subscription: { status: 'TRIAL', trialEndsAt: '2026-07-05T00:00:00Z' } },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Validation error or slug already taken' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  create(@Body() dto: CreateOrganizationDto, @CurrentUser() user: AuthUser) {
    return this.orgsService.create(dto, user.id);
  }

  @Get('me')
  @ApiOperation({ summary: 'List all organizations the current user belongs to' })
  @ApiResponse({ status: 200, description: 'User\'s organization memberships' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  findMine(@CurrentUser() user: AuthUser) {
    return this.orgsService.findMyOrganizations(user.id);
  }

  // ─── Tenant-guarded ──────────────────────────────────────────────────────

  @Get(':id')
  @ApiOperation({ summary: 'Get organization details' })
  @ApiParam({ name: 'id', description: 'Organization UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Organization detail' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — must be a member' })
  @ApiResponse({ status: 404, description: 'Organization not found' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.orgsService.findOne(id);
  }

  @Get(':id/dashboard')
  @ApiOperation({ summary: 'Organization dashboard — member counts, stats, recent activity, subscription' })
  @ApiParam({ name: 'id', description: 'Organization UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Organization dashboard stats' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — must be a member' })
  @ApiResponse({ status: 404, description: 'Organization not found' })
  getDashboard(@Param('id', ParseUUIDPipe) id: string) {
    return this.orgsService.getDashboard(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update organization name, logo, or settings — ORG ADMIN only' })
  @ApiParam({ name: 'id', description: 'Organization UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Organization updated' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — ORG ADMIN required' })
  @ApiResponse({ status: 404, description: 'Organization not found' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateOrganizationDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.orgsService.update(id, dto, user.id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete organization and all its data — ORG ADMIN only' })
  @ApiParam({ name: 'id', description: 'Organization UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Organization deleted' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — ORG ADMIN required' })
  @ApiResponse({ status: 404, description: 'Organization not found' })
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.orgsService.remove(id, user.id);
  }

  // ─── Super-admin list ───────────────────────────────────────────────────

  @Get()
  @ApiOperation({ summary: 'List all organizations — SUPER_ADMIN only (enforced at service level); others get their own orgs' })
  @ApiResponse({ status: 200, description: 'Organization list' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  findAll(@Query() query: OrganizationQueryDto, @CurrentUser() user: AuthUser) {
    if (user.role !== 'SUPER_ADMIN' as never) {
      return this.orgsService.findMyOrganizations(user.id);
    }
    return this.orgsService.findAll(query);
  }
}
