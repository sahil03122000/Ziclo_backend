import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { normalizeWorkingDays } from './shift-working-days.util';

export class UpdateShiftDto {
  @ApiPropertyOptional({ example: 'Shift A' })
  @IsOptional()
  @IsNotEmpty()
  @IsString()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ example: '08:00', description: '24-hour HH:mm' })
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, {
    message: 'startTime must be in HH:mm 24-hour format',
  })
  startTime?: string;

  @ApiPropertyOptional({ example: '17:00', description: '24-hour HH:mm' })
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, {
    message: 'endTime must be in HH:mm 24-hour format',
  })
  endTime?: string;

  @ApiPropertyOptional({ example: 15 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  graceMinutes?: number;

  @ApiPropertyOptional({ example: 4 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  halfDayHours?: number;

  @ApiPropertyOptional({ example: 8 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  fullDayHours?: number;

  @ApiPropertyOptional({ example: 15 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  lateAfterMinutes?: number;

  @ApiPropertyOptional({ example: 15 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  earlyLeaveMinutes?: number;

  @ApiPropertyOptional({
    example: 15,
    description:
      'Alias for earlyLeaveMinutes, accepted for backward compatibility with older UI ' +
      'payloads that use this name. If both are sent, earlyLeaveMinutes wins.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  earlyLeaveBeforeMinutes?: number;

  @ApiPropertyOptional({
    type: [Number],
    example: [1, 2, 3, 4, 5, 6],
    description:
      'Working days, 0 = Sunday .. 6 = Saturday. Also accepts day-name strings ' +
      '(e.g. "MONDAY", "MON"), normalized internally before saving.',
  })
  @IsOptional()
  @Transform(({ value }) => normalizeWorkingDays(value))
  @IsArray()
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  workingDays?: number[];

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
