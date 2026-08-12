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
import { AreasService } from './areas.service';
import { AreaQueryDto } from './dto/area-query.dto';
import { CreateAreaDto } from './dto/create-area.dto';
import { UpdateAreaDto } from './dto/update-area.dto';
import { UpdateAreaServicesDto } from './dto/update-area-services.dto';

@ApiTags('Areas')
@ApiBearerAuth('JWT')
@Controller('areas')
@UseGuards(JwtAuthGuard, RoleGuard)
export class AreasController {
  constructor(private readonly areasService: AreasService) {}

  @Get('my-area')
  @Roles(Role.MANAGER)
  @ApiOperation({ summary: "Manager's assigned areas — MANAGER" })
  @ApiResponse({ status: 200, description: 'Areas assigned to the manager', schema: { example: { success: true, data: [{ id: 'uuid', name: 'South Bangalore', city: 'Bangalore' }] } } })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — MANAGER required' })
  getMyAreas(@CurrentUser() user: AuthUser) {
    return this.areasService.getMyAreas(user.id);
  }

  @Post()
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'Create a new area — ADMIN',
    description:
      'City, district, state, and country are resolved automatically from the PIN Code. ' +
      'Do not send location fields manually. Manager assignment is not handled here — use the ' +
      'Manager Create/Update APIs instead.',
  })
  @ApiResponse({
    status: 201,
    description: 'Area created successfully',
    schema: {
      example: {
        success: true,
        message: 'Area created successfully',
        data: {
          id: 'uuid',
          name: 'Sector 14',
          pincode: '122001',
          city: 'Gurugram',
          district: 'Gurugram',
          state: 'Haryana',
          country: 'India',
          isActive: true,
          officeLocationIds: ['uuid1', 'uuid2'],
          officeLocations: [
            { id: 'uuid1', name: 'Gurugram Sector 14 Office' },
            { id: 'uuid2', name: 'Gurugram Central Office' },
          ],
        },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Validation error or invalid PIN Code / Office' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — ADMIN required' })
  @ApiResponse({ status: 404, description: 'PIN Code or Office Location not found' })
  @ApiResponse({ status: 409, description: 'Area with this name and PIN Code already exists' })
  create(@Body() dto: CreateAreaDto, @CurrentUser() user: AuthUser) {
    return this.areasService.create(dto, user.id, user.name);
  }

  @Get('stats')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Area & manager counts — ADMIN' })
  @ApiResponse({
    status: 200,
    description: 'Aggregate stats for areas, office locations, and managers',
    schema: {
      example: {
        success: true,
        data: { totalAreas: 12, totalOfficeLocations: 8, totalManagers: 20, activeManagers: 17 },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — ADMIN required' })
  getStats() {
    return this.areasService.getStats();
  }

  @Get()
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'List all areas — ADMIN',
    description:
      'Supports officeLocationIds (comma-separated id1,id2,id3, repeated query values, or a ' +
      'single id) and/or officeLocationId (single id shorthand) to return only areas linked ' +
      'to at least one of the given office locations. Empty values are ignored.',
  })
  @ApiResponse({ status: 200, description: 'Paginated area list' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — ADMIN required' })
  findAll(@Query() query: AreaQueryDto) {
    return this.areasService.findAll(query);
  }

  @Get(':id')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Area detail with office locations — ADMIN' })
  @ApiParam({ name: 'id', description: 'Area UUID', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Area detail',
    schema: {
      example: {
        success: true,
        data: {
          id: 'uuid',
          name: 'Sector 14',
          officeLocationIds: ['uuid1', 'uuid2'],
          officeLocations: [
            { id: 'uuid1', name: 'Gurugram Sector 14 Office' },
            { id: 'uuid2', name: 'Gurugram Central Office' },
          ],
        },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — ADMIN required' })
  @ApiResponse({ status: 404, description: 'Area not found' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.areasService.findOne(id);
  }

  @Patch(':id')
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'Update area name, pincode, office locations, city, state, or status — ADMIN',
    description:
      'officeLocationIds fully replaces the office locations linked to this area (an area can ' +
      'belong to multiple offices). Omit it to leave office assignments unchanged.',
  })
  @ApiParam({ name: 'id', description: 'Area UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Area updated' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — ADMIN required' })
  @ApiResponse({ status: 404, description: 'Area or office location not found' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateAreaDto, @CurrentUser() user: AuthUser) {
    return this.areasService.update(id, dto, user.id, user.name);
  }

  @Get(':id/services')
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'List services with per-area availability — ADMIN',
    description:
      'Returns every active Service with an isActive flag for this area. If the area has no ' +
      'explicit AreaService configuration for a service, it defaults to isActive:true (all ' +
      'active services are available until an admin restricts them).',
  })
  @ApiParam({ name: 'id', description: 'Area UUID', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Service availability for the area',
    schema: {
      example: {
        success: true,
        data: [{ serviceId: 'uuid', serviceName: 'AC Cleaning', isActive: true }],
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — ADMIN required' })
  @ApiResponse({ status: 404, description: 'Area not found' })
  getAreaServices(@Param('id', ParseUUIDPipe) id: string) {
    return this.areasService.getAreaServices(id);
  }

  @Patch(':id/services')
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'Set which services are active in an area — ADMIN',
    description:
      'Upserts ON/OFF status for the given services in this area. Services not included in the ' +
      'payload are left unchanged. Does not duplicate service records.',
  })
  @ApiParam({ name: 'id', description: 'Area UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Updated service availability for the area' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — ADMIN required' })
  @ApiResponse({ status: 404, description: 'Area or one or more services not found' })
  setAreaServices(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAreaServicesDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.areasService.setAreaServices(id, dto, user.id, user.name);
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Soft-deactivate area — ADMIN' })
  @ApiParam({ name: 'id', description: 'Area UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Area deactivated' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — ADMIN required' })
  @ApiResponse({ status: 404, description: 'Area not found' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.areasService.remove(id);
  }
}
