import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';

import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RoleGuard } from '../common/guards/role.guard';
import { CreateSettingDto } from './dto/create-setting.dto';
import { UpdateSettingDto } from './dto/update-setting.dto';
import { SettingsService } from './settings.service';

@ApiTags('Settings')
@ApiBearerAuth('JWT')
@Controller('settings')
@UseGuards(JwtAuthGuard, RoleGuard)
@Roles(Role.ADMIN)
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new system setting — ADMIN' })
  @ApiResponse({ status: 201, description: 'Setting created' })
  @ApiResponse({ status: 400, description: 'Key already exists or validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — ADMIN required' })
  create(@Body() dto: CreateSettingDto) {
    return this.settingsService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'Get all system settings — ADMIN' })
  @ApiResponse({
    status: 200,
    description: 'All settings as key-value pairs',
    schema: {
      example: {
        success: true,
        data: [
          { id: 'uuid', key: 'MAX_BOOKINGS_PER_SLOT', value: '5', description: 'Max bookings per time slot' },
          { id: 'uuid2', key: 'LATE_CHECKIN_GRACE_MINUTES', value: '15', description: 'Minutes after shift start before marked late' },
        ],
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — ADMIN required' })
  findAll() {
    return this.settingsService.findAll();
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a system setting value by ID — ADMIN' })
  @ApiParam({ name: 'id', description: 'Setting UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Setting updated' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — ADMIN required' })
  @ApiResponse({ status: 404, description: 'Setting not found' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateSettingDto) {
    return this.settingsService.update(id, dto);
  }
}
