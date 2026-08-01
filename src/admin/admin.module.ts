import { Module } from '@nestjs/common';

import { AreasModule } from '../areas/areas.module';
import { AttendanceModule } from '../attendance/attendance.module';
import { DashboardModule } from '../dashboard/dashboard.module';
import { EmailModule } from '../email/email.module';
import { OfficeLocationsModule } from '../office-locations/office-locations.module';
import { ReportsModule } from '../reports/reports.module';
import { AdminSupportController } from './support/admin-support.controller';
import { AdminSupportService } from './support/admin-support.service';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

@Module({
  imports: [
    AreasModule,
    OfficeLocationsModule,
    EmailModule,
    ReportsModule,
    AttendanceModule,
    DashboardModule,
  ],
  controllers: [AdminController, AdminSupportController],
  providers: [AdminService, AdminSupportService],
  exports: [AdminService],
})
export class AdminModule {}
