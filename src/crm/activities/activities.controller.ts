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
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Request } from 'express';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RoleGuard } from '../../common/guards/role.guard';
import { AuthUser } from '../../common/types/auth-user.type';
import { ActivitiesService } from './activities.service';
import { ActivityQueryDto } from './dto/activity-query.dto';
import { CreateActivityDto } from './dto/create-activity.dto';
import { UpdateActivityDto } from './dto/update-activity.dto';

@ApiTags('CRM / Activities')
@ApiBearerAuth('JWT')
@UseGuards(JwtAuthGuard, RoleGuard)
@Roles(Role.ADMIN, Role.MANAGER)
@Controller('crm/activities')
export class ActivitiesController {
  constructor(private readonly activitiesService: ActivitiesService) {}

  @Post()
  @ApiOperation({
    summary: 'Log an activity (call, email, meeting, note, task) — ADMIN / MANAGER',
    description: 'Links the activity to a lead or deal via `leadId` or `dealId`. At least one must be provided.',
  })
  @ApiResponse({ status: 201, description: 'Activity logged' })
  @ApiResponse({ status: 400, description: 'Validation error or lead/deal not found' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  create(
    @Body() dto: CreateActivityDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.activitiesService.create(dto, user.id, (req as any).organizationId);
  }

  @Get()
  @ApiOperation({ summary: 'List activities with filters and pagination — ADMIN / MANAGER' })
  @ApiResponse({ status: 200, description: 'Paginated activity list' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  findAll(
    @Query() query: ActivityQueryDto,
    @Req() req: Request,
  ) {
    return this.activitiesService.findAll(query, (req as any).organizationId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get activity by ID — ADMIN / MANAGER' })
  @ApiParam({ name: 'id', description: 'Activity UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Activity detail' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Activity not found' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.activitiesService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update an activity — ADMIN / MANAGER' })
  @ApiParam({ name: 'id', description: 'Activity UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Activity updated' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Activity not found' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateActivityDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.activitiesService.update(id, dto, user.id);
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Delete an activity — ADMIN' })
  @ApiParam({ name: 'id', description: 'Activity UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Activity deleted' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — ADMIN required' })
  @ApiResponse({ status: 404, description: 'Activity not found' })
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.activitiesService.remove(id, user.id);
  }
}
