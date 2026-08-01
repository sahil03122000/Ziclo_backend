import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';

import { AuthUser } from '../common/types/auth-user.type';

/**
 * Hard-gates an endpoint to SUPER_ADMIN only.
 * Apply after JwtAuthGuard: @UseGuards(JwtAuthGuard, SuperAdminGuard)
 */
@Injectable()
export class SuperAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const user = context.switchToHttp().getRequest<{ user?: AuthUser }>().user;
    if (!user || user.role !== Role.SUPER_ADMIN) {
      throw new ForbiddenException('Super-admin access required');
    }
    return true;
  }
}
