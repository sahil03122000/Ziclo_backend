import { IsNotEmpty, IsUUID } from 'class-validator';

export class StartSubscriptionDto {
  @IsUUID()
  @IsNotEmpty()
  planId: string;
}
