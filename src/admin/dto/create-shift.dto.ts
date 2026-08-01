import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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

export class CreateShiftDto {
  @ApiProperty({ example: 'Shift A', description: 'Unique shift name' })
  @IsNotEmpty()
  @IsString()
  @MaxLength(100)
  name: string;

  @ApiProperty({ example: '08:00', description: '24-hour HH:mm' })
  @IsNotEmpty()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, {
    message: 'startTime must be in HH:mm 24-hour format',
  })
  startTime: string;

  @ApiProperty({
    example: '17:00',
    description: '24-hour HH:mm — must be after startTime',
  })
  @IsNotEmpty()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, {
    message: 'endTime must be in HH:mm 24-hour format',
  })
  endTime: string;

  @ApiPropertyOptional({
    example: 15,
    default: 0,
    description: 'Grace period before marked late (minutes)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  graceMinutes?: number = 0;

  @ApiProperty({
    example: 4,
    description:
      'Hours worked to count as a half day — must be less than fullDayHours',
  })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  halfDayHours: number;

  @ApiProperty({
    example: 8,
    description: 'Hours worked to count as a full day',
  })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  fullDayHours: number;

  @ApiPropertyOptional({
    example: 15,
    default: 0,
    description: 'Minutes after startTime + grace before marked late',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  lateAfterMinutes?: number = 0;

  @ApiPropertyOptional({
    example: 15,
    default: 0,
    description: 'Minutes before endTime counted as an early leave',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  earlyLeaveMinutes?: number = 0;

  @ApiPropertyOptional({
    example: 15,
    default: 0,
    description:
      'Alias for earlyLeaveMinutes, accepted for backward compatibility with older UI ' +
      'payloads that use this name. If both are sent, earlyLeaveMinutes wins.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  earlyLeaveBeforeMinutes?: number;

  @ApiProperty({
    type: [Number],
    example: [1, 2, 3, 4, 5, 6],
    description:
      'Working days, 0 = Sunday .. 6 = Saturday. Also accepts day-name strings ' +
      '(e.g. "MONDAY", "MON"), normalized internally before saving.',
  })
  @Transform(({ value }) => normalizeWorkingDays(value))
  @IsArray()
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  workingDays: number[];

  @ApiPropertyOptional({ example: true, default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean = true;
}
