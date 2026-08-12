import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsBoolean, IsUUID, ValidateNested } from 'class-validator';

export class AreaServiceEntryDto {
  @ApiProperty({ example: 'uuid', description: 'Service.id' })
  @IsUUID()
  serviceId: string;

  @ApiProperty({ example: true, description: 'Whether this service is available in the area' })
  @IsBoolean()
  isActive: boolean;
}

export class UpdateAreaServicesDto {
  @ApiProperty({ type: [AreaServiceEntryDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => AreaServiceEntryDto)
  services: AreaServiceEntryDto[];
}
