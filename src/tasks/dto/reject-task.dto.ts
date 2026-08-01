import { IsOptional, IsString } from 'class-validator';

export class RejectTaskDto {
  @IsOptional()
  @IsString()
  rejectionNote?: string;
}
