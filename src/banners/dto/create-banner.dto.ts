import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BannerRedirectType } from '@prisma/client';
import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, IsUrl, Max, Min } from 'class-validator';

export class CreateBannerDto {
  @ApiProperty({ example: 'Summer Sale', description: 'Banner title' })
  @IsString()
  title: string;

  @ApiPropertyOptional({ example: 'Up to 50% off all services', description: 'Optional subtitle' })
  @IsOptional()
  @IsString()
  subtitle?: string;

  @ApiProperty({ example: 'https://example.com/uploads/images/banner.jpg', description: 'Full URL of the uploaded banner image' })
  @IsString()
  @IsUrl({ require_tld: false })
  imageUrl: string;

  @ApiPropertyOptional({ enum: BannerRedirectType, default: BannerRedirectType.NONE, description: 'What the banner links to' })
  @IsOptional()
  @IsEnum(BannerRedirectType)
  redirectType?: BannerRedirectType = BannerRedirectType.NONE;

  @ApiPropertyOptional({ example: 'service-uuid or https://example.com', description: 'ID or URL depending on redirectType' })
  @IsOptional()
  @IsString()
  redirectValue?: string;

  @ApiProperty({ example: 1, description: 'Unique display order (ascending = shown first)' })
  @IsInt()
  @Min(1)
  @Max(100)
  displayOrder: number;

  @ApiPropertyOptional({ example: true, default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean = true;
}
