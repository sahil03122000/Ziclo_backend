import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Role, WorkShift } from '@prisma/client';
import { IsEnum, IsIn, IsNotEmpty, IsUUID, IsUrl, ValidateIf } from 'class-validator';

// SUPER_ADMIN → seed-only, never assignable via any API.
// ORGANIZATION_ADMIN → internal platform alias, not directly assignable.
export const API_ASSIGNABLE_ROLES = [Role.ADMIN, Role.MANAGER, Role.WORKER, Role.USER] as const;
export type AssignableRole = (typeof API_ASSIGNABLE_ROLES)[number];

export class UpdateUserRoleDto {
  @ApiProperty({
    enum: API_ASSIGNABLE_ROLES,
    description: 'Role to assign. SUPER_ADMIN is seed-only and cannot be assigned via API.',
  })
  @IsIn(API_ASSIGNABLE_ROLES, {
    message: `role must be one of: ${API_ASSIGNABLE_ROLES.join(', ')}`,
  })
  @IsNotEmpty()
  role: AssignableRole;

  // ── Required for MANAGER and WORKER ─────────────────────────────────────────

  @ApiProperty({
    example: 'https://cdn.example.com/avatars/user.jpg',
    description: 'Profile image URL. Required when assigning MANAGER or WORKER role.',
    required: false,
  })
  @ValidateIf((o) => o.role === Role.MANAGER || o.role === Role.WORKER)
  @IsUrl({ require_protocol: true }, { message: 'profileImage must be a valid URL with protocol' })
  @IsNotEmpty({ message: 'profileImage is required when assigning MANAGER or WORKER role' })
  profileImage?: string;

  // ── Required for MANAGER only ────────────────────────────────────────────────

  @ApiPropertyOptional({
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
    description: 'Office location ID. Required when assigning MANAGER role.',
  })
  @ValidateIf((o) => o.role === Role.MANAGER)
  @IsUUID('4', { message: 'officeLocationId must be a valid UUID' })
  @IsNotEmpty({ message: 'officeLocationId is required when assigning MANAGER role' })
  officeLocationId?: string;

  @ApiPropertyOptional({
    enum: WorkShift,
    description: 'Work shift assignment. Required when assigning MANAGER role.',
  })
  @ValidateIf((o) => o.role === Role.MANAGER)
  @IsEnum(WorkShift, { message: `shift must be one of: ${Object.values(WorkShift).join(', ')}` })
  @IsNotEmpty({ message: 'shift is required when assigning MANAGER role' })
  shift?: WorkShift;

  // ── Required for WORKER only ─────────────────────────────────────────────────

  @ApiPropertyOptional({
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
    description: 'Area ID. Required when assigning WORKER role.',
  })
  @ValidateIf((o) => o.role === Role.WORKER)
  @IsUUID('4', { message: 'areaId must be a valid UUID' })
  @IsNotEmpty({ message: 'areaId is required when assigning WORKER role' })
  areaId?: string;
}
