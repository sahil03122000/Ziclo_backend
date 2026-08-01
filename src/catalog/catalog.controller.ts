import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RoleGuard } from '../common/guards/role.guard';
import { AuthUser } from '../common/types/auth-user.type';
import { CreatePackageDto } from './dto/create-package.dto';
import { CreatePricingOptionDto } from './dto/create-pricing-option.dto';
import { CreatePropertyTypeDto } from './dto/create-property-type.dto';
import { CreateServiceDto } from './dto/create-service.dto';
import { UpdatePackageDto } from './dto/update-package.dto';
import { UpdatePricingOptionDto } from './dto/update-pricing-option.dto';
import { UpdatePackageStatusDto } from './dto/update-package-status.dto';
import { UpdatePropertyTypeDto } from './dto/update-property-type.dto';
import { UpdateServiceDto } from './dto/update-service.dto';
import { PackagesService } from './packages.service';
import { PricingOptionsService } from './pricing-options.service';
import { PropertyTypesService } from './property-types.service';
import { CatalogServicesService } from './services.service';

const R401 = { status: 401, description: 'Unauthorized — Bearer token required' };
const R403 = { status: 403, description: 'Forbidden — role ADMIN required' };
const R404 = { status: 404, description: 'Not found' };
const R400 = { status: 400, description: 'Validation error' };

@ApiTags('Admin / Service Management')
@ApiBearerAuth('JWT')
@UseGuards(JwtAuthGuard, RoleGuard)
@Roles(Role.ADMIN, Role.SUPER_ADMIN)
@Controller('admin')
export class CatalogController {
  constructor(
    private readonly services: CatalogServicesService,
    private readonly propertyTypes: PropertyTypesService,
    private readonly packages: PackagesService,
    private readonly pricingOptions: PricingOptionsService,
  ) {}

  // ─── Services ─────────────────────────────────────────────────────────────────

  @Post('services')
  @ApiOperation({
    summary: 'Create a service with its property types and packages',
    description: 'Creates the Service, its PropertyTypes, and their Packages in a single atomic write.',
  })
  @ApiResponse({
    status: 201,
    description: 'Service created',
    schema: {
      example: { success: true, message: 'Service created successfully', data: { id: 'uuid', name: 'Solar Cleaning' } },
    },
  })
  @ApiResponse(R400)
  @ApiResponse(R401)
  @ApiResponse(R403)
  createService(@Body() dto: CreateServiceDto, @CurrentUser() user: AuthUser) {
    return this.services.create(dto, user.id);
  }

  @Get('services')
  @ApiOperation({ summary: 'List all services' })
  @ApiResponse({ status: 200, description: 'Service list' })
  @ApiResponse(R401)
  @ApiResponse(R403)
  listServices() {
    return this.services.list();
  }

  @Get('services/:id')
  @ApiOperation({
    summary: 'Get full service detail',
    description: 'Returns the service with its property types, each including its packages.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Service detail with nested property types and packages' })
  @ApiResponse(R401)
  @ApiResponse(R403)
  @ApiResponse(R404)
  getService(@Param('id', ParseUUIDPipe) id: string) {
    return this.services.getDetail(id);
  }

