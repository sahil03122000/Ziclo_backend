import { Module } from '@nestjs/common';

import { InvoicesModule } from './invoices/invoices.module';
import { PaymentsModule } from './payments/payments.module';

@Module({
  imports: [InvoicesModule, PaymentsModule],
})
export class InvoicingModule {}
