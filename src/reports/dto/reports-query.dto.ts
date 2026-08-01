import { IsDateString, IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';

export enum ExportType {
  TASKS = 'tasks',
  WORKERS = 'workers',
  ATTENDANCE = 'attendance',
}

export class ReportsQueryDto {
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsUUID()
  pincodeId?: string;

  @IsOptional()
  @IsUUID()
  areaId?: string;

  @IsOptional()
  @IsUUID()
  managerId?: string;

  @IsOptional()
  @IsUUID()
  workerId?: string;
}

export class ExportQueryDto extends ReportsQueryDto {
  @IsEnum(ExportType)
  type: ExportType;
}
