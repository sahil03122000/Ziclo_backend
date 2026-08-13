import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ManagerEmploymentType, WorkShift, Gender } from '@prisma/client';
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

import { IsAdult } from '../../common/validators/is-adult.validator';
import { ManagerBankDetailsDto } from './manager-bank-details.dto';

const AADHAAR_REGEX = /^\d{12}$/;
const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;

export class UpdateManagerDto {
  @ApiPropertyOptional({ example: 'Rahul Sharma', description: 'Full name' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ example: 'rahul@example.com' })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({
    example: '9876543210',
    description: '10-digit Indian mobile number',
  })
  @IsOptional()
  @IsString()
  @Matches(/^[6-9]\d{9}$/, {
    message: 'phone must be a valid 10-digit Indian mobile number',
  })
  phone?: string;

  @ApiPropertyOptional({
    type: [String],
    format: 'uuid',
    description:
      'Replaces all office locations currently assigned to this manager (a manager can be ' +
      'assigned to multiple offices). At least one is required when provided — either this ' +
      'field or the deprecated officeLocationId. Omit entirely to leave office assignments unchanged.',
    example: ['3fa85f64-5717-4562-b3fc-2c963f66afa6'],
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  officeLocationIds?: string[];

  @ApiPropertyOptional({
    deprecated: true,
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
    description:
      'Deprecated — use officeLocationIds instead. Kept for backward compatibility; ' +
      'converted internally to officeLocationIds: [officeLocationId].',
  })
  @IsOptional()
  @IsUUID()
  officeLocationId?: string;

  @ApiPropertyOptional({
    enum: WorkShift,
    example: WorkShift.MORNING,
    description:
      'Legacy shift enum — kept for backward compatibility. Prefer shiftId.',
  })
  @IsOptional()
  @IsEnum(WorkShift)
  shift?: WorkShift;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Real Shift record UUID (from GET /admin/shifts) — must exist and be active.',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  @IsOptional()
  @IsUUID()
  shiftId?: string;

  @ApiPropertyOptional({
    type: [String],
    format: 'uuid',
    description:
      'Replaces all current area assignments for this manager. Each area must belong to ' +
      "at least one of the manager's office locations (either the newly supplied " +
      'officeLocationIds, or the existing ones if omitted). Pass an empty array to remove all areas.',
    example: ['3fa85f64-5717-4562-b3fc-2c963f66afa6'],
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  areaIds?: string[];

  @ApiPropertyOptional({
    example: 'http://localhost:3000/uploads/images/manager-abc.jpg',
    description: 'Full URL of the profile image',
  })
  @IsOptional()
  @IsUrl(
    { require_protocol: true },
    { message: 'profileImage must be a valid URL' },
  )
  profileImage?: string;

  @ApiPropertyOptional({ enum: Gender, example: Gender.MALE })
  @IsOptional()
  @IsEnum(Gender)
  gender?: Gender;

  @ApiPropertyOptional({
    example: '1985-04-20',
    description: 'ISO date string. Must not be in the future; manager must be at least 18 years old.',
  })
  @IsOptional()
  @IsDateString()
  @IsAdult()
  dateOfBirth?: string;

  @ApiPropertyOptional({
    example: '221B Baker Street, Bengaluru, Karnataka',
    description: 'Free-text address, max 500 characters',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string;

  @ApiPropertyOptional({
    example: true,
    description: 'Set to true to activate, false to deactivate',
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  // ─── Salary & Bank Details ────────────────────────────────────────────────────

  @ApiPropertyOptional({
    enum: ManagerEmploymentType,
    example: ManagerEmploymentType.MONTHLY,
    description:
      'MONTHLY or COMMISSION. When sent as MONTHLY, monthlySalary is required in the same request.',
  })
  @IsOptional()
  @IsEnum(ManagerEmploymentType)
  employmentType?: ManagerEmploymentType;

  @ApiPropertyOptional({
    example: 45000,
    description: 'Required and must be > 0 when employmentType is MONTHLY',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.01, { message: 'monthlySalary must be greater than 0' })
  monthlySalary?: number;

  @ApiPropertyOptional({
    type: ManagerBankDetailsDto,
    description:
      'Bank details. Each sub-field is updated independently — only the sub-fields sent are ' +
      "changed; the rest of the manager's stored bank details are left untouched.",
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => ManagerBankDetailsDto)
  bankDetails?: ManagerBankDetailsDto;

  @ApiPropertyOptional({
    example: 'Senior manager, handles escalations',
    description: 'Free-text note, max 1000 characters',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  remarks?: string;

  // ─── KYC ────────────────────────────────────────────────────────────────────

  @ApiPropertyOptional({
    example: '123456789012',
    description: '12-digit Aadhaar number',
  })
  @IsOptional()
  @Matches(AADHAAR_REGEX, {
    message: 'aadhaarNumber must be exactly 12 digits',
  })
  aadhaarNumber?: string;

  @ApiPropertyOptional({
    description:
      'Aadhaar front image URL. Upload via POST /api/v1/uploads/image?type=manager first. ' +
      'If omitted, the existing aadhaarFrontImage is kept unchanged.',
  })
  @IsOptional()
  @IsUrl(
    { require_protocol: true },
    { message: 'aadhaarFrontImage must be a valid URL' },
  )
  aadhaarFrontImage?: string;

  @ApiPropertyOptional({
    description:
      'Aadhaar back image URL. Upload via POST /api/v1/uploads/image?type=manager first. ' +
      'If omitted, the existing aadhaarBackImage is kept unchanged.',
  })
  @IsOptional()
  @IsUrl(
    { require_protocol: true },
    { message: 'aadhaarBackImage must be a valid URL' },
  )
  aadhaarBackImage?: string;

  @ApiPropertyOptional({
    example: 'ABCDE1234F',
    description: 'Indian PAN number',
  })
  @IsOptional()
  @Matches(PAN_REGEX, {
    message: 'panNumber must be a valid PAN (e.g. ABCDE1234F)',
  })
  panNumber?: string;

  @ApiPropertyOptional({
    description:
      'PAN card image URL. Upload via POST /api/v1/uploads/image?type=manager first.',
  })
  @IsOptional()
  @IsUrl(
    { require_protocol: true },
    { message: 'panImage must be a valid URL' },
  )
  panImage?: string;
}
