import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

import { CreateServiceDto } from './create-service.dto';

export class UpdateServiceDto extends PartialType(CreateServiceDto) {
  // Overridden (not inherited as-is): CreateServiceDto requires these via @IsNotEmpty(), which
  // would reject a save where the image simply wasn't changed and the field comes back blank.
  // Blank/omitted values are ignored by CatalogServicesService.update() — the existing image is
  // preserved, never overwritten with null/empty.
  @ApiPropertyOptional({ example: 'https://cdn.example.com/services/solar-thumb.jpg' })
  @IsOptional()
  @IsString()
  thumbnailImage?: string;

  @ApiPropertyOptional({ example: 'https://cdn.example.com/services/solar-banner.jpg' })
  @IsOptional()
  @IsString()
  bannerImage?: string;
}
