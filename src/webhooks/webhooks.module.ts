import { Module } from '@nestjs/common';

import { InvoicesModule } from '../invoicing/invoices/invoices.module';
import { RazorpayWebhookController } from './razorpay-webhook.controller';
import { RazorpayWebhookService } from './razorpay-webhook.service';

@Module({
  imports: [InvoicesModule],
  controllers: [RazorpayWebhookController],
  providers: [RazorpayWebhookService],
})
export class WebhooksModule {}
