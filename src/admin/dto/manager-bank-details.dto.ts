import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

const IFSC_REGEX = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const ACCOUNT_NUMBER_REGEX = /^\d{9,18}$/;
const UPI_ID_REGEX = /^[\w.-]{2,256}@[a-zA-Z]{2,64}$/;

// Nested under CreateManagerDto/UpdateManagerDto's `bankDetails` field. All sub-fields are
// optional and updated independently — sending a partial bankDetails object only overwrites
// the sub-fields present in it, leaving the rest of the manager's stored bank details as-is.
export class ManagerBankDetailsDto {
  @ApiPropertyOptional({ example: 'Rahul Sharma' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  accountHolderName?: string;

  @ApiPropertyOptional({ example: 'State Bank of India' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  bankName?: string;

  @ApiPropertyOptional({ example: 'MG Road Branch' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  branchName?: string;

  @ApiPropertyOptional({
    example: '123456789012',
    description: '9-18 digit bank account number',
  })
  @IsOptional()
  @Matches(ACCOUNT_NUMBER_REGEX, {
    message: 'bankDetails.accountNumber must be 9 to 18 digits',
  })
  accountNumber?: string;

  @ApiPropertyOptional({
    example: 'SBIN0001234',
    description: '11-character IFSC code',
  })
  @IsOptional()
  @Matches(IFSC_REGEX, {
    message:
      'bankDetails.ifscCode must be a valid IFSC code (e.g. SBIN0001234)',
  })
  ifscCode?: string;

  @ApiPropertyOptional({ example: 'rahul@okhdfcbank' })
  @IsOptional()
  @Matches(UPI_ID_REGEX, {
    message: 'bankDetails.upiId must be a valid UPI ID (e.g. name@bank)',
  })
  upiId?: string;
}
