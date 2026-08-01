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
import { CreateDealDto } from './dto/create-deal.dto';
import { DealQueryDto } from './dto/deal-query.dto';
import { UpdateDealDto } from './dto/update-deal.dto';
import { DealsService } from './deals.service';

@ApiTags('CRM / Deals')
@ApiBearerAuth('JWT')
@UseGuards(JwtAuthGuard, RoleGuard)
@Roles(Role.ADMIN, Role.MANAGER)
@Controller('crm/deals')
export class DealsController {
  constructor(private readonly dealsService: DealsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new deal — ADMIN / MANAGER' })
  @ApiResponse({ status: 201, description: 'Deal created' })
  @ApiResponse({ status: 400, description: 'Validation error or customer/lead not found' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  create(@Body() dto: CreateDealDto, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.dealsService.create(dto, user.id, (req as any).organizationId);
  }

  @Get()
  @ApiOperation({ summary: 'List deals with filters and pagination — ADMIN / MANAGER' })
  @ApiResponse({ status: 200, description: 'Paginated deal list with forecast totals' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  findAll(@Query() query: DealQueryDto, @Req() req: Request) {
    return this.dealsService.findAll(query, (req as any).organizationId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a deal by ID — ADMIN / MANAGER' })
  @ApiParam({ name: 'id', description: 'Deal UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Deal detail with associated customer and activities' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Deal not found' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.dealsService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a deal stage, value, or expected close date — ADMIN / MANAGER' })
  @ApiParam({ name: 'id', description: 'Deal UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Deal updated' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Deal not found' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDealDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.dealsService.update(id, dto, user.id);
  }

  @Roles(Role.ADMIN)
  @Delete(':id')
  @ApiOperation({ summary: 'Delete a deal — ADMIN' })
  @ApiParam({ name: 'id', description: 'Deal UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Deal deleted' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — ADMIN required' })
  @ApiResponse({ status: 404, description: 'Deal not found' })
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.dealsService.remove(id, user.id);
  }
}
