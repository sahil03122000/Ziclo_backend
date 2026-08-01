import { Module } from '@nestjs/common';

import { AttendanceModule } from '../attendance/attendance.module';
import { LeavePolicyModule } from '../leave-policy/leave-policy.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

@Module({
  imports: [AttendanceModule, LeavePolicyModule],
  controllers: [DashboardController],
  providers: [DashboardService],
  exports: [DashboardService],
})
export class DashboardModule {}
