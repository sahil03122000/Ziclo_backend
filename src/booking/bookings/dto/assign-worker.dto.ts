import { IsNotEmpty, IsUUID } from 'class-validator';

export class AssignWorkerDto {
  @IsUUID()
  @IsNotEmpty()
  workerId: string;
}
