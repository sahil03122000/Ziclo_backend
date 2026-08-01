import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseBoolPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RoleGuard } from '../common/guards/role.guard';
import { AuthUser } from '../common/types/auth-user.type';
import { Role } from '@prisma/client';
import { BannersService } from './banners.service';
import { CreateBannerDto } from './dto/create-banner.dto';
import { QueryBannersDto } from './dto/query-banners.dto';
import { UpdateBannerDto } from './dto/update-banner.dto';

@ApiTags('Banners')
@Controller()
export class BannersController {
  constructor(private readonly bannersService: BannersService) {}

  // ─── Public ───────────────────────────────────────────────────────────────

  @Get('banners')
  @ApiOperation({ summary: 'Get all active banners (public)' })
  @ApiResponse({ status: 200, description: 'List of active banners' })
  getActiveBanners() {
    return this.bannersService.findActive();
  }

  // ─── Admin: CRUD ──────────────────────────────────────────────────────────

  @Post('admin/banners')
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @ApiBearerAuth('JWT')
  @ApiOperation({ summary: 'Create a new banner (Admin)' })
  @ApiResponse({ status: 201, description: 'Banner created' })
  create(@Body() dto: CreateBannerDto, @CurrentUser() actor: AuthUser) {
    return this.bannersService.create(dto, {
      id: actor.id,
      name: actor.name,
      role: actor.role,
    });
  }

  @Get('admin/banners')
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @ApiBearerAuth('JWT')
  @ApiOperation({ summary: 'List all banners with pagination (Admin)' })
  @ApiResponse({ status: 200, description: 'Paginated banner list' })
  findAll(@Query() query: QueryBannersDto) {
    return this.bannersService.findAll(query);
  }

  @Get('admin/banners/:id')
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @ApiBearerAuth('JWT')
  @ApiOperation({ summary: 'Get a single banner by ID (Admin)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Banner detail' })
  @ApiResponse({ status: 404, description: 'Banner not found' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.bannersService.findOne(id);
  }

  @Patch('admin/banners/:id')
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @ApiBearerAuth('JWT')
  @ApiOperation({ summary: 'Update a banner (Admin)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Banner updated' })
  @ApiResponse({ status: 404, description: 'Banner not found' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBannerDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.bannersService.update(id, dto, {
      id: actor.id,
      name: actor.name,
      role: actor.role,
    });
  }

  @Patch('admin/banners/:id/status')
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @ApiBearerAuth('JWT')
  @ApiOperation({ summary: 'Activate or deactivate a banner (Admin)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiQuery({ name: 'isActive', type: 'boolean', required: true })
  @ApiResponse({ status: 200, description: 'Banner status updated' })
  toggleStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('isActive', ParseBoolPipe) isActive: boolean,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.bannersService.toggleActive(id, isActive, {
      id: actor.id,
      name: actor.name,
      role: actor.role,
    });
  }

  @Delete('admin/banners/:id')
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @ApiBearerAuth('JWT')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Soft-delete a banner (Admin)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Banner deleted' })
  @ApiResponse({ status: 404, description: 'Banner not found' })
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.bannersService.remove(id, {
      id: actor.id,
      name: actor.name,
      role: actor.role,
    });
  }
}
