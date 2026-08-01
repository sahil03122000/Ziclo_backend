import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Request } from 'express';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RoleGuard } from '../../common/guards/role.guard';
import { AuthUser } from '../../common/types/auth-user.type';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { CreateRazorpayOrderDto } from './dto/create-razorpay-order.dto';
import { PaymentQueryDto } from './dto/payment-query.dto';
import { VerifyRazorpayDto } from './dto/verify-razorpay.dto';
import { PaymentsService } from './payments.service';

@ApiTags('Invoicing / Payments')
@ApiBearerAuth('JWT')
@UseGuards(JwtAuthGuard, RoleGuard)
@Controller('invoicing/payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  // ─── Razorpay (before /:id) ───────────────────────────────────────────────

  @Post('razorpay/order')
  @Roles(Role.USER, Role.ADMIN, Role.MANAGER)
  @ApiOperation({
    summary: 'Create a Razorpay order for invoice payment — USER / ADMIN / MANAGER',
    description:
      'Creates a Razorpay order for the outstanding balance on an invoice. ' +
      'Returns `{ razorpayOrderId, amount, currency, keyId }`. ' +
      'Pass `razorpayOrderId` to the Razorpay Checkout SDK on the client, then call `POST /razorpay/verify`.',
  })
  @ApiResponse({
    status: 201,
    description: 'Razorpay order created',
    schema: {
      example: {
        success: true,
        data: { razorpayOrderId: 'order_ABC123', amount: 124182, currency: 'INR', keyId: 'rzp_test_...' },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invoice already paid or Razorpay not configured' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Invoice not found' })
  createRazorpayOrder(@Body() dto: CreateRazorpayOrderDto, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.paymentsService.createRazorpayOrder(dto, user.id, req.organizationId);
  }

  @Post('razorpay/verify')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.USER, Role.ADMIN, Role.MANAGER)
  @ApiOperation({
    summary: 'Verify Razorpay payment signature and mark invoice PAID',
    description:
      'Call this immediately after the Razorpay Checkout callback succeeds on the client. ' +
      'Verifies the HMAC-SHA256 signature, records the payment, and marks the invoice PAID. ' +
      '**This is idempotent** — re-calling with the same `razorpayPaymentId` is safe.',
  })
  @ApiResponse({
    status: 200,
    description: 'Payment verified and recorded — invoice marked PAID',
    schema: {
      example: {
        success: true,
        data: { paymentId: 'uuid', razorpayPaymentId: 'pay_XYZ...', amount: 124182, status: 'SUCCESS' },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Signature verification failed' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Order not found' })
  verifyRazorpay(@Body() dto: VerifyRazorpayDto, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.paymentsService.verifyRazorpay(dto, user, req.organizationId);
  }

  @Get('health')
  @Roles(Role.ADMIN, Role.MANAGER)
  @ApiOperation({
    summary: 'Razorpay gateway health check — ADMIN / MANAGER',
    description: 'Returns `{ configured: true, mode: "test" }` when keys are present. Mode is `test` if the key starts with `rzp_test_`, otherwise `live`.',
  })
  @ApiResponse({
    status: 200,
    description: 'Gateway status',
    schema: { example: { success: true, data: { configured: true, mode: 'test' } } },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  getHealth() {
    return this.paymentsService.getHealth();
  }

  // ─── Offline payments ─────────────────────────────────────────────────────

  @Post()
  @Roles(Role.ADMIN, Role.MANAGER)
  @ApiOperation({
    summary: 'Record an offline payment — CASH / CARD / UPI / BANK_TRANSFER — ADMIN / MANAGER',
    description: 'Marks the invoice as PAID and creates a payment record with method `CASH`, `CARD`, `UPI`, or `BANK_TRANSFER`.',
  })
  @ApiResponse({ status: 201, description: 'Payment recorded — invoice marked PAID' })
  @ApiResponse({ status: 400, description: 'Invoice already paid or validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Invoice not found' })
  createPayment(@Body() dto: CreatePaymentDto, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.paymentsService.createPayment(dto, user, req.organizationId);
  }

  @Get()
  @Roles(Role.ADMIN, Role.MANAGER)
  @ApiOperation({ summary: 'List all payments with filters — ADMIN / MANAGER' })
  @ApiResponse({ status: 200, description: 'Paginated payment list' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  findAll(@Query() query: PaymentQueryDto, @Req() req: Request) {
    return this.paymentsService.findAll(query, req.organizationId);
  }

  @Get(':id')
  @Roles(Role.ADMIN, Role.MANAGER)
  @ApiOperation({ summary: 'Get a payment by ID — ADMIN / MANAGER' })
  @ApiParam({ name: 'id', description: 'Payment UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Payment detail' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Payment not found' })
  findOne(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.paymentsService.findOne(id, req.organizationId);
  }

  @Patch(':id/refund')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Refund a SUCCESS payment — ADMIN' })
  @ApiParam({ name: 'id', description: 'Payment UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Payment marked as REFUNDED' })
  @ApiResponse({ status: 400, description: 'Payment is not in SUCCESS status' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — ADMIN required' })
  @ApiResponse({ status: 404, description: 'Payment not found' })
  refund(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.paymentsService.refund(id, user.id, req.organizationId);
  }
}
