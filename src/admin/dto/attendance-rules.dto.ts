import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';

export const VALID_WEEKEND_DAYS = [
  'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY',
] as const;

export type WeekDay = typeof VALID_WEEKEND_DAYS[number];

const TIME_REGEX = /^\d{2}:\d{2}$/;

export class UpdateAttendanceRulesDto {
  @ApiPropertyOptional({ example: 200, description: 'Check-in geofence radius in metres (50–1000)' })
  @IsOptional()
  @IsInt()
  @Min(50)
  @Max(1000)
  officeRadius?: number;

  @ApiPropertyOptional({ example: '09:30', description: 'Time after which check-in is considered late (HH:MM)' })
  @IsOptional()
  @IsString()
  @Matches(TIME_REGEX, { message: 'lateAfter must be a valid time in HH:MM format' })
  lateAfter?: string;

  @ApiPropertyOptional({ example: '13:00', description: 'Time after which check-in counts as half day (HH:MM)' })
  @IsOptional()
  @IsString()
  @Matches(TIME_REGEX, { message: 'halfDayAfter must be a valid time in HH:MM format' })
  halfDayAfter?: string;

  @ApiPropertyOptional({ example: '17:00', description: 'Expected check-out time (HH:MM)' })
  @IsOptional()
  @IsString()
  @Matches(TIME_REGEX, { message: 'checkOutBefore must be a valid time in HH:MM format' })
  checkOutBefore?: string;

  @ApiPropertyOptional({ example: 8, description: 'Minimum working hours required (1–24)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(24)
  minimumWorkingHours?: number;

  @ApiPropertyOptional({ example: '15:00', description: 'Time after which absent is auto-marked (HH:MM)' })
  @IsOptional()
  @IsString()
  @Matches(TIME_REGEX, { message: 'autoAbsentTime must be a valid time in HH:MM format' })
  autoAbsentTime?: string;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  allowOutsideOffice?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  requireSelfie?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  requireLiveLocation?: boolean;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  allowMultipleCheckIn?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  enableAttendance?: boolean;

  @ApiPropertyOptional({
    example: ['SUNDAY'],
    description: 'Days treated as weekends',
    enum: VALID_WEEKEND_DAYS,
    isArray: true,
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(VALID_WEEKEND_DAYS, { each: true })
  weekends?: WeekDay[];

  @ApiPropertyOptional({
    example: false,
    description:
      'When true, a manager-approved missed checkout request escalates to ADMIN for final ' +
      'approval instead of finalizing at manager level.',
  })
  @IsOptional()
  @IsBoolean()
  requireAdminAttendanceApproval?: boolean;
}

export interface AttendanceRulesData {
  officeRadius: number;
  lateAfter: string;
  halfDayAfter: string;
  checkOutBefore: string;
  minimumWorkingHours: number;
  autoAbsentTime: string;
  allowOutsideOffice: boolean;
  requireSelfie: boolean;
  requireLiveLocation: boolean;
  allowMultipleCheckIn: boolean;
  enableAttendance: boolean;
  weekends: string[];
  requireAdminAttendanceApproval: boolean;
}

export const ATTENDANCE_RULES_DEFAULTS: AttendanceRulesData = {
  officeRadius: 200,
  lateAfter: '09:30',
  halfDayAfter: '13:00',
  checkOutBefore: '17:00',
  minimumWorkingHours: 8,
  autoAbsentTime: '15:00',
  allowOutsideOffice: false,
  requireSelfie: true,
  requireLiveLocation: true,
  allowMultipleCheckIn: false,
  enableAttendance: true,
  weekends: ['SUNDAY'],
  requireAdminAttendanceApproval: false,
};

export class AttendanceRulesResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ type: Object, example: ATTENDANCE_RULES_DEFAULTS })
  data: AttendanceRulesData;
}
