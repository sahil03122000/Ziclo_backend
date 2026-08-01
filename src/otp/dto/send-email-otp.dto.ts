import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty } from 'class-validator';

export class SendEmailOtpDto {
  @ApiProperty({
    example: 'user@example.com',
    description: 'Email address to send the OTP to',
  })
  @IsEmail()
  @IsNotEmpty()
  email: string;
}
