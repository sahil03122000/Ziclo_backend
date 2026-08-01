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
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '@prisma/client';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RoleGuard } from '../common/guards/role.guard';
import { AuthUser } from '../common/types/auth-user.type';
import { ManagerAreaQueryDto } from './dto/manager-area-query.dto';
import { ManagerService } from './manager.service';

@ApiTags('Manager Areas')
@ApiBearerAuth('JWT')
@UseGuards(JwtAuthGuard, RoleGuard)
@Roles(Role.MANAGER)
@Controller('managers')
export class ManagerAreasController {
  constructor(private readonly managerService: ManagerService) {}

  @Get('areas')
  @ApiOperation({
    summary:
      'Areas filtered by office(s) — MANAGER, own offices only — ?officeLocationIds=id1,id2,id3',
    description:
      'Returns the union of active areas across the given office(s). Any requested office id ' +
      "that isn't assigned to the logged-in manager is silently ignored. Omit " +
      "officeLocationIds to get areas across all of the manager's own offices.",
  })
  @ApiResponse({
    status: 200,
    description: 'Active areas belonging to the selected office(s)',
    schema: {
      example: {
        success: true,
        data: [
          {
            id: 'uuid',
            name: 'HSR Layout',
            officeLocationId: 'uuid',
            officeLocationName: 'HSR Office',
          },
        ],
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — MANAGER required' })
  @ApiResponse({ status: 404, description: 'Manager profile not found' })
  getAreas(@CurrentUser() user: AuthUser, @Query() query: ManagerAreaQueryDto) {
    return this.managerService.getAreasByOffice(user, query.officeLocationIds);
  }

  @Get('offices/:officeId/areas')
  @ApiOperation({
    summary: 'Areas belonging to a single office — MANAGER, own office only',
  })
  @ApiParam({
    name: 'officeId',
    description: 'Office Location UUID',
    format: 'uuid',
  })
  @ApiResponse({
    status: 200,
    description:
      "Active areas belonging to the office — empty if the office isn't the manager's own",
    schema: {
      example: {
        success: true,
        data: [
          {
            id: 'uuid',
            name: 'HSR Layout',
            officeLocationId: 'uuid',
            officeLocationName: 'HSR Office',
          },
        ],
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — MANAGER required' })
  @ApiResponse({ status: 404, description: 'Manager profile not found' })
  getAreasForOffice(
    @CurrentUser() user: AuthUser,
    @Param('officeId', ParseUUIDPipe) officeId: string,
  ) {
    return this.managerService.getAreasByOffice(user, [officeId]);
  }

  @Get('shifts')
  @ApiOperation({
    summary: 'Available work shifts — MANAGER',
    description:
      'Active shifts from the admin-managed Shift table (Admin → Profile → Attendance Rules). ' +
      'Reuses AdminService.getShifts() — same source of truth as GET /admin/shifts.',
  })
  @ApiResponse({
    status: 200,
    description: 'List of active shifts',
    schema: {
      example: {
        success: true,
        data: [
          {
            id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
            name: 'Shift A',
            startTime: '08:00',
            endTime: '17:00',
            graceMinutes: 15,
            halfDayHours: 4,
            fullDayHours: 8,
            lateAfterMinutes: 15,
            earlyLeaveMinutes: 15,
            workingDays: [1, 2, 3, 4, 5, 6],
            isActive: true,
          },
          {
            id: '4fa85f64-5717-4562-b3fc-2c963f66afb7',
            name: 'Shift B',
            startTime: '10:00',
            endTime: '19:00',
            graceMinutes: 15,
            halfDayHours: 4,
            fullDayHours: 8,
            lateAfterMinutes: 15,
            earlyLeaveMinutes: 15,
            workingDays: [1, 2, 3, 4, 5, 6],
            isActive: true,
          },
        ],
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — MANAGER required' })
  getShifts() {
    return this.managerService.getShifts();
  }
}
