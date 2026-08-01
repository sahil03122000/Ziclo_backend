import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateBookingDto {
  @ApiProperty({ description: 'Service.id' })
  @IsUUID()
  @IsNotEmpty()
  serviceId: string;

  @ApiProperty({ description: 'PropertyType.id — must belong to serviceId' })
  @IsUUID()
  @IsNotEmpty()
  propertyTypeId: string;

  @ApiProperty({ description: 'Package.id — must belong to propertyTypeId' })
  @IsUUID()
  @IsNotEmpty()
  packageId: string;

  @ApiProperty({
    description:
      'PricingOption.id — the priced variant of the package (e.g. "2 Units", "4-6 KW"). Must ' +
      'belong to packageId. totalAmount is set directly from this option\'s price.',
  })
  @IsUUID()
  @IsNotEmpty()
  pricingOptionId: string;

  @ApiProperty({ example: '2026-07-10', description: 'Date the service is scheduled for (ISO 8601)' })
  @IsDateString()
  bookingDate: string;

  @ApiProperty({ description: 'TimeSlot.id — must belong to serviceId' })
  @IsUUID()
  @IsNotEmpty()
  timeSlotId: string;

  @ApiProperty({ description: "Address.id from the customer's saved addresses" })
  @IsUUID()
  @IsNotEmpty()
  addressId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}
