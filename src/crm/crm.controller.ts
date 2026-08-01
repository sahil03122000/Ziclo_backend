import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Request } from 'express';

import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RoleGuard } from '../common/guards/role.guard';
import { CrmService } from './crm.service';

@ApiTags('CRM')
@ApiBearerAuth('JWT')
@UseGuards(JwtAuthGuard, RoleGuard)
@Roles(Role.ADMIN, Role.MANAGER)
@Controller('crm')
export class CrmController {
  constructor(private readonly crmService: CrmService) {}

  @Get('pipeline')
  @ApiOperation({
    summary: 'CRM pipeline: lead counts by status and deal counts/value by stage — ADMIN / MANAGER',
    description: 'Returns a summary view of the CRM funnel: how many leads are in each stage and deal forecast per pipeline stage.',
  })
  @ApiResponse({
    status: 200,
    description: 'CRM pipeline summary',
    schema: {
      example: {
        success: true,
        data: {
          leads: { NEW: 12, CONTACTED: 8, QUALIFIED: 5, PROPOSAL_SENT: 3, WON: 20, LOST: 7 },
          deals: { PROSPECTING: { count: 4, value: 80000 }, NEGOTIATION: { count: 2, value: 120000 }, CLOSED_WON: { count: 10, value: 500000 } },
        },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — ADMIN or MANAGER required' })
  getPipeline(@Req() req: Request) {
    return this.crmService.getPipeline((req as any).organizationId);
  }

  @Get('dashboard')
  @ApiOperation({
    summary: 'CRM dashboard: total leads, converted leads, active deals, forecast value — ADMIN / MANAGER',
  })
  @ApiResponse({
    status: 200,
    description: 'CRM dashboard metrics',
    schema: {
      example: {
        success: true,
        data: { totalLeads: 55, convertedLeads: 20, activeDeals: 6, forecastValue: 200000, conversionRate: 0.36 },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — ADMIN or MANAGER required' })
  getDashboard(@Req() req: Request) {
    return this.crmService.getDashboard((req as any).organizationId);
  }
}
