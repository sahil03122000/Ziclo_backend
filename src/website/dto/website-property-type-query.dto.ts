import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsUUID } from 'class-validator';

export class WebsitePropertyTypeQueryDto {
  @ApiProperty({ description: 'Service.id to list active property types for' })
  @IsUUID()
  @IsNotEmpty()
  serviceId: string;
}
