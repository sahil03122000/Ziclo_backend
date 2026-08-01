import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '@prisma/client';

import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RoleGuard } from '../common/guards/role.guard';
import { ActivityLogService } from './activity-log.service';
import { QueryActivityLogDto } from './dto/query-activity-log.dto';

@ApiTags('Admin / Activity Log')
@ApiBearerAuth('JWT')
@Controller('admin')
@UseGuards(JwtAuthGuard, RoleGuard)
@Roles(Role.ADMIN)
export class ActivityLogController {
  constructor(private readonly activityLog: ActivityLogService) {}

  // ─── Static routes MUST come before /:id ─────────────────────────────────────

  @Get('audit-logs/stats')
  @ApiOperation({ summary: "Today's activity breakdown by module — ADMIN" })
  @ApiOkResponse({
    description: "Today's aggregated activity stats",
    schema: {
      example: {
        success: true,
        data: {
          todayTotal: 140,
          todayBookings: 32,
          todayPayments: 18,
          todayWorkerCheckins: 45,
          todayComplaints: 5,
          todayManagerActions: 22,
          todayAdminActions: 8,
        },
      },
    },
  })
  getStats() {
    return this.activityLog.getStats();
  }

  @Get('dashboard/recent-activities')
  @ApiOperation({ summary: 'Latest 20 activities for Admin Dashboard — ADMIN' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Max items (default 20, max 50)' })
  @ApiOkResponse({
    description: 'Recent activity timeline entries',
    schema: {
      example: {
        success: true,
        data: [
          {
            id: 'uuid',
            time: '2026-06-25T10:20:00Z',
            icon: 'booking',
            title: 'Sahil booked AC Deep Cleaning',
            description: 'Amount ₹599',
            module: 'BOOKING',
            actorName: 'Sahil',
            actorRole: 'USER',
            action: 'BOOKING_CREATED',
          },
        ],
      },
    },
  })
  getRecentActivities(@Query('limit') limit?: string) {
    const n = limit ? Math.min(parseInt(limit, 10), 50) : 20;
    return this.activityLog.getRecentActivities(n);
  }

  @Get('audit-logs')
  @ApiOperation({ summary: 'Paginated activity log with filters — ADMIN' })
  // ── Query params are documented via @ApiPropertyOptional on QueryActivityLogDto ──
  @ApiOkResponse({
    description: 'Paginated activity logs',
    schema: {
      example: {
        success: true,
        data: {
          logs: [
            {
              id: 'uuid',
              action: 'BOOKING_CREATED',
              module: 'BOOKING',
              description: 'Sahil booked AC Deep Cleaning',
              actorId: 'uuid',
              actorName: 'Sahil',
              actorRole: 'USER',
              targetId: 'uuid',
              targetType: 'Booking',
              organizationId: null,
              metadata: { bookingRef: 'BK-000001', amount: 599 },
              ipAddress: '103.x.x.x',
              device: 'iPhone 15',
              platform: 'MOBILE',
              createdAt: '2026-06-25T10:20:00Z',
            },
          ],
          meta: { total: 840, page: 1, limit: 20, totalPages: 42 },
        },
      },
    },
  })
  findAll(@Query() query: QueryActivityLogDto) {
    return this.activityLog.findAll(query);
  }

  @Get('audit-logs/:id')
  @ApiOperation({ summary: 'Full detail of a single activity log entry — ADMIN' })
  @ApiParam({ name: 'id', description: 'Activity log UUID', format: 'uuid' })
  @ApiOkResponse({
    description: 'Activity log detail',
    schema: {
      example: {
        success: true,
        data: {
          id: 'uuid',
          action: 'BOOKING_CANCELLED',
          module: 'BOOKING',
          description: 'Ravi Kumar cancelled booking BK-000042',
          actorId: 'uuid',
          actorName: 'Ravi Kumar',
          actorRole: 'USER',
          targetId: 'uuid',
          targetType: 'Booking',
          metadata: { bookingRef: 'BK-000042', reason: 'Changed plans' },
          ipAddress: '49.x.x.x',
          device: 'Samsung Galaxy S24',
          platform: 'MOBILE',
          createdAt: '2026-06-25T14:05:00Z',
        },
      },
    },
  })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.activityLog.findOne(id);
  }
}
