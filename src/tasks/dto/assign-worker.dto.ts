import { IsNotEmpty, IsUUID } from 'class-validator';

export class AssignWorkerDto {
  @IsNotEmpty()
  @IsUUID()
  workerId: string;
}
