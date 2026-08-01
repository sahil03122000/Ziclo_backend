import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
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
import { CreateTimeSlotDto } from './dto/create-time-slot.dto';
import { TimeSlotQueryDto } from './dto/time-slot-query.dto';
import { TimeSlotsService } from './time-slots.service';

@ApiTags('Booking / Time Slots')
@ApiBearerAuth('JWT')
@UseGuards(JwtAuthGuard, RoleGuard)
@Controller('booking/time-slots')
export class TimeSlotsController {
  constructor(private readonly timeSlotsService: TimeSlotsService) {}

  @Post()
  @Roles(Role.ADMIN, Role.MANAGER)
  @ApiOperation({ summary: 'Create a time slot for a service — ADMIN / MANAGER' })
  @ApiResponse({ status: 201, description: 'Time slot created' })
  @ApiResponse({ status: 400, description: 'Validation error or overlapping slot' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  create(@Body() dto: CreateTimeSlotDto, @CurrentUser() user: AuthUser) {
    return this.timeSlotsService.create(dto, user.id);
  }

  @Get()
  @Roles(Role.ADMIN, Role.MANAGER, Role.USER)
  @ApiOperation({ summary: 'List time slots — filterable by service, date, availability' })
  @ApiResponse({ status: 200, description: 'List of time slots' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  findAll(@Query() query: TimeSlotQueryDto) {
    return this.timeSlotsService.findAll(query);
  }

  @Get(':id')
  @Roles(Role.ADMIN, Role.MANAGER, Role.USER)
  @ApiOperation({ summary: 'Get a time slot by ID' })
  @ApiParam({ name: 'id', description: 'Time slot UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Time slot detail' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Time slot not found' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.timeSlotsService.findOne(id);
  }

  @Patch(':id/availability')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.ADMIN, Role.MANAGER)
  @ApiOperation({ summary: 'Toggle time slot availability on/off — ADMIN / MANAGER' })
  @ApiParam({ name: 'id', description: 'Time slot UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Availability toggled' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Time slot not found' })
  toggleAvailability(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.timeSlotsService.toggleAvailability(id, user.id);
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Delete a time slot (only if no bookings) — ADMIN' })
  @ApiParam({ name: 'id', description: 'Time slot UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Time slot deleted' })
  @ApiResponse({ status: 400, description: 'Cannot delete — existing bookings reference this slot' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — ADMIN required' })
  @ApiResponse({ status: 404, description: 'Time slot not found' })
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.timeSlotsService.remove(id, user.id);
  }
}
