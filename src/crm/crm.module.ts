import { Module } from '@nestjs/common';

import { ActivitiesModule } from './activities/activities.module';
import { ContactsModule } from './contacts/contacts.module';
import { CrmController } from './crm.controller';
import { CrmService } from './crm.service';
import { CustomersModule } from './customers/customers.module';
import { DealsModule } from './deals/deals.module';
import { LeadsModule } from './leads/leads.module';

@Module({
  imports: [CustomersModule, LeadsModule, DealsModule, ContactsModule, ActivitiesModule],
  controllers: [CrmController],
  providers: [CrmService],
})
export class CrmModule {}
