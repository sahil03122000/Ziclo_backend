import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ManagerEmploymentType, WorkShift, Gender } from '@prisma/client';
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
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
  MinLength,
  ValidateNested,
} from 'class-validator';

import { IsAdult } from '../../common/validators/is-adult.validator';
import { ManagerBankDetailsDto } from './manager-bank-details.dto';

const AADHAAR_REGEX = /^\d{12}$/;
const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;

export class CreateManagerDto {
  @ApiProperty({ example: 'Rahul Sharma', description: 'Full name' })
  @IsNotEmpty()
  @IsString()
  @MaxLength(100)
  name: string;

  @ApiProperty({ example: 'rahul@example.com' })
  @IsNotEmpty()
  @IsEmail()
  email: string;

  @ApiProperty({ example: '9876543210', description: '10-digit mobile number' })
  @IsNotEmpty()
  @IsString()
  @Matches(/^[6-9]\d{9}$/, {
    message: 'phone must be a valid 10-digit Indian mobile number',
  })
  phone: string;

  @ApiProperty({ example: 'SecurePass@123', minLength: 8 })
  @IsNotEmpty()
  @IsString()
  @MinLength(8, { message: 'password must be at least 8 characters' })
  password: string;

  @ApiPropertyOptional({
    type: [String],
    format: 'uuid',
    description:
      'Office Location UUIDs to assign to this manager (a manager can be assigned to ' +
      'multiple offices). At least one is required — either this field or the deprecated ' +
      'officeLocationId.',
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
    format: 'uuid',
    description:
      'Organization UUID this manager belongs to. When provided, an active ' +
      'OrganizationUser membership (role MANAGER) is created for the manager.',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  @IsOptional()
  @IsUUID()
  organizationId?: string;

  @ApiPropertyOptional({
    enum: WorkShift,
    example: WorkShift.MORNING,
    description:
      'Legacy shift enum — optional, kept only for backward compatibility. Do not use for new ' +
      'integrations; use shiftId (validated against the real Shift table) instead.',
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
      'Areas to assign to this manager. Each area must belong to at least one of officeLocationIds.',
    example: ['3fa85f64-5717-4562-b3fc-2c963f66afa6'],
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  areaIds?: string[];

  @ApiPropertyOptional({
    example:
      'http://localhost:3000/uploads/images/manager-1719594832-a8c4d1.jpg',
    description:
      'Full URL of the profile image. Upload via POST /api/v1/uploads/image?type=manager first, then paste the returned url here.',
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

  // ─── Salary & Bank Details ────────────────────────────────────────────────────

  @ApiPropertyOptional({
    enum: ManagerEmploymentType,
    example: ManagerEmploymentType.MONTHLY,
    description:
      'MONTHLY or COMMISSION. When MONTHLY, monthlySalary is required.',
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
      'Bank details. Each sub-field is updated independently — only the sub-fields sent are stored.',
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
      'Aadhaar front image URL. Upload via POST /api/v1/uploads/image?type=manager first.',
  })
  @IsOptional()
  @IsUrl(
    { require_protocol: true },
    { message: 'aadhaarFrontImage must be a valid URL' },
  )
  aadhaarFrontImage?: string;

  @ApiPropertyOptional({
    description:
      'Aadhaar back image URL. Upload via POST /api/v1/uploads/image?type=manager first.',
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
