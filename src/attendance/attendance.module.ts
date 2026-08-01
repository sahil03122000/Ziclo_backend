import { Module } from '@nestjs/common';

import { LeavePolicyModule } from '../leave-policy/leave-policy.module';
import { AdminMissedCheckoutController } from './admin-missed-checkout.controller';
import { AttendanceController } from './attendance.controller';
import { AttendanceCronService } from './attendance.cron';
import { AttendanceService } from './attendance.service';
import { LegacyMissedCheckoutController } from './legacy-missed-checkout.controller';
import { ManagerMissedCheckoutController } from './manager-missed-checkout.controller';
import { MissedCheckoutService } from './missed-checkout.service';
import { WorkerMissedCheckoutController } from './worker-missed-checkout.controller';

@Module({
  imports: [LeavePolicyModule],
  controllers: [
    AttendanceController,
    WorkerMissedCheckoutController,
    ManagerMissedCheckoutController,
    AdminMissedCheckoutController,
    LegacyMissedCheckoutController,
  ],
  providers: [AttendanceService, MissedCheckoutService, AttendanceCronService],
  exports: [AttendanceService],
})
export class AttendanceModule {}
