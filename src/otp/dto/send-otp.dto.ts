import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class SendOtpDto {
  @ApiProperty({
    example: '+919876543210',
    description: 'Mobile number (e.g. +919876543210) or email address',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(254)
  identifier: string;
}
