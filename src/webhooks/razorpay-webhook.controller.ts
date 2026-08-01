import {
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Request } from 'express';

import { RazorpayWebhookService } from './razorpay-webhook.service';

@ApiTags('Webhooks')
@SkipThrottle()
@Controller('webhooks')
export class RazorpayWebhookController {
  private readonly logger = new Logger(RazorpayWebhookController.name);

  constructor(private readonly webhookService: RazorpayWebhookService) {}

  /**
   * POST /api/v1/webhooks/razorpay
   *
   * Public endpoint — called directly by Razorpay servers.
   * No auth guard. Signature is verified using HMAC-SHA256 + RAZORPAY_WEBHOOK_SECRET.
   *
   * Razorpay retries on any non-2xx response, so:
   * - 400 = bad payload / invalid signature (do NOT retry)
   * - 200 = success (already processed or newly processed)
   * - 500 = processing error (Razorpay will retry)
   */
  @Post('razorpay')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Razorpay webhook receiver',
    description:
      'Receives and processes Razorpay event callbacks. ' +
      'Signature is verified via HMAC-SHA256 using `RAZORPAY_WEBHOOK_SECRET`. ' +
      'Handles: `payment.captured`, `payment.failed`, `order.paid`, `refund.processed`, ' +
      '`subscription.activated`, `subscription.cancelled`. ' +
      'All events are stored in `WebhookEvent` for auditing and idempotency.',
  })
  @ApiResponse({ status: 200, description: 'Webhook received and processed (or already processed — idempotent)' })
  @ApiResponse({ status: 401, description: 'Invalid webhook signature' })
  @ApiResponse({ status: 500, description: 'Processing error — Razorpay will retry' })
  async handleRazorpay(
    @Req() req: Request,
    @Headers('x-razorpay-signature') signature: string,
  ) {
    const rawBody: Buffer | undefined = (req as any).rawBody;

    if (!rawBody || !rawBody.length) {
      this.logger.warn('Razorpay webhook called with empty body');
      return { success: true, message: 'Empty body — ignored' };
    }

    if (!signature) {
      this.logger.warn('Razorpay webhook missing x-razorpay-signature header');
      // Still attempt processing in dev; strict rejection enforced in service when secret is set
    }

    await this.webhookService.handleWebhook(rawBody, signature ?? '');

    return { success: true, message: 'Webhook received' };
  }
}
