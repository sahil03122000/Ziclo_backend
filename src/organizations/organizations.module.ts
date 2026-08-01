import { Module } from '@nestjs/common';

import { MembersController } from './members.controller';
import { MembersService } from './members.service';
import { OrganizationsController } from './organizations.controller';
import { OrganizationsService } from './organizations.service';
import { SubscriptionsController } from './subscriptions.controller';
import { SubscriptionsService } from './subscriptions.service';

@Module({
  controllers: [OrganizationsController, MembersController, SubscriptionsController],
  providers: [OrganizationsService, MembersService, SubscriptionsService],
  exports: [OrganizationsService, SubscriptionsService],
})
export class OrganizationsModule {}
