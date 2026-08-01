import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Put,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RoleGuard } from '../../common/guards/role.guard';
import { AuthUser } from '../../common/types/auth-user.type';
import { CatalogServicesService } from '../../catalog/services.service';
import { CreateServiceDto } from '../../catalog/dto/create-service.dto';
import { UpdateServiceDto } from '../../catalog/dto/update-service.dto';
import { UpdateServiceStatusDto } from '../../catalog/dto/update-service-status.dto';
import { BookingServicesQueryDto } from './dto/booking-services-query.dto';

const R401 = { status: 401, description: 'Unauthorized' };
const R403 = { status: 403, description: 'Forbidden — ADMIN required' };
const R404 = { status: 404, description: 'Service not found' };

@ApiTags('Booking / Services')
@ApiBearerAuth('JWT')
@UseGuards(JwtAuthGuard, RoleGuard)
@Roles(Role.ADMIN, Role.SUPER_ADMIN)
@Controller('booking/services')
export class BookingServicesController {
  constructor(private readonly catalogServices: CatalogServicesService) {}

  @Post()
  @ApiOperation({
    summary: 'Create a service with its property types and packages',
    description:
      'Creates the Service, its PropertyTypes, and their Packages in a single atomic write. ' +
      'Same underlying logic as `POST /admin/services` — exposed here for the Service Management UI.',
  })
  @ApiResponse({
    status: 201,
    description: 'Service created',
    schema: {
      example: { success: true, message: 'Service created successfully', data: { id: 'uuid', name: 'Solar Cleaning' } },
    },
  })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse(R401)
  @ApiResponse(R403)
  create(@Body() dto: CreateServiceDto, @CurrentUser() user: AuthUser) {
    return this.catalogServices.create(dto, user.id);
  }

  @Get()
  @ApiOperation({
    summary: 'List services — paginated, with full nested property types and packages',
    description:
      'Supports pagination, search by name/description, and filtering by status. ' +
      'Optional params are never rejected when sent empty.',
  })
  @ApiResponse({
    status: 200,
    description: 'Paginated service list',
    schema: {
      example: {
        success: true,
        data: {
          services: [
            {
              id: 'uuid',
              name: 'Solar Cleaning',
              description: 'Professional Solar Cleaning',
              thumbnailImage: 'https://.../thumb.jpg',
              bannerImage: 'https://.../banner.jpg',
              isActive: true,
              propertyTypes: [
                {
                  id: 'uuid',
                  name: 'Residential',
                  displayOrder: 1,
                  isActive: true,
                  packages: [
                    {
                      id: 'uuid',
                      name: 'One time',
                      description: 'One time at',
                      basePrice: 499,
                      duration: 90,
                      displayOrder: 1,
                      isActive: true,
                    },
                  ],
                },
              ],
            },
          ],
          meta: { page: 1, limit: 20, total: 15, totalPages: 1 },
        },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — ADMIN required' })
  findAll(@Query() query: BookingServicesQueryDto) {
    return this.catalogServices.listPaginated(query);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get full service detail — Service Management edit screen',
    description: 'Returns the service with its property types, each including its packages, for editing.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Service detail with nested property types and packages',
    schema: {
      example: {
        success: true,
        data: {
          id: 'uuid',
          name: 'Solar Cleaning',
          description: 'Professional solar panel cleaning',
          thumbnailImage: 'https://.../thumb.jpg',
          bannerImage: 'https://.../banner.jpg',
          isActive: true,
          propertyTypes: [
            {
              id: 'uuid',
              name: 'Residential',
              displayOrder: 1,
              isActive: true,
              packages: [
                {
                  id: 'uuid',
                  name: 'One time',
                  description: 'One time at',
                  basePrice: 499,
                  duration: 90,
                  displayOrder: 1,
                  isActive: true,
                },
              ],
            },
          ],
        },
      },
    },
  })
  @ApiResponse(R401)
  @ApiResponse(R403)
  @ApiResponse(R404)
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.catalogServices.getBookingDetail(id);
  }

  @Put(':id')
  @ApiOperation({
    summary: 'Update a service — partial update supported',
    description: 'Same underlying logic as `PUT /admin/services/:id` — exposed here for the Service Management UI.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Service updated' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse(R401)
  @ApiResponse(R403)
  @ApiResponse(R404)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateServiceDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.catalogServices.update(id, dto, user.id);
  }

  @Patch(':id/status')
  @ApiOperation({
    summary: 'Activate or deactivate a service — ADMIN',
    description:
      'Updates only isActive — no other field is touched. GET /services (the customer Home ' +
      "screen's active service list) reads Service.isActive live, so the change is reflected " +
      'there immediately.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Service status updated',
    schema: { example: { success: true, data: { id: 'uuid', isActive: false } } },
  })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse(R401)
  @ApiResponse(R403)
  @ApiResponse(R404)
  updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateServiceStatusDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.catalogServices.updateStatus(id, dto, user.id);
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Delete a service',
    description:
      'Cascade deletes all of the service\'s property types and their packages. ' +
      'Same underlying logic as `DELETE /admin/services/:id` — exposed here for the Service Management UI.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Service deleted' })
  @ApiResponse(R401)
  @ApiResponse(R403)
  @ApiResponse(R404)
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.catalogServices.remove(id, user.id);
  }
}
