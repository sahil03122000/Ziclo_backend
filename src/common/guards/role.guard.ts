import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';

import { ROLES_KEY } from '../decorators/roles.decorator';

@Injectable()
export class RoleGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest();

    // SUPER_ADMIN bypasses all role-based restrictions
    if (user?.role === Role.SUPER_ADMIN) return true;

    if (!user || !requiredRoles.includes(user.role)) {
      // ORGANIZATION_ADMIN is treated as equivalent to ADMIN for existing endpoints
      const isOrgAdminEquivalent =
        user?.role === Role.ORGANIZATION_ADMIN && requiredRoles.includes(Role.ADMIN);

      if (!isOrgAdminEquivalent) {
        throw new ForbiddenException('Insufficient permissions to access this resource');
      }
    }

    return true;
  }
}
