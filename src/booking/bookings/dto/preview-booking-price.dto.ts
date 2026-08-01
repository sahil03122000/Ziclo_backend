import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsUUID } from 'class-validator';

export class PreviewBookingPriceDto {
  @ApiProperty({ description: 'Package.id' })
  @IsUUID()
  @IsNotEmpty()
  packageId: string;

  @ApiProperty({ description: 'PricingOption.id — must belong to packageId. servicePrice is this option\'s price directly.' })
  @IsUUID()
  @IsNotEmpty()
  pricingOptionId: string;
}
