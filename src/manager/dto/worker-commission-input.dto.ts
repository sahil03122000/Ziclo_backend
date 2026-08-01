import { ApiProperty } from '@nestjs/swagger';
import { CommissionType } from '@prisma/client';
import { IsEnum, IsNotEmpty, IsNumber, IsUUID, Min } from 'class-validator';

export class WorkerCommissionInputDto {
  @ApiProperty({
    format: 'uuid',
    description: 'Service this commission rate applies to',
  })
  @IsUUID()
  serviceId: string;

  @ApiProperty({ enum: CommissionType, example: CommissionType.PERCENT })
  @IsNotEmpty()
  @IsEnum(CommissionType)
  commissionType: CommissionType;

  @ApiProperty({
    example: 10,
    description:
      'Commission value — a percentage (0-100) when commissionType is PERCENT, or a flat amount when FIXED',
  })
  @IsNumber()
  @Min(0)
  commissionValue: number;
}
