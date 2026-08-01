import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { SendEmailOtpDto } from './dto/send-email-otp.dto';
import { SendOtpDto } from './dto/send-otp.dto';
import { VerifyEmailOtpDto } from './dto/verify-email-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { OtpService } from './otp.service';

@ApiTags('Authentication')
@Controller('auth')
// Stricter rate limit for OTP: 5 requests per minute per IP
@Throttle({ default: { limit: 5, ttl: 60000 } })
export class OtpController {
  constructor(private readonly otpService: OtpService) {}

  /**
   * @deprecated Use POST /auth/firebase-login instead.
   * Phone OTP via SMS is superseded by Firebase Phone Authentication.
   * This endpoint will be removed in a future release.
   */
  @Post('send-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '[DEPRECATED] Send OTP to a mobile number or email',
    description:
      '**Deprecated** — Phone OTP via SMS has been superseded by Firebase Phone Authentication. ' +
      'Use `POST /auth/firebase-login` for phone-based login. ' +
      'Email OTP still uses `POST /auth/send-email-otp`. ' +
      'This endpoint will be removed in a future release. ' +
      'Generates a 6-digit OTP valid for 5 minutes. ' +
      'A new OTP cannot be requested for the same identifier within 2 minutes.',
    deprecated: true,
  })
  @ApiResponse({ status: 200, description: 'OTP dispatched successfully' })
  @ApiBadRequestResponse({ description: 'Resend cooldown active (2 min)' })
  sendOtp(@Body() dto: SendOtpDto) {
    return this.otpService.sendOtp(dto);
  }

  /**
   * @deprecated Use POST /auth/firebase-login instead.
   * Phone OTP via SMS is superseded by Firebase Phone Authentication.
   * This endpoint will be removed in a future release.
   */
  @Post('verify-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '[DEPRECATED] Verify OTP and receive JWT access + refresh tokens',
    description:
      '**Deprecated** — Phone OTP via SMS has been superseded by Firebase Phone Authentication. ' +
      'Use `POST /auth/firebase-login` for phone-based login. ' +
      'This endpoint will be removed in a future release. ' +
      'Validates the OTP and returns tokens identical to the email+password login response. ' +
      'Maximum 5 failed attempts before the OTP is locked.',
    deprecated: true,
  })
  @ApiResponse({ status: 200, description: 'OTP verified — returns accessToken + refreshToken' })
  @ApiBadRequestResponse({ description: 'OTP expired, not found, or max attempts exceeded' })
  @ApiUnauthorizedResponse({ description: 'Invalid OTP or no matching active account' })
  verifyOtp(@Body() dto: VerifyOtpDto) {
    return this.otpService.verifyOtp(dto);
  }

  @Post('send-email-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Send OTP to an email address',
    description:
      'Generates a 6-digit OTP valid for 5 minutes and sends it via email. ' +
      'A new OTP cannot be requested for the same address within 2 minutes.',
  })
  @ApiResponse({ status: 200, description: 'OTP dispatched to email' })
  @ApiBadRequestResponse({ description: 'Resend cooldown active (2 min)' })
  sendEmailOtp(@Body() dto: SendEmailOtpDto) {
    return this.otpService.sendEmailOtp(dto);
  }

  @Post('verify-email-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Verify email OTP and receive JWT access + refresh tokens',
    description:
      'Validates the email OTP and returns accessToken, refreshToken, and user. ' +
      'Maximum 5 failed attempts before the OTP is locked.',
  })
  @ApiResponse({ status: 200, description: 'OTP verified — returns accessToken + refreshToken + user' })
  @ApiBadRequestResponse({ description: 'OTP expired, not found, or max attempts exceeded' })
  @ApiUnauthorizedResponse({ description: 'Invalid OTP or no matching active account' })
  verifyEmailOtp(@Body() dto: VerifyEmailOtpDto) {
    return this.otpService.verifyEmailOtp(dto);
  }
}
