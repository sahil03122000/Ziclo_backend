import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { SkipThrottle } from '@nestjs/throttler';

import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RoleGuard } from '../common/guards/role.guard';
import { HealthService } from './health.service';

@ApiTags('Health')
@Controller('health')
@SkipThrottle()
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @ApiOperation({ summary: 'Basic health check — public, no auth required' })
  @ApiResponse({
    status: 200,
    description: 'Service is healthy',
    schema: { example: { status: 'ok', timestamp: '2026-06-21T10:00:00Z', uptime: 3600 } },
  })
  getHealth() {
    return this.healthService.getBasic();
  }

  @Get('detailed')
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth('JWT')
  @ApiOperation({ summary: 'Detailed health check with DB latency and memory — ADMIN only' })
  @ApiResponse({
    status: 200,
    description: 'Detailed health including database and memory',
    schema: {
      example: {
        status: 'ok',
        timestamp: '2026-06-21T10:00:00Z',
        uptime: 3600,
        database: { status: 'ok', latencyMs: 4 },
        memory: { heapUsed: 148, heapTotal: 256, rss: 310, unit: 'MB' },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — ADMIN required' })
  getDetailedHealth() {
    return this.healthService.getDetailed();
  }
}
