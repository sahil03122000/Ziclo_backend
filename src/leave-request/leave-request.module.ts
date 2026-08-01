import { Module } from '@nestjs/common';

import { AttendanceModule } from '../attendance/attendance.module';
import { LeavePolicyModule } from '../leave-policy/leave-policy.module';
import { AdminLeaveRequestsController } from './admin-leave-requests.controller';
import { LeaveRequestService } from './leave-request.service';
import { ManagerLeaveRequestsController } from './manager-leave-requests.controller';

@Module({
  imports: [AttendanceModule, LeavePolicyModule],
  controllers: [ManagerLeaveRequestsController, AdminLeaveRequestsController],
  providers: [LeaveRequestService],
  exports: [LeaveRequestService],
})
export class LeaveRequestModule {}
