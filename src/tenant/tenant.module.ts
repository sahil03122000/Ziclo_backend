import { Global, Module } from '@nestjs/common';

import { TenantAccessService } from './tenant-access.service';

/**
 * Global module — TenantAccessService is available everywhere without imports.
 *
 * The X-Organization-Id header requirement (TenantMiddleware/TenantGuard) has
 * been removed — this is a single-company deployment, not multi-tenant SaaS.
 * TenantAccessService itself is kept: OrganizationsService.assertOrgAdmin still
 * uses it to verify org-admin membership for the Organizations management API
 * (create/update/delete an org, invite/remove members, manage subscriptions),
 * which is unrelated to the removed per-request tenant scoping.
 *
 * SuperAdminGuard is used via @UseGuards() and resolves its own PrismaService
 * dependency from the global PrismaModule.
 */
@Global()
@Module({
  providers: [TenantAccessService],
  exports: [TenantAccessService],
})
export class TenantModule {}
