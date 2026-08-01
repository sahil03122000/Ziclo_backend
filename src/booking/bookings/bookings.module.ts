import { Module } from '@nestjs/common';

import { AuditLogsModule } from '../../audit-logs/audit-logs.module';
import { InvoicesModule } from '../../invoicing/invoices/invoices.module';
import { PaymentsModule } from '../../invoicing/payments/payments.module';
import { NotificationsModule } from '../../notifications/notifications.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';

@Module({
  imports: [PrismaModule, AuditLogsModule, NotificationsModule, InvoicesModule, PaymentsModule],
  controllers: [BookingsController],
  providers: [BookingsService],
  exports: [BookingsService],
})
export class BookingsModule {}
