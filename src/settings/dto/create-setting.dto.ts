import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateSettingDto {
  /** Unique key, e.g. attendance_radius, company_name */
  @IsNotEmpty()
  @IsString()
  @MaxLength(100)
  key: string;

  @IsNotEmpty()
  @IsString()
  @MaxLength(1000)
  value: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}
