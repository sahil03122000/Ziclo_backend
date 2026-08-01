import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class MobileLoginDto {
  @ApiProperty({
    description:
      'Firebase ID Token obtained after the user completes phone OTP verification on the device. ' +
      'Issued by Firebase Authentication — the backend does NOT generate or send OTPs.',
    example: 'eyJhbGciOiJSUzI1NiIsImtpZCI6Ii4uLiJ9...',
  })
  @IsString()
  @IsNotEmpty()
  firebaseIdToken: string;
}