  @Put('services/:id')
  @ApiOperation({ summary: 'Update a service — partial update supported' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Service updated' })
  @ApiResponse(R400)
  @ApiResponse(R401)
  @ApiResponse(R403)
  @ApiResponse(R404)
  updateService(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateServiceDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.services.update(id, dto, user.id);
  }

  @Delete('services/:id')
  @ApiOperation({
    summary: 'Delete a service',
    description: 'Cascade deletes all of the service\'s property types and their packages.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Service deleted' })
  @ApiResponse(R401)
  @ApiResponse(R403)
  @ApiResponse(R404)
  deleteService(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.services.remove(id, user.id);
  }

  // ─── Property Types ───────────────────────────────────────────────────────────

  @Post('services/:serviceId/property-types')
  @ApiOperation({ summary: 'Add a property type to a service' })
  @ApiParam({ name: 'serviceId', format: 'uuid' })
  @ApiResponse({ status: 201, description: 'Property type created' })
  @ApiResponse(R400)
  @ApiResponse(R401)
  @ApiResponse(R403)
  @ApiResponse(R404)
  createPropertyType(
    @Param('serviceId', ParseUUIDPipe) serviceId: string,
    @Body() dto: CreatePropertyTypeDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.propertyTypes.create(serviceId, dto, user.id);
  }

  @Get('services/:serviceId/property-types')
  @ApiOperation({ summary: 'List property types for a service, each with its packages' })
  @ApiParam({ name: 'serviceId', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Property type list' })
  @ApiResponse(R401)
  @ApiResponse(R403)
  @ApiResponse(R404)
  listPropertyTypes(@Param('serviceId', ParseUUIDPipe) serviceId: string) {
    return this.propertyTypes.listForService(serviceId);
  }

  @Put('property-types/:id')
  @ApiOperation({ summary: 'Update a property type — partial update supported' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Property type updated' })
  @ApiResponse(R400)
  @ApiResponse(R401)
  @ApiResponse(R403)
  @ApiResponse(R404)
  updatePropertyType(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePropertyTypeDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.propertyTypes.update(id, dto, user.id);
  }

  @Delete('property-types/:id')
  @ApiOperation({ summary: 'Delete a property type', description: 'Cascade deletes all of its packages.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Property type deleted' })
  @ApiResponse(R401)
  @ApiResponse(R403)
  @ApiResponse(R404)
  deletePropertyType(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.propertyTypes.remove(id, user.id);
  }

  // ─── Packages ─────────────────────────────────────────────────────────────────

  @Post('property-types/:propertyTypeId/packages')
  @ApiOperation({ summary: 'Add a package to a property type' })
  @ApiParam({ name: 'propertyTypeId', format: 'uuid' })
  @ApiResponse({ status: 201, description: 'Package created' })
  @ApiResponse(R400)
  @ApiResponse(R401)
  @ApiResponse(R403)
  @ApiResponse(R404)
  createPackage(
    @Param('propertyTypeId', ParseUUIDPipe) propertyTypeId: string,
    @Body() dto: CreatePackageDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.packages.create(propertyTypeId, dto, user.id);
  }

  @Get('property-types/:id/packages')
  @ApiOperation({ summary: 'List packages for a property type' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Package list' })
  @ApiResponse(R401)
  @ApiResponse(R403)
  @ApiResponse(R404)
  listPackages(@Param('id', ParseUUIDPipe) id: string) {
    return this.packages.listForPropertyType(id);
  }

  @Put('packages/:id')
  @ApiOperation({ summary: 'Update a package — partial update supported' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Package updated' })
  @ApiResponse(R400)
  @ApiResponse(R401)
  @ApiResponse(R403)
  @ApiResponse(R404)
  updatePackage(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePackageDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.packages.update(id, dto, user.id);
  }

  @Patch('packages/:id/status')
  @ApiOperation({ summary: 'Activate or deactivate a package' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Package status updated' })
  @ApiResponse(R400)
  @ApiResponse(R401)
  @ApiResponse(R403)
  @ApiResponse(R404)
  updatePackageStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePackageStatusDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.packages.updateStatus(id, dto, user.id);
  }

  @Delete('packages/:id')
  @ApiOperation({ summary: 'Delete a package' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Package deleted' })
  @ApiResponse(R401)
  @ApiResponse(R403)
  @ApiResponse(R404)
  deletePackage(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.packages.remove(id, user.id);
  }

  // ─── Pricing Options (Package → Pricing Option → Price, e.g. Solar "1-3 KW" = ₹499) ─────

  @Post('packages/:packageId/pricing-options')
  @ApiOperation({ summary: 'Add a pricing option to a package' })
  @ApiParam({ name: 'packageId', format: 'uuid' })
  @ApiResponse({ status: 201, description: 'Pricing option created' })
  @ApiResponse(R400)
  @ApiResponse(R401)
  @ApiResponse(R403)
  @ApiResponse(R404)
  createPricingOption(
    @Param('packageId', ParseUUIDPipe) packageId: string,
    @Body() dto: CreatePricingOptionDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.pricingOptions.create(packageId, dto, user.id);
  }

  @Get('packages/:packageId/pricing-options')
  @ApiOperation({ summary: 'List pricing options for a package' })
  @ApiParam({ name: 'packageId', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Pricing option list' })
  @ApiResponse(R401)
  @ApiResponse(R403)
  @ApiResponse(R404)
  listPricingOptions(@Param('packageId', ParseUUIDPipe) packageId: string) {
    return this.pricingOptions.listForPackage(packageId);
  }

  @Put('pricing-options/:id')
  @ApiOperation({ summary: 'Update a pricing option — partial update supported' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Pricing option updated' })
  @ApiResponse(R400)
  @ApiResponse(R401)
  @ApiResponse(R403)
  @ApiResponse(R404)
  updatePricingOption(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePricingOptionDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.pricingOptions.update(id, dto, user.id);
  }

  @Delete('pricing-options/:id')
  @ApiOperation({ summary: 'Delete a pricing option', description: 'A package must always keep at least one pricing option.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Pricing option deleted' })
  @ApiResponse(R400)
  @ApiResponse(R401)
  @ApiResponse(R403)
  @ApiResponse(R404)
  deletePricingOption(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.pricingOptions.remove(id, user.id);
  }
}
