import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class FirebaseLoginDto {
  @ApiProperty({
    description:
      'Firebase ID Token obtained after the user completes phone OTP verification on the client. ' +
      'Issued by Firebase Authentication — not to be confused with our own JWT.',
    example: 'eyJhbGciOiJSUzI1NiIsImtpZCI6Ii4uLiJ9...',
  })
  @IsString()
  @IsNotEmpty()
  idToken: string;
}
