import { LeaveRequestStatus } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';

// Own-history filter for Worker/Manager "my leaves" — deliberately not QueryLeaveRequestsDto
// (that one also carries page/limit for the paginated team/admin lists; "my leaves" has always
// returned a flat unpaginated array and this keeps that unchanged).
export class LeaveStatusQueryDto {
  @IsOptional()
  @IsEnum(LeaveRequestStatus)
  status?: LeaveRequestStatus;
}
