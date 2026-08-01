import { IsNotEmpty, IsUUID } from 'class-validator';

export class ChangePlanDto {
  @IsUUID()
  @IsNotEmpty()
  planId: string;
}
