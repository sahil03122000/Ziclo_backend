import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Length, Matches, MaxLength } from 'class-validator';

export class CreatePincodeDto {
  @ApiProperty({ example: '400001', description: '6-digit Indian postal code' })
  @IsString()
  @IsNotEmpty()
  @Length(6, 6, { message: 'pincode must be exactly 6 digits' })
  @Matches(/^\d{6}$/, { message: 'pincode must be numeric' })
  pincode: string;

  @ApiProperty({ example: 'Mumbai' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  city: string;

  @ApiProperty({ example: 'Maharashtra' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  state: string;
}
