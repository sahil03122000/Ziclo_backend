import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { OtpType } from '@prisma/client';
import { createHash, randomBytes } from 'crypto';

import { EmailService } from '../email/email.service';
import { PrismaService } from '../prisma/prisma.service';
import { SendEmailOtpDto } from './dto/send-email-otp.dto';
import { SendOtpDto } from './dto/send-otp.dto';
import { VerifyEmailOtpDto } from './dto/verify-email-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { SmsService } from './sms.service';

// TODO: re-enable role-specific login enforcement when Firebase Phone Auth ships.
// const OTP_ONLY_ROLES: Role[] = [Role.WORKER, Role.USER];

@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);

  // DEVELOPMENT ONLY — true when NODE_ENV is not 'production'.
  // Controls whether OTP is returned in the API response and logged to console.
  // Production hard-codes this to false regardless of any environment variable.
  private readonly isDev: boolean;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly smsService: SmsService,
    private readonly emailService: EmailService,
    private readonly config: ConfigService,
  ) {
    this.isDev = config.get<string>('NODE_ENV') !== 'production';
  }

  /**
   * @deprecated Use FirebaseService.verifyIdToken + AuthService.firebaseLogin instead.
   * Phone OTP via SMS has been superseded by Firebase Phone Authentication.
   */
  async sendOtp(dto: SendOtpDto) {
    const { identifier } = dto;
    const type = this.resolveType(identifier);

    // Anti-spam: one OTP per identifier per 2 minutes
    const recent = await this.prisma.otpVerification.findFirst({
      where: {
        identifier,
        verifiedAt: null,
        createdAt: { gte: new Date(Date.now() - 2 * 60 * 1000) },
      },
    });

    if (recent) {
      throw new BadRequestException('Please wait 2 minutes before requesting another OTP');
    }

    // Purge old unverified records for this identifier before creating a fresh one
    await this.prisma.otpVerification.deleteMany({
      where: { identifier, verifiedAt: null },
    });

    const otp = this.generateOtp();
    const otpHash = this.hash(otp);
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    // OTP is always persisted as a hash — verification works identically in all modes
    await this.prisma.otpVerification.create({
      data: { identifier, otpHash, type, expiresAt },
    });

    // ── DEVELOPMENT ONLY ──────────────────────────────────────────────────────
    // When NODE_ENV !== 'production': skip the SMS/email provider, log the plain
    // OTP to the console, and return it in the response for local testing.
    //
    // In production this entire block is unreachable — OTP is NEVER logged and
    // NEVER included in the response.
    // ─────────────────────────────────────────────────────────────────────────
    if (this.isDev) {
      this.logger.log(`[DEV] OTP for ${identifier}: ${otp}`); // DEVELOPMENT ONLY
      return {
        success: true,
        message: 'OTP sent successfully',
        data: { otp }, // DEVELOPMENT ONLY — never present in production responses
      };
    }

    // ── PRODUCTION ────────────────────────────────────────────────────────────
    // OTP is dispatched via the configured provider. It is never logged or
    // returned to the caller.
    if (type === OtpType.SMS) {
      await this.smsService.send(identifier, otp);
    } else {
      await this.emailService.sendOtp(identifier, otp);
    }

    return { success: true, message: 'OTP sent successfully' };
  }

  /**
   * @deprecated Use FirebaseService.verifyIdToken + AuthService.firebaseLogin instead.
   * Phone OTP via SMS has been superseded by Firebase Phone Authentication.
   */
  async verifyOtp(dto: VerifyOtpDto) {
    const { identifier, otp } = dto;

    const record = await this.prisma.otpVerification.findFirst({
      where: {
        identifier,
        verifiedAt: null,
        expiresAt: { gte: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!record) {
      throw new BadRequestException('OTP not found or expired. Please request a new one.');
    }

    if (record.attempts >= 5) {
      throw new BadRequestException('Maximum OTP attempts exceeded. Please request a new OTP.');
    }

    if (this.hash(otp) !== record.otpHash) {
      await this.prisma.otpVerification.update({
        where: { id: record.id },
        data: { attempts: { increment: 1 } },
      });
      throw new UnauthorizedException('Invalid OTP');
    }

    // Delete after successful verification — consumed OTPs are not retained
    await this.prisma.otpVerification.delete({ where: { id: record.id } });

    const user =
      record.type === OtpType.SMS
        ? await this.prisma.user.findUnique({ where: { phone: identifier } })
        : await this.prisma.user.findUnique({ where: { email: identifier } });

    if (!user || !user.isActive) {
      throw new UnauthorizedException('No active account found for this identifier');
    }

    // Role-based login method enforcement temporarily disabled.
    // TODO: re-enable when Firebase Phone Auth is released:
    // if (OTP_ONLY_ROLES.includes(user.role) && record.type !== OtpType.SMS) {
    //   throw new UnauthorizedException('This role can only authenticate via mobile OTP');
    // }

    const accessToken = this.issueAccessToken(user.id, user.email);
    const refreshToken = await this.issueRefreshToken(user.id);

    const { password, ...safeUser } = user;

    return {
      success: true,
      message: 'Login successful',
      data: { user: safeUser, accessToken, refreshToken },
    };
  }

  async sendEmailOtp(dto: SendEmailOtpDto) {
    const { email } = dto;

    // Anti-spam: one OTP per address per 2 minutes
    const recent = await this.prisma.otpVerification.findFirst({
      where: {
        identifier: email,
        verifiedAt: null,
        createdAt: { gte: new Date(Date.now() - 2 * 60 * 1000) },
      },
    });

    if (recent) {
      throw new BadRequestException('Please wait 2 minutes before requesting another OTP');
    }

    // Purge old unverified records before creating a fresh one
    await this.prisma.otpVerification.deleteMany({
      where: { identifier: email, verifiedAt: null },
    });

    const otp = this.generateOtp();
    const otpHash = this.hash(otp);
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    await this.prisma.otpVerification.create({
      data: { identifier: email, otpHash, type: OtpType.EMAIL, expiresAt },
    });

    // Always dispatch via SMTP — no dev bypass for the email OTP flow
    await this.emailService.sendOtp(email, otp);

    return { success: true, message: 'OTP sent successfully' };
  }

  async verifyEmailOtp(dto: VerifyEmailOtpDto) {
    return this.verifyOtp({ identifier: dto.email, otp: dto.otp });
  }

  // ─── Private ─────────────────────────────────────────────────────────────────

  private resolveType(identifier: string): OtpType {
    return identifier.includes('@') ? OtpType.EMAIL : OtpType.SMS;
  }

  private generateOtp(): string {
    // Cryptographically random 6-digit OTP (100000–999999)
    const bytes = randomBytes(4);
    const num = bytes.readUInt32BE(0);
    return String(100000 + (num % 900000));
  }

  private hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  private issueAccessToken(userId: string, email: string): string {
    return this.jwtService.sign({ sub: userId, email });
  }

  private async issueRefreshToken(userId: string): Promise<string> {
    const raw = randomBytes(64).toString('hex');
    const tokenHash = this.hash(raw);
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await this.prisma.refreshToken.create({ data: { userId, tokenHash, expiresAt } });
    return raw;
  }
}
