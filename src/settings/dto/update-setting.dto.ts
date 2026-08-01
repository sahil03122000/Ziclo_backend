import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateSettingDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  value?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}
