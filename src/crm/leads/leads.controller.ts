import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
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
import { ConvertLeadDto } from './dto/convert-lead.dto';
import { CreateLeadDto } from './dto/create-lead.dto';
import { LeadQueryDto } from './dto/lead-query.dto';
import { UpdateLeadDto } from './dto/update-lead.dto';
import { UpdateLeadStatusDto } from './dto/update-lead-status.dto';
import { LeadsService } from './leads.service';

@ApiTags('CRM / Leads')
@ApiBearerAuth('JWT')
@UseGuards(JwtAuthGuard, RoleGuard)
@Roles(Role.ADMIN, Role.MANAGER)
@Controller('crm/leads')
export class LeadsController {
  constructor(private readonly leadsService: LeadsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new lead — ADMIN / MANAGER' })
  @ApiResponse({ status: 201, description: 'Lead created with status NEW' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  create(@Body() dto: CreateLeadDto, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.leadsService.create(dto, user.id, (req as any).organizationId);
  }

  @Get()
  @ApiOperation({ summary: 'List leads with filters and pagination — ADMIN / MANAGER' })
  @ApiResponse({ status: 200, description: 'Paginated lead list' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  findAll(@Query() query: LeadQueryDto, @Req() req: Request) {
    return this.leadsService.findAll(query, (req as any).organizationId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a lead by ID — ADMIN / MANAGER' })
  @ApiParam({ name: 'id', description: 'Lead UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Lead detail with activities' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Lead not found' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.leadsService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update lead details — ADMIN / MANAGER' })
  @ApiParam({ name: 'id', description: 'Lead UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Lead updated' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Lead not found' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateLeadDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.leadsService.update(id, dto, user.id);
  }

  @Patch(':id/status')
  @ApiOperation({
    summary: 'Advance lead through pipeline: NEW → CONTACTED → QUALIFIED → PROPOSAL_SENT → WON / LOST — ADMIN / MANAGER',
    description: 'Status transitions must follow the pipeline order. Jumping stages is not allowed.',
  })
  @ApiParam({ name: 'id', description: 'Lead UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Lead status updated' })
  @ApiResponse({ status: 400, description: 'Invalid status transition' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Lead not found' })
  updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateLeadStatusDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.leadsService.updateStatus(id, dto, user.id);
  }

  @Post(':id/convert')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Convert lead to customer — sets status to WON and creates/links a Customer record — ADMIN / MANAGER',
  })
  @ApiParam({ name: 'id', description: 'Lead UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Lead converted — Customer record created or linked', schema: { example: { success: true, data: { customerId: 'uuid', leadId: 'uuid', status: 'WON' } } } })
  @ApiResponse({ status: 400, description: 'Lead is already WON or LOST' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Lead not found' })
  convert(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ConvertLeadDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.leadsService.convertToCustomer(id, dto, user.id, (req as any).organizationId);
  }

  @Roles(Role.ADMIN)
  @Delete(':id')
  @ApiOperation({ summary: 'Delete a lead — ADMIN' })
  @ApiParam({ name: 'id', description: 'Lead UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Lead deleted' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — ADMIN required' })
  @ApiResponse({ status: 404, description: 'Lead not found' })
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.leadsService.remove(id, user.id);
  }
}
