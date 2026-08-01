import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaymentMethod } from '@prisma/client';

export class CreateSavedPaymentMethodDto {
  @ApiProperty({ enum: PaymentMethod, example: PaymentMethod.CARD })
  @IsEnum(PaymentMethod)
  type: PaymentMethod;

  @ApiProperty({ example: '•••• 4242', description: 'Display label — never raw card/UPI details' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  label: string;

  @ApiPropertyOptional({ description: 'Opaque Razorpay token/reference for this method, if any' })
  @IsOptional()
  @IsString()
  providerRef?: string;
}
