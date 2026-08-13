import { Module } from '@nestjs/common';

import { AdminModule } from '../admin/admin.module';
import { AreasModule } from '../areas/areas.module';
import { AttendanceModule } from '../attendance/attendance.module';
import { BookingsModule } from '../booking/bookings/bookings.module';
import { DashboardModule } from '../dashboard/dashboard.module';
import { LeavePolicyModule } from '../leave-policy/leave-policy.module';
import { LeaveRequestModule } from '../leave-request/leave-request.module';
import { ReportsModule } from '../reports/reports.module';
import { SupportModule } from '../support/support.module';
import { TasksModule } from '../tasks/tasks.module';
import { ManagerAreasController } from './manager-areas.controller';
import { ManagerJobsController } from './manager-jobs.controller';
import { ManagerLiveTrackingController } from './manager-live-tracking.controller';
import { ManagerReportsController } from './manager-reports.controller';
import { ManagerWorkersController } from './manager-workers.controller';
import { ManagerController } from './manager.controller';
import { ManagerService } from './manager.service';

@Module({
  imports: [
    DashboardModule,
    AttendanceModule,
    SupportModule,
    AdminModule,
    ReportsModule,
    TasksModule,
    AreasModule,
    BookingsModule,
    LeavePolicyModule,
    LeaveRequestModule,
  ],
  controllers: [
    ManagerController,
    ManagerWorkersController,
    ManagerAreasController,
    ManagerReportsController,
    ManagerJobsController,
    ManagerLiveTrackingController,
  ],
  providers: [ManagerService],
})
export class ManagerModule {}
