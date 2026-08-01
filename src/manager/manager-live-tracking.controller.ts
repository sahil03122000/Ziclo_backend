import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '@prisma/client';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RoleGuard } from '../common/guards/role.guard';
import { AuthUser } from '../common/types/auth-user.type';
import { ManagerLiveTrackingQueryDto } from './dto/manager-live-tracking-query.dto';
import { ManagerService } from './manager.service';

@ApiTags('Manager Live Tracking')
@ApiBearerAuth('JWT')
@UseGuards(JwtAuthGuard, RoleGuard)
@Roles(Role.MANAGER)
@Controller('managers')
export class ManagerLiveTrackingController {
  constructor(private readonly managerService: ManagerService) {}

  @Get('live-tracking')
  @ApiOperation({
    summary: "Live tracking of the logged-in manager's own workers — MANAGER",
    description:
      "Returns ONLY this manager's own assigned workers — never other managers or workers " +
      'outside their team. Identical record structure to GET /admin/live-tracking (role is ' +
      'always forced to WORKER): id, role, name, profileImage, phone, whatsappNumber ' +
      '(always null — not captured anywhere yet), office, area, shift, attendanceStatus, ' +
      'trackingStatus, employmentStatus, lastLocationTime, latitude, longitude, currentJob, ' +
      'plus the existing officeId/areaId/current*/lastKnown*/gpsEnabled/currentJobId/' +
      'currentJobStatus fields kept for backward compatibility.',
  })
  @ApiOkResponse({
    description: 'Paginated live tracking list, own team only',
    schema: {
      example: {
        success: true,
        data: {
          records: [
            {
              id: 'uuid',
              name: 'Ravi Kumar',
              profileImage: null,
              phone: '9876543210',
              whatsappNumber: null,
              role: 'WORKER',
              employmentStatus: 'SALARY',
              attendanceStatus: 'PRESENT',
              trackingStatus: 'LIVE',
              latitude: 28.6139,
              longitude: 77.209,
              lastLocationTime: '2026-07-19T09:12:00.000Z',
              office: { id: 'uuid', name: 'HSR Office' },
              area: { id: 'uuid', name: 'HSR Layout' },
              shift: { id: 'uuid5', name: 'Morning Shift' },
              currentJob: {
                id: 'uuid',
                status: 'IN_PROGRESS',
                title: 'AC Repair',
              },
            },
          ],
          meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
        },
      },
    },
  })
  getLiveTracking(
    @CurrentUser() user: AuthUser,
    @Query() query: ManagerLiveTrackingQueryDto,
  ) {
    return this.managerService.getLiveTracking(user, query);
  }
}
