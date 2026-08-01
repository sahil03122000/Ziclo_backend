import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';

import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RoleGuard } from '../common/guards/role.guard';
import { AuditLogsService } from './audit-logs.service';
import { AuditLogQueryDto } from './dto/audit-log-query.dto';

@ApiTags('Audit Logs')
@ApiBearerAuth('JWT')
@Controller()
@UseGuards(JwtAuthGuard, RoleGuard)
@Roles(Role.ADMIN)
export class AuditLogsController {
  constructor(private readonly auditLogsService: AuditLogsService) {}

  @Get('activity-feed')
  @ApiOperation({ summary: 'Latest 50 system actions across all entities — ADMIN' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Max items (default 50)' })
  @ApiResponse({
    status: 200,
    description: 'Recent activity feed',
    schema: {
      example: {
        success: true,
        data: [
          { id: 'uuid', action: 'BOOKING_CREATED', entity: 'Booking', entityId: 'uuid', userId: 'uuid', userName: 'Rahul Sharma', createdAt: '2026-06-21T10:00:00Z' },
        ],
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — ADMIN required' })
  getActivityFeed(@Query('limit') limit?: string) {
    return this.auditLogsService.findRecent(limit ? parseInt(limit, 10) : 50);
  }

  @Get('audit-logs')
  @ApiOperation({ summary: 'Full audit log with filters and pagination — ADMIN' })
  @ApiResponse({ status: 200, description: 'Paginated audit log entries' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — ADMIN required' })
  findAll(@Query() query: AuditLogQueryDto) {
    return this.auditLogsService.findAll(query);
  }
}
