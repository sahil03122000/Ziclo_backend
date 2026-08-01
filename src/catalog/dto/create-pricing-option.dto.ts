import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsNumber, IsOptional, IsString, Min, MaxLength } from 'class-validator';

export class CreatePricingOptionDto {
  @ApiProperty({ example: '1-3 KW', description: 'e.g. "1 Unit", "1-3 KW" — the option label shown to the customer' })
  @IsString()
  @MaxLength(120)
  label: string;

  @ApiProperty({ example: 499, description: 'Final price charged when this option is selected' })
  @IsNumber()
  @Min(0)
  price: number;

  @ApiPropertyOptional({ example: 1, default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  displayOrder?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
