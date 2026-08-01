import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class WebsiteSeoQueryDto {
  @ApiProperty({ example: 'home', description: 'Page slug to fetch SEO metadata for (e.g. "home", "about", "services")' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  page: string;
}
