import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentType } from '@prisma/client';
import { IsEnum, IsNotEmpty, IsOptional, IsUUID } from 'class-validator';

export class CreateRazorpayOrderDto {
  @IsUUID()
  @IsNotEmpty()
  invoiceId: string;

  @ApiPropertyOptional({ enum: PaymentType, default: PaymentType.FULL, description: 'Defaults to FULL when not provided (pays the full outstanding balance).' })
  @IsOptional()
  @IsEnum(PaymentType)
  paymentType?: PaymentType;
}
