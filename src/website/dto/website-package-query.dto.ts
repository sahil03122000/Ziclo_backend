import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsUUID } from 'class-validator';

export class WebsitePackageQueryDto {
  @ApiProperty({ description: 'Service.id — must match propertyTypeId\'s service' })
  @IsUUID()
  @IsNotEmpty()
  serviceId: string;

  @ApiProperty({ description: 'PropertyType.id to list active packages for' })
  @IsUUID()
  @IsNotEmpty()
  propertyTypeId: string;
}
