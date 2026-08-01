import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsUUID } from 'class-validator';

export class AssignTicketDto {
  @ApiProperty({ format: 'uuid', description: 'User ID to assign the ticket to' })
  @IsUUID('4')
  @IsNotEmpty()
  assignedToId: string;
}
