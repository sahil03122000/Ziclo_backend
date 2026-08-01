import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsUUID } from 'class-validator';

export class AssignManagerDto {
  @ApiProperty({ format: 'uuid', description: 'Manager user ID to assign to this booking' })
  @IsUUID('4')
  @IsNotEmpty()
  managerId: string;
}
