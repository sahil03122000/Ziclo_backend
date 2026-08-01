import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';

import { EmailModule } from '../email/email.module';
import { OtpController } from './otp.controller';
import { OtpService } from './otp.service';
import { SmsService } from './sms.service';

@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.getOrThrow<string>('JWT_SECRET'),
        signOptions: {
          expiresIn: configService.get('JWT_EXPIRES_IN') ?? '15m',
        },
      }),
    }),
    EmailModule,
  ],
  controllers: [OtpController],
  providers: [OtpService, SmsService],
})
export class OtpModule {}
