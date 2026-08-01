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
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AuthUser } from '../common/types/auth-user.type';
import { AddressesService } from './addresses.service';
import { CreateAddressDto } from './dto/create-address.dto';
import { UpdateAddressDto } from './dto/update-address.dto';

@ApiTags('Addresses')
@ApiBearerAuth('JWT')
@UseGuards(JwtAuthGuard)
@Controller('addresses')
export class AddressesController {
  constructor(private readonly addressesService: AddressesService) {}

  @Post()
  @ApiOperation({
    summary: 'Save a new address',
    description:
      'Creates a new saved address for the authenticated user. ' +
      'If this is the first address, it is automatically set as default. ' +
      'Pass `isDefault: true` to promote it and demote all others.',
  })
  @ApiResponse({
    status: 201,
    description: 'Address created',
    schema: {
      example: {
        success: true,
        data: {
          id: 'uuid',
          label: 'Home',
          fullName: 'Ravi Kumar',
          mobile: '+919876543210',
          houseNo: '42B',
          street: 'MG Road',
          landmark: 'Near HDFC Bank',
          city: 'Bengaluru',
          state: 'Karnataka',
          pincode: '560001',
          latitude: 12.9716,
          longitude: 77.5946,
          addressType: 'HOME',
          isDefault: true,
        },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Validation error — check required fields and coordinate ranges' })
  @ApiResponse({ status: 401, description: 'Unauthorized — Bearer token required' })
  create(@Body() dto: CreateAddressDto, @CurrentUser() user: AuthUser) {
    return this.addressesService.create(user.id, dto);
  }

  @Get()
  @ApiOperation({
    summary: 'List all saved addresses',
    description: 'Returns addresses ordered by default first, then most recent. Includes all address types.',
  })
  @ApiResponse({
    status: 200,
    description: 'List of addresses',
    schema: {
      example: {
        success: true,
        data: [
          { id: 'uuid-1', label: 'Home', city: 'Bengaluru', isDefault: true, addressType: 'HOME' },
          { id: 'uuid-2', label: 'Office', city: 'Mumbai', isDefault: false, addressType: 'OFFICE' },
        ],
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  findAll(@CurrentUser() user: AuthUser) {
    return this.addressesService.findAll(user.id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single address by ID' })
  @ApiParam({ name: 'id', description: 'Address UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Address detail' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Address not found or belongs to another user' })
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.addressesService.findOne(id, user.id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update an address — partial update supported' })
  @ApiParam({ name: 'id', description: 'Address UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Address updated' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Address not found or belongs to another user' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAddressDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.addressesService.update(id, user.id, dto);
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Delete an address',
    description: 'If the deleted address was the default, the next most recent address is automatically promoted to default.',
  })
  @ApiParam({ name: 'id', description: 'Address UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Address deleted' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Address not found or belongs to another user' })
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.addressesService.remove(id, user.id);
  }

  @Patch(':id/default')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Set an address as default',
    description: 'Clears the default flag from all other addresses and sets it on this one.',
  })
  @ApiParam({ name: 'id', description: 'Address UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Default address updated' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Address not found or belongs to another user' })
  setDefault(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.addressesService.setDefault(id, user.id);
  }
}
