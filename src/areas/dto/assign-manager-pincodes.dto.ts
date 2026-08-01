import { ApiProperty } from '@nestjs/swagger';
import { ArrayMinSize, IsArray, IsUUID } from 'class-validator';

export class AssignManagerPincodesDto {
  @ApiProperty({
    type: [String],
    format: 'uuid',
    description: 'Replaces all existing pincode assignments for this manager',
    example: ['3fa85f64-5717-4562-b3fc-2c963f66afa6'],
  })
  @IsArray()
  @IsUUID('4', { each: true })
  @ArrayMinSize(1)
  pincodeIds: string[];
}
