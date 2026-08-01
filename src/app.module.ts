import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import { RequestIdMiddleware } from './common/middleware/request-id.middleware';
import { RequestLoggerMiddleware } from './common/middleware/request-logger.middleware';

import { ActivityLogModule } from './activity-log/activity-log.module';
import { AdminModule } from './admin/admin.module';
import { AddressesModule } from './addresses/addresses.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { CatalogModule } from './catalog/catalog.module';
import { AreasModule } from './areas/areas.module';
import { CommonModule } from './common/common.module';
import { AttendanceModule } from './attendance/attendance.module';
import { AuditLogsModule } from './audit-logs/audit-logs.module';
import { AuthModule } from './auth/auth.module';
import { BookingModule } from './booking/booking.module';
import { configuration } from './config/configuration';
import { validate } from './config/env.validation';
import { CrmModule } from './crm/crm.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { FirebaseModule } from './firebase/firebase.module';
import { HealthModule } from './health/health.module';
import { InvoicingModule } from './invoicing/invoicing.module';
import { LeavePolicyModule } from './leave-policy/leave-policy.module';
import { ManagerModule } from './manager/manager.module';
import { NotificationsModule } from './notifications/notifications.module';
import { OfficeLocationsModule } from './office-locations/office-locations.module';
import { OrganizationsModule } from './organizations/organizations.module';
import { OtpModule } from './otp/otp.module';
import { PlansModule } from './plans/plans.module';
import { PrismaModule } from './prisma/prisma.module';
import { ReportsModule } from './reports/reports.module';
import { SettingsModule } from './settings/settings.module';
import { SuperAdminModule } from './super-admin/super-admin.module';
import { SupportModule } from './support/support.module';
import { TasksModule } from './tasks/tasks.module';
import { TenantModule } from './tenant/tenant.module';
import { UploadsModule } from './uploads/uploads.module';
import { UsersModule } from './users/users.module';
import { BannersModule } from './banners/banners.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { WebsiteModule } from './website/website.module';
import { WorkerModule } from './worker/worker.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validate,
      envFilePath: ['.env', '.env.local'],
    }),
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60000, limit: 100 }]),
    ScheduleModule.forRoot(),
    PrismaModule,
    // ── Global cross-cutting modules ──────────────────────────────────────────
    CommonModule,
    FirebaseModule,
    AuditLogsModule,
    ActivityLogModule,
    NotificationsModule,
    TenantModule,
    // ── Feature modules ───────────────────────────────────────────────────────
    AuthModule,
    OtpModule,
    UsersModule,
    AdminModule,
    AttendanceModule,
    ManagerModule,
    WorkerModule,
    LeavePolicyModule,
    TasksModule,
    AreasModule,
    OfficeLocationsModule,
    UploadsModule,
    DashboardModule,
    ReportsModule,
    HealthModule,
    SettingsModule,
    AnalyticsModule,
    BookingModule,
    CatalogModule,
    AddressesModule,
    InvoicingModule,
    CrmModule,
    SupportModule,
    BannersModule,
    WebhooksModule,
    WebsiteModule,
    // ── Multi-tenant modules ──────────────────────────────────────────────────
    PlansModule,
    OrganizationsModule,
    SuperAdminModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(RequestIdMiddleware, RequestLoggerMiddleware)
      .forRoutes('*');
  }
}
