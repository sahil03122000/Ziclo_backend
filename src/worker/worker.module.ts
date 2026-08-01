import { Module } from '@nestjs/common';

import { AttendanceModule } from '../attendance/attendance.module';
import { LeavePolicyModule } from '../leave-policy/leave-policy.module';
import { LeaveRequestModule } from '../leave-request/leave-request.module';
import { WorkerController } from './worker.controller';
import { WorkerService } from './worker.service';

@Module({
  imports: [AttendanceModule, LeavePolicyModule, LeaveRequestModule],
  controllers: [WorkerController],
  providers: [WorkerService],
  exports: [WorkerService],
})
export class WorkerModule {}
