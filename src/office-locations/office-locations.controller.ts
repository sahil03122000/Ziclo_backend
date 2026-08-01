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
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RoleGuard } from '../common/guards/role.guard';
import { AuthUser } from '../common/types/auth-user.type';
import { CreateOfficeLocationDto } from './dto/create-office-location.dto';
import { OfficeLocationQueryDto } from './dto/office-location-query.dto';
import { UpdateOfficeLocationDto } from './dto/update-office-location.dto';
import { OfficeLocationsService } from './office-locations.service';

@ApiTags('Office Locations')
@ApiBearerAuth('JWT')
@Controller('office-locations')
@UseGuards(JwtAuthGuard, RoleGuard)
export class OfficeLocationsController {
  constructor(private readonly service: OfficeLocationsService) {}

  @Get('active')
  @Roles(Role.WORKER, Role.MANAGER)
  @ApiOperation({ summary: 'Active office locations for check-in dropdown — WORKER / MANAGER' })
  @ApiResponse({
    status: 200,
    description: 'Active office location list',
    schema: {
      example: {
        success: true,
        data: [{ id: 'uuid', name: 'Koramangala Office', address: '5th Block, Koramangala', latitude: 12.9352, longitude: 77.6245, geofenceRadiusMeters: 200 }],
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — WORKER or MANAGER required' })
  getActive() {
    return this.service.getActive();
  }

  @Post()
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'Create an office location — ADMIN',
    description: '`geofenceRadiusMeters` defines the allowed radius (in metres) for attendance check-in. Default is 200m.',
  })
  @ApiResponse({ status: 201, description: 'Office location created' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — ADMIN required' })
  create(@Body() dto: CreateOfficeLocationDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user.id, user.name);
  }

  @Get()
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'List all office locations — ADMIN' })
  @ApiResponse({ status: 200, description: 'Paginated office location list' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — ADMIN required' })
  findAll(@Query() query: OfficeLocationQueryDto) {
    return this.service.findAll(query);
  }

  @Get(':id')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Single office location detail — ADMIN' })
  @ApiParam({ name: 'id', description: 'Office location UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Office location detail' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — ADMIN required' })
  @ApiResponse({ status: 404, description: 'Office location not found' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.findOne(id);
  }

  @Patch(':id')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Update an office location — ADMIN' })
  @ApiParam({ name: 'id', description: 'Office location UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Office location updated' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — ADMIN required' })
  @ApiResponse({ status: 404, description: 'Office location not found' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateOfficeLocationDto, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto, user.id, user.name);
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Soft-deactivate office location — ADMIN' })
  @ApiParam({ name: 'id', description: 'Office location UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Office location deactivated' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — ADMIN required' })
  @ApiResponse({ status: 404, description: 'Office location not found' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.remove(id);
  }
}
