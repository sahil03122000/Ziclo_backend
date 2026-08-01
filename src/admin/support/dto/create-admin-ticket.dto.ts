import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IssueType, TicketPriority, TicketStatus } from '@prisma/client';
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class CreateAdminTicketDto {
  @ApiProperty({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', description: 'Customer UUID' })
  @IsNotEmpty()
  @IsUUID()
  customerId: string;

  @ApiPropertyOptional({
    example: 'b2c3d4e5-f6a7-8901-bcde-f12345678901',
    description: 'Booking UUID — required when issueType is BOOKING',
    nullable: true,
  })
  @IsOptional()
  @IsUUID()
  bookingId?: string | null;

  @ApiProperty({ enum: IssueType, example: IssueType.BOOKING, description: 'BOOKING or OTHER' })
  @IsNotEmpty()
  @IsEnum(IssueType)
  issueType: IssueType;

  @ApiPropertyOptional({
    example: 'Wallet refund issue',
    description: 'Required when issueType is OTHER',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  customIssue?: string | null;

  @ApiProperty({ enum: TicketPriority, example: TicketPriority.HIGH })
  @IsNotEmpty()
  @IsEnum(TicketPriority)
  priority: TicketPriority;

  @ApiProperty({ enum: TicketStatus, example: TicketStatus.OPEN })
  @IsNotEmpty()
  @IsEnum(TicketStatus)
  status: TicketStatus;

  @ApiProperty({ example: 'Payment Issue', maxLength: 200 })
  @IsNotEmpty()
  @IsString()
  @MaxLength(200)
  subject: string;

  @ApiProperty({ example: 'Customer payment not reflected.', maxLength: 5000 })
  @IsNotEmpty()
  @IsString()
  @MaxLength(5000)
  description: string;
}
