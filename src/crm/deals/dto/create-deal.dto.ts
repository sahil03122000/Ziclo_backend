import { Type } from 'class-transformer';
import { IsDate, IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';
import { DealStage } from '@prisma/client';

export class CreateDealDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title: string;

  @IsNumber()
  @Min(0)
  value: number;

  @IsUUID()
  @IsNotEmpty()
  customerId: string;

  @IsOptional()
  @IsEnum(DealStage)
  stage?: DealStage;

  @IsOptional()
  @IsUUID()
  contactId?: string;

  @IsOptional()
  @IsUUID()
  leadId?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsUUID()
  assignedToId?: string;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  closedAt?: Date;
}
