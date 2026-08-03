import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import type { AuthUser } from '../common/types/auth-user.type';
import { AuthService } from './auth.service';
import { FirebaseLoginDto } from './dto/firebase-login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { MobileLoginDto } from './dto/mobile-login.dto';
import { LoginDto } from './dto/login.dto';
import { LogoutDto } from './dto/logout.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RegisterDto } from './dto/register.dto';
import { ResendEmailOtpDto } from './dto/resend-email-otp.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { VerifyEmailOtpDto } from './dto/verify-email-otp.dto';

@ApiTags('Authentication')
@Controller('auth')
@Throttle({ default: { limit: 10, ttl: 60000 } })
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // ─── Firebase Phone Auth (primary mobile login) ───────────────────────────

  @Post('firebase-login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Firebase Phone Auth login — primary mobile flow',
    description:
      'Verifies a Firebase ID Token issued after the client completes phone OTP on the device. ' +
      'Creates a new account on first login (`isNewUser: true`). ' +
      'Returns the same JWT access + refresh token pair used by all subsequent API calls. ' +
      '**Firebase token is consumed here — only our JWTs are used downstream.**\n\n' +
      '**Flow:**\n' +
      '1. App calls Firebase Auth SDK → user enters OTP → SDK returns `idToken`\n' +
      '2. App sends `idToken` to this endpoint\n' +
      '3. Backend verifies token signature, expiry, phone number claim, and project ID\n' +
      '4. Returns `accessToken` (15 min) + `refreshToken` (30 days)',
  })
  @ApiResponse({
    status: 200,
    description: 'Login successful — returns JWT pair and user object',
    schema: {
      example: {
        success: true,
        message: 'Login successful',
        data: {
          user: { id: 'uuid', name: 'Ravi Kumar', phone: '+919876543210', email: 'firebase_uid@no-reply.local', role: 'USER', isActive: true },
          accessToken: 'eyJhbGciOiJSUzI1NiJ9...',
          refreshToken: 'a3f9d2e1...',
          isNewUser: false,
        },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Firebase token does not contain a phone number' })
  @ApiResponse({ status: 401, description: 'Firebase token expired, revoked, or from wrong project' })
  @ApiResponse({ status: 429, description: 'Rate limit exceeded — 10 req/min per IP' })
  firebaseLogin(@Body() dto: FirebaseLoginDto, @Req() req: Request) {
    return this.authService.firebaseLogin(dto, { ipAddress: req.ip, userAgent: req.headers['user-agent'] });
  }

  // ─── Mobile Login (Firebase Phone Auth) ──────────────────────────────────────

  @Post('mobile-login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Mobile login via Firebase Phone Authentication',
    description:
      'Verifies a Firebase ID Token issued after the user completes phone OTP on the device. ' +
      '**The backend does NOT generate or send OTPs** — all OTP handling is done entirely by Firebase Authentication on the client.\n\n' +
      '**Flow:**\n' +
      '1. App calls Firebase Auth SDK → user enters phone number → Firebase sends OTP → user enters OTP\n' +
      '2. Firebase SDK returns a signed `firebaseIdToken` to the app\n' +
      '3. App sends `firebaseIdToken` to this endpoint\n' +
      '4. Backend verifies token signature, expiry, and phone number claim\n' +
      '5. Finds or creates user account, returns JWT access + refresh token pair\n\n' +
      'First-time login creates a new account (`isNewUser: true`).',
  })
  @ApiResponse({
    status: 200,
    description: 'Login successful — returns JWT pair and user object',
    schema: {
      example: {
        success: true,
        message: 'Login successful',
        data: {
          user: { id: 'uuid', name: 'Ravi Kumar', phone: '+919876543210', role: 'USER', isActive: true },
          accessToken: 'eyJhbGciOiJSUzI1NiJ9...',
          refreshToken: 'a3f9d2e1...',
          isNewUser: false,
        },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Firebase token does not contain a phone number' })
  @ApiResponse({ status: 401, description: 'Firebase token expired, revoked, or from wrong project' })
  @ApiResponse({ status: 401, description: 'Account is inactive' })
  @ApiResponse({ status: 429, description: 'Rate limit exceeded — 10 req/min per IP' })
  mobileLogin(@Body() dto: MobileLoginDto, @Req() req: Request) {
    return this.authService.mobileLogin(dto, { ipAddress: req.ip, userAgent: req.headers['user-agent'] });
  }

  // ─── Email + password (admin / manager web login) ─────────────────────────

  @Post('register')
  @ApiOperation({
    summary: 'Register a new USER account',
    description: 'Creates a new account with role USER. For ADMIN/MANAGER accounts use `PATCH /users/:id/role` after registration.',
  })
  @ApiResponse({
    status: 201,
    description: 'Account created — returns JWT pair',
    schema: {
      example: {
        success: true,
        message: 'User registered successfully',
        data: { user: { id: 'uuid', name: 'Amit Shah', email: 'amit@example.com', role: 'USER' }, accessToken: '...', refreshToken: '...' },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Email or phone already exists / validation error' })
  @ApiResponse({ status: 429, description: 'Rate limit exceeded' })
  register(@Body() dto: RegisterDto, @Req() req: Request) {
    return this.authService.register(dto, { ipAddress: req.ip, userAgent: req.headers['user-agent'] });
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Email + password login',
    description:
      'Authenticates any active user with a valid email and password. ' +
      'MANAGER accounts on the WEB platform additionally require an active attendance check-in.',
  })
  @ApiResponse({
    status: 200,
    description: 'Login successful — returns JWT pair',
    schema: {
      example: {
        success: true,
        message: 'Login successful',
        data: { user: { id: 'uuid', name: 'Admin User', email: 'admin@example.com', role: 'ADMIN' }, accessToken: '...', refreshToken: '...' },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Invalid credentials / role not allowed / attendance required (MANAGER)' })
  @ApiResponse({ status: 429, description: 'Rate limit exceeded' })
  login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.authService.login(dto, { ipAddress: req.ip, userAgent: req.headers['user-agent'] });
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Exchange a refresh token for a new token pair (rotation)',
    description: 'Refresh tokens are single-use. The old token is deleted and a new pair is issued. Tokens expire after 30 days.',
  })
  @ApiResponse({
    status: 200,
    description: 'New token pair issued',
    schema: { example: { success: true, data: { accessToken: '...', refreshToken: '...' } } },
  })
  @ApiResponse({ status: 401, description: 'Refresh token not found, expired, or already used' })
  refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refresh(dto);
  }

  @ApiBearerAuth('JWT')
  @UseGuards(JwtAuthGuard)
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Invalidate the current refresh token and log out' })
  @ApiResponse({ status: 200, description: 'Logged out — refresh token invalidated' })
  @ApiResponse({ status: 401, description: 'Bearer token missing or expired' })
  logout(@CurrentUser() user: AuthUser, @Body() dto: LogoutDto, @Req() req: Request) {
    return this.authService.logout(user.id, dto, { ipAddress: req.ip, userAgent: req.headers['user-agent'] });
  }

  // ─── Forgot / Reset Password ──────────────────────────────────────────────

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  @ApiOperation({
    summary: 'Request a password reset OTP via email',
    description:
      'Sends a 6-digit OTP to the email address. ' +
      'Always returns the same 200 response regardless of whether the account exists, ' +
      'preventing email enumeration attacks.\n\n' +
      '**OTP expires in 10 minutes.** Rate limited to 3 requests per minute per IP.',
  })
  @ApiOkResponse({
    description: 'OTP sent (or silently suppressed when email is not registered)',
    schema: { example: { success: true, message: 'OTP sent successfully.' } },
  })
  @ApiResponse({ status: 400, description: 'Validation error — invalid email format' })
  @ApiResponse({ status: 429, description: 'Rate limit exceeded — max 3 requests/min per IP' })
  forgotPassword(@Body() dto: ForgotPasswordDto, @Req() req: Request) {
    return this.authService.forgotPassword(dto, { ipAddress: req.ip, userAgent: req.headers['user-agent'] });
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({
    summary: 'Reset password using email + OTP',
    description:
      'Verifies the 6-digit OTP sent to the email and resets the password in a single atomic operation. ' +
      'The OTP is **deleted after use** (single-use) and **all existing refresh tokens are invalidated** (forces logout on all devices).\n\n' +
      'OTP is valid for 10 minutes from the `POST /auth/forgot-password` request.',
  })
  @ApiOkResponse({
    description: 'Password reset successful — all sessions invalidated',
    schema: {
      example: { success: true, message: 'Password changed successfully.' },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'OTP invalid/expired/already used, passwords do not match, or password fails strength rules',
    schema: { example: { statusCode: 400, message: 'Invalid or expired OTP', error: 'Bad Request' } },
  })
  @ApiResponse({ status: 429, description: 'Rate limit exceeded — max 5 requests/min per IP' })
  resetPassword(@Body() dto: ResetPasswordDto, @Req() req: Request) {
    return this.authService.resetPassword(dto, { ipAddress: req.ip, userAgent: req.headers['user-agent'] });
  }

  // ─── Authenticated ────────────────────────────────────────────────────────

  @ApiBearerAuth('JWT')
  @UseGuards(JwtAuthGuard)
  @Get('me')
  @ApiOperation({ summary: 'Get the currently authenticated user' })
  @ApiResponse({
    status: 200,
    description: 'Current user object',
    schema: {
      example: {
        success: true,
        data: { id: 'uuid', name: 'Ravi Kumar', email: 'ravi@example.com', phone: '+919876543210', role: 'USER', isActive: true },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Bearer token missing or expired' })
  getCurrentUser(@CurrentUser() user: AuthUser) {
    return this.authService.getCurrentUser(user.id);
  }

  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Verify email address using a one-time token',
    description: 'Accepts the token sent to the email and marks it as verified. Tokens expire after 1 hour.',
  })
  @ApiResponse({ status: 200, description: 'Email verified successfully' })
  @ApiResponse({ status: 400, description: 'Token invalid, expired, or already used' })
  verifyEmail(@Body() dto: VerifyEmailDto, @Req() req: Request) {
    return this.authService.verifyEmail(dto.token, { ipAddress: req.ip, userAgent: req.headers['user-agent'] });
  }

  @Post('verify-email-otp')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({
    summary: 'Verify email using a 6-digit OTP',
    description:
      'Validates the OTP sent during login (when emailVerified is false) and marks the account as verified. ' +
      'OTP is single-use and expires in 10 minutes.',
  })
  @ApiOkResponse({ description: 'Email verified successfully', schema: { example: { success: true, message: 'Email verified successfully' } } })
  @ApiResponse({ status: 400, description: 'OTP invalid, expired, or max attempts exceeded' })
  verifyEmailOtp(@Body() dto: VerifyEmailOtpDto) {
    return this.authService.verifyEmailOtp(dto);
  }

  @Post('resend-email-otp')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  @ApiOperation({
    summary: 'Resend the email verification OTP',
    description: 'Invalidates any existing OTP and sends a new 6-digit OTP valid for 10 minutes.',
  })
  @ApiOkResponse({ description: 'OTP sent', schema: { example: { success: true, message: 'OTP sent successfully' } } })
  resendEmailOtp(@Body() dto: ResendEmailOtpDto) {
    return this.authService.resendEmailOtp(dto);
  }

  @ApiBearerAuth('JWT')
  @UseGuards(JwtAuthGuard)
  @Get('sessions')
  @ApiOperation({
    summary: 'List active sessions (non-expired refresh tokens)',
    description: 'Returns all non-expired refresh tokens for the current user. Use to audit active devices.',
  })
  @ApiResponse({
    status: 200,
    description: 'List of active sessions',
    schema: {
      example: {
        success: true,
        data: [{ id: 'uuid', createdAt: '2026-06-01T10:00:00Z', expiresAt: '2026-07-01T10:00:00Z' }],
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Bearer token missing or expired' })
  getSessions(@CurrentUser() user: AuthUser) {
    return this.authService.getSessions(user.id);
  }

  @ApiBearerAuth('JWT')
  @UseGuards(JwtAuthGuard)
  @Delete('sessions/:id')
  @ApiOperation({ summary: 'Revoke a specific session by its ID (force log out a device)' })
  @ApiResponse({ status: 200, description: 'Session revoked' })
  @ApiResponse({ status: 400, description: 'Session not found or belongs to another user' })
  @ApiResponse({ status: 401, description: 'Bearer token missing or expired' })
  revokeSession(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.authService.revokeSession(id, user.id);
  }
}
