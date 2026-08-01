import { LeaveType } from '@prisma/client';
import { IsDateString, IsEnum, IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class ApplyLeaveDto {
  @IsDateString()
  date: string;

  @IsEnum(LeaveType)
  type: LeaveType;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;
}
