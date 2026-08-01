import { Module } from '@nestjs/common';

import { InvoicesModule } from '../invoices/invoices.module';
import { PaymentMethodsController } from './payment-methods.controller';
import { PaymentMethodsService } from './payment-methods.service';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { RazorpayService } from './razorpay.service';

@Module({
  imports: [InvoicesModule],
  controllers: [PaymentsController, PaymentMethodsController],
  providers: [PaymentsService, RazorpayService, PaymentMethodsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
