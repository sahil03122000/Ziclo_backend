import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditAction, Role } from '@prisma/client';

import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { PrismaService } from '../prisma/prisma.service';
import { InviteMemberDto } from './dto/invite-member.dto';
import { UpdateMemberRoleDto } from './dto/update-member-role.dto';
import { OrganizationsService } from './organizations.service';

const MEMBER_SELECT = {
  id: true,
  role: true,
  isActive: true,
  joinedAt: true,
  updatedAt: true,
  user: {
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      role: true,
      profileImage: true,
    },
  },
};

@Injectable()
export class MembersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orgsService: OrganizationsService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async findAll(orgId: string) {
    await this.assertOrgExists(orgId);
    const members = await this.prisma.organizationUser.findMany({
      where: { organizationId: orgId },
      select: MEMBER_SELECT,
      orderBy: { joinedAt: 'asc' },
    });
    return { success: true, data: members };
  }

  async invite(orgId: string, dto: InviteMemberDto, actorId: string) {
    await this.orgsService.assertOrgAdmin(orgId, actorId);

    const user = await this.prisma.user.findUnique({
      where: { id: dto.userId },
      select: { id: true, isActive: true },
    });
    if (!user) throw new NotFoundException('User not found');
    if (!user.isActive)
      throw new ForbiddenException('Cannot invite an inactive user');

    const existing = await this.prisma.organizationUser.findUnique({
      where: {
        organizationId_userId: { organizationId: orgId, userId: dto.userId },
      },
      select: { id: true, isActive: true },
    });

    if (existing) {
      if (existing.isActive)
        throw new ConflictException(
          'User is already an active member of this organization',
        );
      // Re-activate deactivated member
      const updated = await this.prisma.organizationUser.update({
        where: { id: existing.id },
        data: { isActive: true, role: dto.role ?? Role.USER },
        select: MEMBER_SELECT,
      });
      return { success: true, message: 'Member re-activated', data: updated };
    }

    // Membership is recorded exclusively via OrganizationUser (a user can belong to
    // many orgs) — User.organizationId is a legacy scalar that is never read for
    // authorization anywhere in this codebase and is deliberately left untouched here;
    // writing it would make it silently point at whichever org the user joined most
    // recently, which is wrong the moment they belong to more than one.
    const member = await this.prisma.organizationUser.create({
      data: {
        organizationId: orgId,
        userId: dto.userId,
        role: dto.role ?? Role.USER,
      },
      select: MEMBER_SELECT,
    });

    this.auditLogs
      .log({
        actorId,
        entityType: 'OrganizationUser',
        entityId: member.id,
        action: AuditAction.ASSIGN,
        newValue: { orgId, userId: dto.userId, role: dto.role },
      })
      .catch(() => {});

    return {
      success: true,
      message: 'Member added to organization',
      data: member,
    };
  }

  async updateRole(
    orgId: string,
    targetUserId: string,
    dto: UpdateMemberRoleDto,
    actorId: string,
  ) {
    await this.orgsService.assertOrgAdmin(orgId, actorId);

    if (dto.role === Role.SUPER_ADMIN)
      throw new ForbiddenException(
        'Cannot assign SUPER_ADMIN role through org management',
      );

    const membership = await this.prisma.organizationUser.findUnique({
      where: {
        organizationId_userId: { organizationId: orgId, userId: targetUserId },
      },
      select: { id: true, role: true, isActive: true },
    });
    if (!membership)
      throw new NotFoundException('Member not found in this organization');
    if (!membership.isActive)
      throw new ForbiddenException('Cannot update role of inactive member');

    const updated = await this.prisma.organizationUser.update({
      where: { id: membership.id },
      data: { role: dto.role },
      select: MEMBER_SELECT,
    });

    this.auditLogs
      .log({
        actorId,
        entityType: 'OrganizationUser',
        entityId: membership.id,
        action: AuditAction.ROLE_CHANGE,
        oldValue: { role: membership.role },
        newValue: { role: dto.role },
      })
      .catch(() => {});

    return { success: true, message: 'Member role updated', data: updated };
  }

  async remove(orgId: string, targetUserId: string, actorId: string) {
    await this.orgsService.assertOrgAdmin(orgId, actorId);

    if (targetUserId === actorId)
      throw new ForbiddenException(
        'You cannot remove yourself from the organization',
      );

    const membership = await this.prisma.organizationUser.findUnique({
      where: {
        organizationId_userId: { organizationId: orgId, userId: targetUserId },
      },
      select: { id: true },
    });
    if (!membership)
      throw new NotFoundException('Member not found in this organization');

    await this.prisma.organizationUser.update({
      where: { id: membership.id },
      data: { isActive: false },
    });

    this.auditLogs
      .log({
        actorId,
        entityType: 'OrganizationUser',
        entityId: membership.id,
        action: AuditAction.DELETE,
        newValue: { removedUserId: targetUserId },
      })
      .catch(() => {});

    return { success: true, message: 'Member removed from organization' };
  }

  private async assertOrgExists(orgId: string) {
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      select: { id: true },
    });
    if (!org) throw new NotFoundException('Organization not found');
  }
}
