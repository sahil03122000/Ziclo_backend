import { ApiProperty } from '@nestjs/swagger';
import { PaymentType } from '@prisma/client';
import { IsEnum } from 'class-validator';

export class CreatePaymentOrderDto {
  @ApiProperty({ enum: PaymentType, example: PaymentType.ADVANCE })
  @IsEnum(PaymentType)
  paymentType: PaymentType;
}
