import { IsEnum, IsOptional, IsUUID } from 'class-validator';

export enum AnalyticsPeriod {
  WEEKLY = 'weekly',
  MONTHLY = 'monthly',
  YEARLY = 'yearly',
}

export class AnalyticsQueryDto {
  @IsOptional()
  @IsEnum(AnalyticsPeriod)
  period?: AnalyticsPeriod = AnalyticsPeriod.MONTHLY;

  @IsOptional()
  @IsUUID()
  pincodeId?: string;

  @IsOptional()
  @IsUUID()
  areaId?: string;
}
