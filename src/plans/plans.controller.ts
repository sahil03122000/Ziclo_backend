import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AuthUser } from '../common/types/auth-user.type';
import { SuperAdminGuard } from '../tenant/super-admin.guard';
import { CreatePlanDto } from './dto/create-plan.dto';
import { UpdatePlanDto } from './dto/update-plan.dto';
import { PlansService } from './plans.service';

@ApiTags('Plans')
@ApiBearerAuth('JWT')
@UseGuards(JwtAuthGuard)
@Controller('plans')
export class PlansController {
  constructor(private readonly plansService: PlansService) {}

  @Post()
  @UseGuards(SuperAdminGuard)
  @ApiOperation({ summary: 'Create a subscription plan — SUPER_ADMIN' })
  @ApiResponse({ status: 201, description: 'Plan created' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — SUPER_ADMIN required' })
  create(@Body() dto: CreatePlanDto, @CurrentUser() user: AuthUser) {
    return this.plansService.create(dto, user.id);
  }

  @Get()
  @ApiOperation({ summary: 'List all active plans — any authenticated user' })
  @ApiResponse({
    status: 200,
    description: 'Active plan list',
    schema: {
      example: {
        success: true,
        data: [
          { id: 'uuid', name: 'Starter', price: 999, billingCycle: 'MONTHLY', maxUsers: 10, maxBookings: 100 },
          { id: 'uuid2', name: 'Pro', price: 2499, billingCycle: 'MONTHLY', maxUsers: 50, maxBookings: 1000 },
        ],
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  findAll() {
    return this.plansService.findAllActive();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a plan by ID' })
  @ApiParam({ name: 'id', description: 'Plan UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Plan detail' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Plan not found' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.plansService.findOne(id);
  }

  @Patch(':id')
  @UseGuards(SuperAdminGuard)
  @ApiOperation({ summary: 'Update a plan — SUPER_ADMIN' })
  @ApiParam({ name: 'id', description: 'Plan UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Plan updated' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — SUPER_ADMIN required' })
  @ApiResponse({ status: 404, description: 'Plan not found' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePlanDto, @CurrentUser() user: AuthUser) {
    return this.plansService.update(id, dto, user.id);
  }

  @Delete(':id')
  @UseGuards(SuperAdminGuard)
  @ApiOperation({ summary: 'Delete a plan (only if no subscriptions) — SUPER_ADMIN' })
  @ApiParam({ name: 'id', description: 'Plan UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Plan deleted' })
  @ApiResponse({ status: 400, description: 'Cannot delete — active subscriptions exist' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — SUPER_ADMIN required' })
  @ApiResponse({ status: 404, description: 'Plan not found' })
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.plansService.remove(id, user.id);
  }
}
