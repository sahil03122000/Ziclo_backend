import { Module } from '@nestjs/common';

import { LeavePolicyController } from './leave-policy.controller';
import { LeavePolicyCronService } from './leave-policy.cron';
import { LeavePolicyService } from './leave-policy.service';

@Module({
  controllers: [LeavePolicyController],
  providers: [LeavePolicyService, LeavePolicyCronService],
  exports: [LeavePolicyService],
})
export class LeavePolicyModule {}
