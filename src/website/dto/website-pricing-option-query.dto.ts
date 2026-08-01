import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsUUID } from 'class-validator';

export class WebsitePricingOptionQueryDto {
  @ApiProperty({ description: 'Package.id to list active pricing options for' })
  @IsUUID()
  @IsNotEmpty()
  packageId: string;
}
