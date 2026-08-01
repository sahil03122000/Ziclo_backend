import { Controller, Get, Param, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';

import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RoleGuard } from '../../common/guards/role.guard';
import { PublicServicesService } from './services.service';

@ApiTags('Booking / Services')
@ApiBearerAuth('JWT')
@UseGuards(JwtAuthGuard, RoleGuard)
@Roles(Role.ADMIN, Role.MANAGER, Role.USER, Role.WORKER)
@Controller('services')
export class ServicesController {
  constructor(private readonly servicesService: PublicServicesService) {}

  @Get()
  @ApiOperation({ summary: 'List active services — customer booking flow, step 1' })
  @ApiResponse({ status: 200, description: 'Active service list' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  findAll() {
    return this.servicesService.findAllActive();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Service detail — customer booking flow' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Service detail' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Service not found' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.servicesService.findOne(id);
  }

  @Get(':serviceId/property-types')
  @ApiOperation({ summary: 'List active property types for a service — customer booking flow, step 2' })
  @ApiParam({ name: 'serviceId', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Active property type list' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Service not found' })
  findPropertyTypes(@Param('serviceId', ParseUUIDPipe) serviceId: string) {
    return this.servicesService.findPropertyTypes(serviceId);
  }
}
