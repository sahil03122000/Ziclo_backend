import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { SalaryType, PaymentCycle, Gender } from '@prisma/client';
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
import { WorkerBankDetailsDto } from './worker-bank-details.dto';
import { WorkerCommissionInputDto } from './worker-commission-input.dto';

const AADHAAR_REGEX = /^\d{12}$/;
const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
const IFSC_REGEX = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const ACCOUNT_NUMBER_REGEX = /^\d{9,18}$/;
const UPI_ID_REGEX = /^[\w.-]{2,256}@[a-zA-Z]{2,64}$/;

export class CreateManagerWorkerDto {
  @ApiProperty({ example: 'Ravi Kumar', description: 'Full name' })
  @IsNotEmpty()
  @IsString()
  @MaxLength(100)
  name: string;

  @ApiProperty({ example: 'ravi@example.com' })
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

  @ApiProperty({
    type: [String],
    format: 'uuid',
    description:
      "Office Location UUIDs — must all belong to the logged-in manager's own offices",
    example: ['3fa85f64-5717-4562-b3fc-2c963f66afa6'],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  officeLocationIds: string[];

  @ApiPropertyOptional({
    deprecated: true,
    type: [String],
    format: 'uuid',
    description:
      'Deprecated — use areaIds instead. Kept for backward compatibility. Each must belong to ' +
      'at least one of officeLocationIds. Either this field or areaIds is required.',
    example: ['3fa85f64-5717-4562-b3fc-2c963f66afa6'],
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  assignedAreaIds?: string[];

  @ApiPropertyOptional({
    type: [String],
    format: 'uuid',
    description:
      'Area UUIDs — each must belong to at least one of officeLocationIds. Note: WorkerProfile ' +
      'only stores a single area (no multi-area join table exists for workers), so only the ' +
      'first id is actually persisted; the rest are validated but not stored. Either this field ' +
      'or the deprecated assignedAreaIds is required.',
    example: ['3fa85f64-5717-4562-b3fc-2c963f66afa6'],
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  areaIds?: string[];

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Real Shift record UUID (from GET managers/shifts) — must exist and be active. Optional.',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  @IsOptional()
  @IsUUID()
  shiftId?: string;

  @ApiPropertyOptional({
    example:
      'http://localhost:3000/uploads/images/worker-1719594832-a8c4d1.jpg',
    description:
      'Full URL of the profile image. Upload via POST /api/v1/uploads/image?type=worker first.',
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
    example: '1995-06-15',
    description: 'ISO date string. Must not be in the future; worker must be at least 18 years old.',
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
      'Aadhaar front image URL. Upload via POST /api/v1/uploads/image?type=worker first.',
  })
  @IsOptional()
  @IsUrl(
    { require_protocol: true },
    { message: 'aadhaarFrontImage must be a valid URL' },
  )
  aadhaarFrontImage?: string;

  @ApiPropertyOptional({
    description:
      'Aadhaar back image URL. Upload via POST /api/v1/uploads/image?type=worker first.',
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
      'PAN card image URL. Upload via POST /api/v1/uploads/image?type=worker first.',
  })
  @IsOptional()
  @IsUrl(
    { require_protocol: true },
    { message: 'panImage must be a valid URL' },
  )
  panImage?: string;

  // ─── Employment ─────────────────────────────────────────────────────────────

  @ApiPropertyOptional({
    enum: SalaryType,
    default: SalaryType.SALARY,
    description:
      'SALARY or COMMISSION. Defaults to SALARY when omitted (backward compatible).',
  })
  @IsOptional()
  @IsEnum(SalaryType)
  employmentType?: SalaryType = SalaryType.SALARY;

  @ApiPropertyOptional({
    example: 25000,
    description: 'Required when employmentType is SALARY',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  monthlySalary?: number;

  @ApiPropertyOptional({ enum: PaymentCycle, example: PaymentCycle.MONTHLY })
  @IsOptional()
  @IsEnum(PaymentCycle)
  paymentCycle?: PaymentCycle;

  @ApiPropertyOptional({
    deprecated: true,
    example: '2026-07-01',
    description: 'Deprecated — use salaryStartDate instead. ISO date string.',
  })
  @IsOptional()
  @IsDateString()
  joiningDate?: string;

  @ApiPropertyOptional({
    example: '2026-07-01',
    description:
      'ISO date string. Either this or the deprecated joiningDate may be sent.',
  })
  @IsOptional()
  @IsDateString()
  salaryStartDate?: string;

  @ApiPropertyOptional({
    deprecated: true,
    type: [WorkerCommissionInputDto],
    description:
      'Deprecated — use commissionRules instead. Per-service commission rates. Required (at ' +
      'least one, via either field) when employmentType is COMMISSION.',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WorkerCommissionInputDto)
  commissions?: WorkerCommissionInputDto[];

  @ApiPropertyOptional({
    type: [WorkerCommissionInputDto],
    description:
      'Per-service commission rates. Required (at least one, via either this or the deprecated ' +
      'commissions field) when employmentType is COMMISSION.',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WorkerCommissionInputDto)
  commissionRules?: WorkerCommissionInputDto[];

  // ─── Bank Details & Remarks ───────────────────────────────────────────────────
  // Flat fields below are deprecated in favor of the nested bankDetails/remarks fields, kept
  // for backward compatibility. If both a flat field and bankDetails are sent, bankDetails wins.

  @ApiPropertyOptional({ deprecated: true, example: 'Ravi Kumar' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  accountHolderName?: string;

  @ApiPropertyOptional({ deprecated: true, example: 'State Bank of India' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  bankName?: string;

  @ApiPropertyOptional({
    deprecated: true,
    example: '123456789012',
    description: '9-18 digit bank account number',
  })
  @IsOptional()
  @Matches(ACCOUNT_NUMBER_REGEX, {
    message: 'accountNumber must be 9 to 18 digits',
  })
  accountNumber?: string;

  @ApiPropertyOptional({
    deprecated: true,
    example: 'SBIN0001234',
    description: '11-character IFSC code',
  })
  @IsOptional()
  @Matches(IFSC_REGEX, {
    message: 'ifscCode must be a valid IFSC code (e.g. SBIN0001234)',
  })
  ifscCode?: string;

  @ApiPropertyOptional({ deprecated: true, example: 'MG Road Branch' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  branchName?: string;

  @ApiPropertyOptional({ deprecated: true, example: 'ravi@okhdfcbank' })
  @IsOptional()
  @Matches(UPI_ID_REGEX, {
    message: 'upiId must be a valid UPI ID (e.g. name@bank)',
  })
  upiId?: string;

  @ApiPropertyOptional({
    type: WorkerBankDetailsDto,
    description:
      'Bank details. Preferred over the deprecated flat accountHolderName/bankName/' +
      'accountNumber/ifscCode/branchName/upiId fields.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => WorkerBankDetailsDto)
  bankDetails?: WorkerBankDetailsDto;

  @ApiPropertyOptional({
    deprecated: true,
    example: 'Prefers morning shifts',
    description:
      'Deprecated — use remarks instead. Free-text note, max 1000 characters.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  remark?: string;

  @ApiPropertyOptional({
    example: 'Prefers morning shifts',
    description: 'Free-text note, max 1000 characters',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  remarks?: string;
}
