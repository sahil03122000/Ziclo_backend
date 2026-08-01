import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RoleGuard } from '../../common/guards/role.guard';
import { AuthUser } from '../../common/types/auth-user.type';
import { CreateSavedPaymentMethodDto } from './dto/create-saved-payment-method.dto';
import { PaymentMethodsService } from './payment-methods.service';

@ApiTags('Invoicing / Payment Methods')
@ApiBearerAuth('JWT')
@UseGuards(JwtAuthGuard, RoleGuard)
@Roles(Role.USER)
@Controller('payment-methods')
export class PaymentMethodsController {
  constructor(private readonly paymentMethodsService: PaymentMethodsService) {}

  @Get()
  @ApiOperation({ summary: "Logged-in customer's saved payment methods — USER", description: 'Empty array if none exist — the section should be hidden client-side in that case.' })
  @ApiResponse({ status: 200, description: 'Saved payment method list' })
  list(@CurrentUser() user: AuthUser) {
    return this.paymentMethodsService.list(user.id);
  }

  @Post()
  @ApiOperation({ summary: 'Save a new payment method — USER', description: 'The new method is always saved as the default.' })
  @ApiResponse({ status: 201, description: 'Payment method saved' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  create(@Body() dto: CreateSavedPaymentMethodDto, @CurrentUser() user: AuthUser) {
    return this.paymentMethodsService.create(user.id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Remove a saved payment method — USER', description: 'Soft-deletes the method (isActive: false); it stops appearing in the list.' })
  @ApiParam({ name: 'id', description: 'SavedPaymentMethod UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Payment method removed' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — not the owner of this payment method' })
  @ApiResponse({ status: 404, description: 'Payment method not found' })
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.paymentMethodsService.remove(id, user.id);
  }
}
