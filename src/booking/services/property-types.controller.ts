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
@Controller('property-types')
export class PropertyTypesController {
  constructor(private readonly servicesService: PublicServicesService) {}

  @Get(':propertyTypeId/packages')
  @ApiOperation({ summary: 'List active packages for a property type — customer booking flow, step 3' })
  @ApiParam({ name: 'propertyTypeId', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Active package list' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Property type not found' })
  findPackages(@Param('propertyTypeId', ParseUUIDPipe) propertyTypeId: string) {
    return this.servicesService.findPackages(propertyTypeId);
  }
}
