import { ForbiddenException, Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

/**
 * THE single source of truth for "is user X an active member of organization Y",
 * and for org-admin authorization built on top of it. OrganizationsService.
 * assertOrgAdmin (which delegates to requireOrgAdmin below rather than
 * re-querying OrganizationUser itself) is the remaining consumer — per-request
 * tenant scoping (the old TenantGuard) has been removed for this single-company
 * deployment.
 *
 * Membership is defined exclusively by the OrganizationUser join table. User.
 * organizationId (a legacy scalar column) is NEVER read here or anywhere else in
 * the codebase — it cannot represent a many-to-many user/org relationship
 * correctly (a user can belong to multiple orgs; the scalar can only point to
 * one, and silently goes stale the moment a user joins a second org).
 */
@Injectable()
export class TenantAccessService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Throws ForbiddenException unless userId is an active member of organizationId.
   * Returns the membership's role so callers (e.g. requireOrgAdmin) don't need a
   * second query.
   */
  async assertActiveMembership(
    userId: string,
    organizationId: string,
  ): Promise<{ role: Role }> {
    const membership = await this.prisma.organizationUser.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
      select: { isActive: true, role: true },
    });

    if (!membership || !membership.isActive) {
      throw new ForbiddenException(
        'You are not an active member of this organization',
      );
    }

    return { role: membership.role };
  }

  /** Active organization memberships for userId — used for single-org auto-resolve. */
  async findActiveMembershipOrgIds(userId: string): Promise<string[]> {
    const memberships = await this.prisma.organizationUser.findMany({
      where: { userId, isActive: true },
      select: { organizationId: true },
    });
    return memberships.map((m) => m.organizationId);
  }

  /**
   * Throws ForbiddenException unless userId is a SUPER_ADMIN or an active
   * ADMIN/ORGANIZATION_ADMIN member of organizationId. The single implementation
   * of "org-admin" authorization — replaces the identical logic that used to be
   * duplicated inline in OrganizationsService.
   */
  async requireOrgAdmin(userId: string, organizationId: string): Promise<void> {
    const caller = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    if (caller?.role === Role.SUPER_ADMIN) return;

    const { role } = await this.assertActiveMembership(userId, organizationId);
    if (role !== Role.ADMIN && role !== Role.ORGANIZATION_ADMIN) {
      throw new ForbiddenException('Organization admin access required');
    }
  }
}
