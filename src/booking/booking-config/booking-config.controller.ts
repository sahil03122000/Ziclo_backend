import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RoleGuard } from '../../common/guards/role.guard';
import { AuthUser } from '../../common/types/auth-user.type';
import { BookingConfigService } from './booking-config.service';
import { CheckServiceAreaDto } from './dto/check-service-area.dto';

@ApiTags('Booking / Config')
@ApiBearerAuth('JWT')
@UseGuards(JwtAuthGuard, RoleGuard)
@Controller('user')
export class BookingConfigController {
  constructor(private readonly bookingConfigService: BookingConfigService) {}

  @Get('booking-config')
  @Roles(Role.USER)
  @ApiOperation({ summary: 'Booking config — tax %, advance payment %, and active areas — USER' })
  @ApiResponse({
    status: 200,
    description: 'Booking configuration',
    schema: {
      example: {
        success: true,
        data: {
          taxPercentage: 18,
          advancePaymentPercentage: 20,
          activeAreas: [
            { id: 'uuid', name: 'South Bangalore', city: 'Bangalore', state: 'Karnataka' },
          ],
        },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — USER required' })
  getBookingConfig() {
    return this.bookingConfigService.getBookingConfig();
  }

  @Post('check-service-area')
  @Roles(Role.USER)
  @ApiOperation({ summary: 'Check whether a saved address is within an active service area — USER' })
  @ApiResponse({
    status: 200,
    description: 'Service area check result',
    schema: {
      example: {
        success: true,
        data: { serviceable: true, areaId: 'uuid', areaName: 'South Bangalore' },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid address' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — USER required' })
  checkServiceArea(@Body() dto: CheckServiceAreaDto, @CurrentUser() user: AuthUser) {
    return this.bookingConfigService.checkServiceArea(dto, user.id);
  }

  @Get('service-availability/:pincode')
  @Roles(Role.USER)
  @ApiOperation({ summary: 'Check service availability and active services for a pincode — USER' })
  @ApiResponse({
    status: 200,
    description: 'Availability result for the pincode',
    schema: {
      example: {
        success: true,
        data: {
          pincode: '301001',
          available: true,
          message: 'Ziclo is available in this area.',
          services: [{ id: 'uuid', name: 'AC Cleaning', thumbnail: null, iconUrl: null }],
        },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — USER required' })
  checkPincodeAvailability(@Param('pincode') pincode: string) {
    return this.bookingConfigService.checkPincodeAvailability(pincode);
  }
}
