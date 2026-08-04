import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { ActivityAction, ActivityModule, AuditAction, AttendanceStatus, OtpType, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes, randomInt } from 'crypto';

import { ActivityLogService } from '../activity-log/activity-log.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { getTodayRange } from '../common/utils/date.util';
import { EmailService } from '../email/email.service';
import { FirebaseService } from '../firebase/firebase.service';
import { PrismaService } from '../prisma/prisma.service';
import { FirebaseLoginDto } from './dto/firebase-login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { MobileLoginDto } from './dto/mobile-login.dto';
import { LoginDto, Platform } from './dto/login.dto';
import { LogoutDto } from './dto/logout.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RegisterDto } from './dto/register.dto';
import { ResendEmailOtpDto } from './dto/resend-email-otp.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { VerifyEmailOtpDto } from './dto/verify-email-otp.dto';

export interface RequestContext {
  ipAddress?: string;
  userAgent?: string;
}

const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly auditLogs: AuditLogsService,
    private readonly firebase: FirebaseService,
    private readonly activityLog: ActivityLogService,
    private readonly emailService: EmailService,
    private readonly config: ConfigService,
  ) {}

  // ─── Firebase Phone Login ─────────────────────────────────────────────────────

  async firebaseLogin(dto: FirebaseLoginDto, ctx?: RequestContext) {
    // 1. Verify Firebase ID Token (checks signature, expiry, revocation, project)
    let firebaseUser: Awaited<ReturnType<FirebaseService['verifyIdToken']>>;
    try {
      firebaseUser = await this.firebase.verifyIdToken(dto.idToken);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Firebase token verification failed: ${msg}`);
      this.auditLogs
        .log({
          actorId: undefined,
          entityType: 'Auth',
          entityId: 'firebase',
          action: AuditAction.LOGIN,
          newValue: { result: 'firebase_verification_failed', reason: msg },
          ...ctx,
        })
        .catch(() => {});
      // Re-throw as-is: FirebaseService already throws UnauthorizedException
      throw err;
    }

    // 2. Phone number is mandatory for phone-auth tokens
    const phone = firebaseUser.phone;
    if (!phone) {
      this.auditLogs
        .log({
          actorId: undefined,
          entityType: 'Auth',
          entityId: 'firebase',
          action: AuditAction.LOGIN,
          newValue: { result: 'missing_phone_number', uid: firebaseUser.uid },
          ...ctx,
        })
        .catch(() => {});
      throw new BadRequestException(
        'Firebase ID Token must contain a phone number. ' +
        'Ensure the token was issued by Firebase Phone Authentication.',
      );
    }

    // 3. Look up user by phone number
    let user = await this.prisma.user.findUnique({
      where: { phone },
    });

    let isNewUser = false;

    if (!user) {
      // 4a. New user — create account from Firebase data
      const email =
        firebaseUser.email ??
        `firebase_${firebaseUser.uid}@no-reply.local`;
      const name =
        firebaseUser.name ??
        `User ${phone.slice(-4)}`; // e.g. "User 3210"
      const rawPassword = randomBytes(32).toString('hex');
      const hashedPassword = await bcrypt.hash(rawPassword, 10);

      user = await this.prisma.user.create({
        data: {
          name,
          email,
          phone,
          password: hashedPassword,
          role: Role.USER,
        },
      });
      isNewUser = true;
      this.activityLog.log({
        action: ActivityAction.USER_REGISTERED,
        module: ActivityModule.AUTH,
        description: `${user.name} registered via Firebase Phone Auth`,
        actor: { id: user.id, name: user.name, role: user.role },
        target: { id: user.id, type: 'User' },
        ipAddress: ctx?.ipAddress,
      });

      this.logger.log(`Firebase: new user created — id=${user.id} phone=${phone}`);

      this.auditLogs
        .log({
          actorId: user.id,
          entityType: 'User',
          entityId: user.id,
          action: AuditAction.CREATE,
          newValue: { phone, firebaseUid: firebaseUser.uid, method: 'firebase_phone_auth' },
          ...ctx,
        })
        .catch(() => {});
    } else {
      // 4b. Existing user — check account status
      if (!user.isActive) {
        this.auditLogs
          .log({
            actorId: user.id,
            entityType: 'Auth',
            entityId: user.id,
            action: AuditAction.LOGIN,
            newValue: { result: 'account_inactive', phone, firebaseUid: firebaseUser.uid },
            ...ctx,
          })
          .catch(() => {});
        throw new UnauthorizedException('Account is inactive. Please contact support.');
      }
    }

    // 5. Issue our own JWT pair
    const accessToken = this.generateAccessToken(user.id, user.email);
    const refreshToken = await this.createRefreshToken(user.id);
    const { password, ...safeUser } = user;

    // 6. Audit successful login
    this.activityLog.log({
      action: ActivityAction.USER_LOGIN,
      module: ActivityModule.AUTH,
      description: `${user.name} logged in via Firebase Phone Auth`,
      actor: { id: user.id, name: user.name, role: user.role },
      target: { id: user.id, type: 'User' },
      ipAddress: ctx?.ipAddress,
    });
    this.auditLogs
      .log({
        actorId: user.id,
        entityType: 'Auth',
        entityId: user.id,
        action: AuditAction.LOGIN,
        newValue: {
          method: 'firebase_phone_auth',
          firebaseUid: firebaseUser.uid,
          phone,
          isNewUser,
        },
        ...ctx,
      })
      .catch(() => {});

    this.logger.log(
      `Firebase login — user=${user.id} phone=${phone} isNew=${isNewUser}`,
    );

    return {
      success: true,
      message: isNewUser ? 'Account created and logged in successfully' : 'Login successful',
      data: {
        user: safeUser,
        accessToken,
        refreshToken,
        isNewUser,
      },
    };
  }

  // ─── Mobile Login (Firebase Phone Auth) ──────────────────────────────────────

  async mobileLogin(dto: MobileLoginDto, ctx?: RequestContext) {
    // 1. Verify Firebase ID Token — throws UnauthorizedException on failure
    let firebaseUser: Awaited<ReturnType<FirebaseService['verifyIdToken']>>;
    try {
      firebaseUser = await this.firebase.verifyIdToken(dto.firebaseIdToken);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`[mobileLogin] Token verification failed: ${msg}`);
      this.activityLog.log({
        action: ActivityAction.MOBILE_LOGIN_FAILED,
        module: ActivityModule.AUTH,
        description: `Firebase token verification failed: ${msg}`,
        actor: { name: 'Unknown', role: Role.USER },
        ipAddress: ctx?.ipAddress,
      });
      throw err;
    }

    // 2. Phone number is mandatory for phone-auth tokens
    const phone = firebaseUser.phone;
    if (!phone) {
      this.activityLog.log({
        action: ActivityAction.MOBILE_LOGIN_FAILED,
        module: ActivityModule.AUTH,
        description: `Mobile login failed — token missing phone_number claim (uid=${firebaseUser.uid})`,
        actor: { name: 'Unknown', role: Role.USER },
        ipAddress: ctx?.ipAddress,
      });
      throw new BadRequestException(
        'Firebase ID Token does not contain a phone number. ' +
        'Ensure it was issued by Firebase Phone Authentication.',
      );
    }

    // 3. Find user by phone number
    let user = await this.prisma.user.findUnique({ where: { phone } });
    let isNewUser = false;

    if (!user) {
      // 4a. New user — auto-create account from Firebase data
      const email = firebaseUser.email ?? `firebase_${firebaseUser.uid}@no-reply.local`;
      const name = firebaseUser.name ?? `User ${phone.slice(-4)}`;
      const hashedPassword = await bcrypt.hash(randomBytes(32).toString('hex'), 10);

      user = await this.prisma.user.create({
        data: { name, email, phone, password: hashedPassword, role: Role.USER, phoneVerified: true },
      });
      isNewUser = true;

      this.activityLog.log({
        action: ActivityAction.USER_REGISTERED,
        module: ActivityModule.AUTH,
        description: `${user.name} registered via Firebase Phone Auth`,
        actor: { id: user.id, name: user.name, role: user.role },
        target: { id: user.id, type: 'User' },
        ipAddress: ctx?.ipAddress,
      });
      this.auditLogs
        .log({
          actorId: user.id,
          entityType: 'User',
          entityId: user.id,
          action: AuditAction.CREATE,
          newValue: { phone, firebaseUid: firebaseUser.uid, method: 'firebase_phone_auth' },
          ...ctx,
        })
        .catch(() => {});

      this.logger.log(`[mobileLogin] New user created — id=${user.id} phone=${phone}`);
    } else {
      // 4b. Existing user — check account status
      if (!user.isActive) {
        this.activityLog.log({
          action: ActivityAction.MOBILE_LOGIN_INACTIVE_ACCOUNT,
          module: ActivityModule.AUTH,
          description: `Mobile login denied — account inactive for phone=${phone}`,
          actor: { id: user.id, name: user.name, role: user.role },
          target: { id: user.id, type: 'User' },
          ipAddress: ctx?.ipAddress,
        });
        this.auditLogs
          .log({
            actorId: user.id,
            entityType: 'Auth',
            entityId: user.id,
            action: AuditAction.LOGIN,
            newValue: { result: 'account_inactive', phone },
            ...ctx,
          })
          .catch(() => {});
        throw new UnauthorizedException('Account is inactive. Please contact support.');
      }
    }

    // 5. Mark phone as verified for existing users (new users already have it set in create)
    if (!isNewUser && !user.phoneVerified) {
      this.prisma.user.update({ where: { id: user.id }, data: { phoneVerified: true } }).catch(() => {});
    }

    // 6. Issue JWT pair
    const accessToken = this.generateAccessToken(user.id, user.email);
    const refreshToken = await this.createRefreshToken(user.id);
    const { password, ...safeUser } = user;

    // 6. Audit successful login
    this.activityLog.log({
      action: ActivityAction.MOBILE_LOGIN_SUCCESS,
      module: ActivityModule.AUTH,
      description: `${user.name} logged in via Firebase Phone Auth`,
      actor: { id: user.id, name: user.name, role: user.role },
      target: { id: user.id, type: 'User' },
      ipAddress: ctx?.ipAddress,
    });
    this.auditLogs
      .log({
        actorId: user.id,
        entityType: 'Auth',
        entityId: user.id,
        action: AuditAction.LOGIN,
        newValue: { method: 'firebase_phone_auth', firebaseUid: firebaseUser.uid, phone, isNewUser },
        ...ctx,
      })
      .catch(() => {});

    this.logger.log(`[mobileLogin] Success — userId=${user.id} phone=${phone} isNew=${isNewUser}`);

    return {
      success: true,
      message: isNewUser ? 'Account created and logged in successfully' : 'Login successful',
      data: { user: safeUser, accessToken, refreshToken, isNewUser },
    };
  }

  // ─── Register ─────────────────────────────────────────────────────────────────

  async register(dto: RegisterDto, ctx?: RequestContext) {
    const email = dto.email.toLowerCase();

    const existingUser = await this.prisma.user.findFirst({
      where: { OR: [{ email }, { phone: dto.phone }] },
      select: { id: true },
    });

    if (existingUser) {
      throw new BadRequestException('Email or phone already exists');
    }

    const hashedPassword = await bcrypt.hash(dto.password, 10);

    // role is always USER for public registration — never trust client input
    const user = await this.prisma.user.create({
      data: { name: dto.name, email, phone: dto.phone, password: hashedPassword, role: Role.USER },
    });

    const accessToken = this.generateAccessToken(user.id, user.email);
    const refreshToken = await this.createRefreshToken(user.id);
    const { password, ...safeUser } = user;

    this.auditLogs
      .log({ actorId: user.id, entityType: 'User', entityId: user.id, action: AuditAction.CREATE, newValue: { email: user.email, role: user.role }, ...ctx })
      .catch(() => {});
    this.activityLog.log({
      action: ActivityAction.USER_REGISTERED,
      module: ActivityModule.AUTH,
      description: `${user.name} registered`,
      actor: { id: user.id, name: user.name, role: user.role },
      target: { id: user.id, type: 'User' },
      ipAddress: ctx?.ipAddress,
    });

    this.emailService
      .sendWelcomeEmail({ to: user.email, name: user.name })
      .catch((err: Error) => this.logger.error(`[register] Welcome email failed for ${user.email}: ${err.message}`));

    return {
      success: true,
      message: 'User registered successfully',
      data: { user: safeUser, accessToken, refreshToken },
    };
  }

  // ─── Login (email + password) ─────────────────────────────────────────────────

  async login(dto: LoginDto, ctx?: RequestContext) {
    const email = dto.email.toLowerCase();
    this.logger.log(`[login] Step 1: lookup user — email=${email}`);

    let user: Awaited<ReturnType<typeof this.prisma.user.findUnique>>;
    try {
      user = await this.prisma.user.findUnique({ where: { email } });
      this.logger.log(`[login] Step 1 done: user ${user ? 'found (id=' + user.id + ')' : 'not found'}`);
    } catch (err) {
      this.logger.error(`[login] Step 1 FAILED (prisma.user.findUnique): ${(err as Error).message}`, (err as Error).stack);
      throw err;
    }

    this.logger.log('[login] Step 2: validate password');
    try {
      if (!user || !(await bcrypt.compare(dto.password, user.password))) {
        this.logger.warn('[login] Step 2 FAILED: invalid email or password');
        throw new UnauthorizedException('Invalid email or password');
      }
      this.logger.log('[login] Step 2 done: password valid');
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err;
      this.logger.error(`[login] Step 2 FAILED (bcrypt.compare): ${(err as Error).message}`, (err as Error).stack);
      throw err;
    }

    this.logger.log('[login] Step 3: check isActive');
    if (!user.isActive) {
      this.logger.warn(`[login] Step 3 FAILED: account inactive — userId=${user.id}`);
      throw new UnauthorizedException('Account is inactive');
    }
    this.logger.log('[login] Step 3 done: account active');

    this.logger.log(`[login] Step 4: check emailVerified — emailVerified=${user.emailVerified}`);
    if (!user.emailVerified) {
      try {
        await this.issueEmailVerificationOtp(email, user.name);
        this.logger.log('[login] Step 4 done: verification OTP issued, blocking login (no JWT)');
      } catch (err) {
        this.logger.error(`[login] Step 4 FAILED (issueEmailVerificationOtp): ${(err as Error).message}`, (err as Error).stack);
        throw err;
      }
      return {
        success: false,
        requiresEmailVerification: true,
        message: 'Email verification required.',
      };
    }

    // Mobile OTP enforcement is temporarily disabled — all roles may use email+password.
    // TODO: re-enable when Firebase Phone Auth is released:
    // if (user.role === Role.WORKER || user.role === Role.USER) {
    //   throw new UnauthorizedException('This role must use mobile OTP to log in');
    // }

    this.logger.log(`[login] Step 5: platform/manager attendance check — platform=${dto.platform}, role=${user.role}`);
    try {
      if (dto.platform === Platform.WEB && user.role === Role.MANAGER) {
        const { start, end } = getTodayRange();
        const active = await this.prisma.attendance.findFirst({
          where: { userId: user.id, checkInTime: { gte: start, lt: end }, status: AttendanceStatus.CHECKED_IN },
          select: { id: true },
        });
        if (!active) {
          this.logger.warn(`[login] Step 5 FAILED: manager not checked in — userId=${user.id}`);
          throw new UnauthorizedException('Please check-in from mobile app before accessing web dashboard');
        }
      }
      this.logger.log('[login] Step 5 done');
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err;
      this.logger.error(`[login] Step 5 FAILED (prisma.attendance.findFirst): ${(err as Error).message}`, (err as Error).stack);
      throw err;
    }

    this.logger.log('[login] Step 6: generate JWT access token');
    let accessToken: string;
    try {
      accessToken = this.generateAccessToken(user.id, user.email);
      this.logger.log('[login] Step 6 done: access token generated');
    } catch (err) {
      this.logger.error(`[login] Step 6 FAILED (generateAccessToken): ${(err as Error).message}`, (err as Error).stack);
      throw err;
    }

    this.logger.log('[login] Step 7: create refresh token');
    let refreshToken: string;
    try {
      refreshToken = await this.createRefreshToken(user.id);
      this.logger.log('[login] Step 7 done: refresh token created');
    } catch (err) {
      this.logger.error(`[login] Step 7 FAILED (createRefreshToken): ${(err as Error).message}`, (err as Error).stack);
      throw err;
    }

    const { password, ...safeUser } = user;

    this.logger.log('[login] Step 8: audit + activity logging (fire-and-forget)');
    this.auditLogs
      .log({ actorId: user.id, entityType: 'Auth', entityId: user.id, action: AuditAction.LOGIN, newValue: { platform: dto.platform }, ...ctx })
      .catch((err: Error) => this.logger.error(`[login] Step 8 auditLogs FAILED: ${err.message}`));
    this.activityLog.log({
      action: ActivityAction.USER_LOGIN,
      module: ActivityModule.AUTH,
      description: `${user.name} logged in`,
      actor: { id: user.id, name: user.name, role: user.role },
      target: { id: user.id, type: 'User' },
      ipAddress: ctx?.ipAddress,
      platform: dto.platform,
    });

    this.logger.log(`[login] Step 9: returning success response — userId=${user.id}`);
    return {
      success: true,
      message: 'Login successful',
      data: { user: safeUser, accessToken, refreshToken },
    };
  }

  // ─── Refresh ──────────────────────────────────────────────────────────────────

  async refresh(dto: RefreshTokenDto) {
    const tokenHash = this.hashToken(dto.refreshToken);
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: { select: { id: true, email: true, isActive: true } } },
    });

    if (!stored || stored.expiresAt < new Date()) {
      if (stored) await this.prisma.refreshToken.delete({ where: { id: stored.id } });
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
    if (!stored.user.isActive) throw new UnauthorizedException('Account is inactive');

    await this.prisma.refreshToken.delete({ where: { id: stored.id } });
    const accessToken = this.generateAccessToken(stored.user.id, stored.user.email);
    const newRefreshToken = await this.createRefreshToken(stored.user.id);

    return { success: true, data: { accessToken, refreshToken: newRefreshToken } };
  }

  // ─── Logout ───────────────────────────────────────────────────────────────────

  async logout(userId: string, dto: LogoutDto, ctx?: RequestContext) {
    const tokenHash = this.hashToken(dto.refreshToken);
    await this.prisma.refreshToken.deleteMany({ where: { userId, tokenHash } });

    this.auditLogs
      .log({ actorId: userId, entityType: 'Auth', entityId: userId, action: AuditAction.LOGOUT, ...ctx })
      .catch(() => {});
    this.activityLog.log({
      action: ActivityAction.USER_LOGOUT,
      module: ActivityModule.AUTH,
      description: `User logged out`,
      actor: { id: userId, name: 'User', role: Role.USER },
      ipAddress: ctx?.ipAddress,
    });

    return { success: true, message: 'Logged out successfully' };
  }

  // ─── Forgot Password (OTP) ───────────────────────────────────────────────────

  async forgotPassword(dto: ForgotPasswordDto, ctx?: RequestContext) {
    const email = dto.email.toLowerCase();

    this.logger.log(`[forgotPassword] OTP request for email=${email}`);

    const SAFE_RESPONSE = { success: true, message: 'OTP sent successfully.' };

    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, name: true, role: true, isActive: true },
    });

    if (!user || !user.isActive) {
      this.logger.log(`[forgotPassword] No active account for ${email} — returning safe response`);
      return SAFE_RESPONSE;
    }

    // Purge any existing EMAIL OTPs for this identifier (one-at-a-time policy)
    await this.prisma.otpVerification.deleteMany({
      where: { identifier: email, type: OtpType.EMAIL },
    });

    // Generate cryptographically secure 6-digit OTP — store only the hash
    const otp = String(randomInt(100000, 1000000));
    const otpHash = this.hashToken(otp);
    const expiresAt = new Date(Date.now() + OTP_TTL_MS);

    await this.prisma.otpVerification.create({
      data: { identifier: email, otpHash, type: OtpType.EMAIL, expiresAt },
    });

    this.logger.log(`[forgotPassword] OTP created for userId=${user.id}`);

    // Send OTP email — catch errors so we never reveal whether the email exists
    try {
      await this.emailService.sendPasswordResetOtpEmail({ to: email, name: user.name, otp });
      this.logger.log(`[forgotPassword] OTP email dispatched to ${email}`);
    } catch (err) {
      this.logger.error(`[forgotPassword] OTP email send failed: ${(err as Error).message}`);
      if (this.config.get<string>('NODE_ENV') !== 'production') {
        this.logger.debug(`[forgotPassword][DEV] OTP: ${otp}`);
      }
      // Deliberately swallowed — return success regardless
    }

    this.activityLog.log({
      action: ActivityAction.FORGOT_PASSWORD_REQUESTED,
      module: ActivityModule.AUTH,
      description: `Password reset OTP requested for ${email}`,
      actor: { id: user.id, name: user.name, role: user.role },
      target: { id: user.id, type: 'User' },
      ipAddress: ctx?.ipAddress,
    });

    return SAFE_RESPONSE;
  }

  // ─── Reset Password ───────────────────────────────────────────────────────────

  async resetPassword(dto: ResetPasswordDto, ctx?: RequestContext) {
    const email = dto.email.toLowerCase();
    this.logger.log(`[resetPassword] Attempt for email=${email}`);

    const INVALID_OTP = new BadRequestException('Invalid or expired OTP');

    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, name: true, role: true, isActive: true },
    });

    if (!user || !user.isActive) throw INVALID_OTP;

    const otpRecord = await this.prisma.otpVerification.findFirst({
      where: {
        identifier: email,
        type: OtpType.EMAIL,
        expiresAt: { gt: new Date() },
        verifiedAt: null,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!otpRecord || this.hashToken(dto.otp) !== otpRecord.otpHash) {
      if (otpRecord) {
        await this.prisma.otpVerification.update({
          where: { id: otpRecord.id },
          data: { attempts: { increment: 1 } },
        });
      }
      throw INVALID_OTP;
    }

    const hashedPassword = await bcrypt.hash(dto.password, 10);

    // Atomic: update password, delete OTP (single-use), invalidate all sessions
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: user.id }, data: { password: hashedPassword } }),
      this.prisma.otpVerification.delete({ where: { id: otpRecord.id } }),
      this.prisma.refreshToken.deleteMany({ where: { userId: user.id } }),
    ]);

    this.logger.log(`[resetPassword] Password updated, sessions invalidated for userId=${user.id}`);

    this.auditLogs
      .log({
        actorId: user.id,
        entityType: 'User',
        entityId: user.id,
        action: AuditAction.UPDATE,
        newValue: { action: 'password_reset' },
        ...ctx,
      })
      .catch(() => {});

    this.activityLog.log({
      action: ActivityAction.PASSWORD_RESET_SUCCESS,
      module: ActivityModule.AUTH,
      description: `${user.name} reset their password successfully`,
      actor: { id: user.id, name: user.name, role: user.role },
      target: { id: user.id, type: 'User' },
      ipAddress: ctx?.ipAddress,
    });

    return { success: true, message: 'Password changed successfully.' };
  }

  // ─── Current user ─────────────────────────────────────────────────────────────

  async getCurrentUser(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.isActive) throw new UnauthorizedException('User not found or inactive');
    const { password, ...safeUser } = user;
    return { success: true, data: safeUser };
  }

  // ─── Email verification ───────────────────────────────────────────────────────

  async verifyEmail(token: string, ctx?: RequestContext) {
    const tokenHash = this.hashToken(token);
    const record = await this.prisma.passwordResetToken.findUnique({ where: { tokenHash } });

    if (!record || record.used || record.expiresAt < new Date()) {
      throw new BadRequestException('Invalid or expired verification token');
    }

    await this.prisma.$transaction([
      this.prisma.passwordResetToken.update({ where: { id: record.id }, data: { used: true } }),
      this.prisma.user.update({ where: { id: record.userId }, data: { emailVerified: true } }),
    ]);

    this.auditLogs
      .log({ actorId: record.userId, entityType: 'User', entityId: record.userId, action: AuditAction.UPDATE, newValue: { action: 'email_verified' }, ...ctx })
      .catch(() => {});

    return { success: true, message: 'Email verified successfully' };
  }

  // ─── Email verification OTP (login gate) ──────────────────────────────────────

  async verifyEmailOtp(dto: VerifyEmailOtpDto) {
    const email = dto.email.toLowerCase();
    const otpReceived = dto.otp;
    const INVALID_OTP = new BadRequestException('Invalid or expired OTP');

    this.logger.debug(`[verifyEmailOtp] email=${email} otpReceived=${otpReceived}`);

    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, name: true, role: true, isActive: true },
    });
    if (!user) {
      this.logger.debug(`[verifyEmailOtp] no user found for email=${email}`);
      throw INVALID_OTP;
    }

    // Look up the OTP by email + type only (not verifiedAt/expiresAt) so the debug
    // log below can tell us *why* it doesn't match, instead of just "not found".
    const otpRecord = await this.prisma.otpVerification.findFirst({
      where: { identifier: email, type: OtpType.EMAIL_VERIFICATION },
      orderBy: { createdAt: 'desc' },
    });

    this.logger.debug(
      `[verifyEmailOtp] SQL query result: ${
        otpRecord
          ? JSON.stringify({
              id: otpRecord.id,
              identifier: otpRecord.identifier,
              type: otpRecord.type,
              otpHashStored: otpRecord.otpHash,
              otpHashReceived: this.hashToken(otpReceived),
              expiresAt: otpRecord.expiresAt.toISOString(),
              now: new Date().toISOString(),
              verifiedAt: otpRecord.verifiedAt,
              attempts: otpRecord.attempts,
            })
          : 'no OtpVerification row found for this email+type'
      }`,
    );

    const isExpired = otpRecord ? otpRecord.expiresAt <= new Date() : true;
    const isAlreadyVerified = otpRecord ? otpRecord.verifiedAt !== null : false;
    const hashMatches = otpRecord ? this.hashToken(otpReceived) === otpRecord.otpHash : false;

    if (!otpRecord || isExpired || isAlreadyVerified || otpRecord.attempts >= 5 || !hashMatches) {
      this.logger.debug(
        `[verifyEmailOtp] rejecting — found=${!!otpRecord} expired=${isExpired} alreadyVerified=${isAlreadyVerified} attemptsExceeded=${otpRecord ? otpRecord.attempts >= 5 : 'n/a'} hashMatches=${hashMatches}`,
      );
      if (otpRecord && !isExpired && !isAlreadyVerified && otpRecord.attempts < 5) {
        await this.prisma.otpVerification.update({
          where: { id: otpRecord.id },
          data: { attempts: { increment: 1 } },
        });
      }
      throw INVALID_OTP;
    }

    // Mark verified then delete — verified=true is set first so the row would show as
    // consumed even if the delete somehow failed, then it's removed per requirement 7.
    const verifiedAt = new Date();
    const [updatedUser] = await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: user.id }, data: { emailVerified: true } }),
      this.prisma.otpVerification.update({ where: { id: otpRecord.id }, data: { verifiedAt } }),
      this.prisma.otpVerification.delete({ where: { id: otpRecord.id } }),
    ]);

    this.logger.debug(`[verifyEmailOtp] success — userId=${user.id} emailVerified=true verifiedAt=${verifiedAt.toISOString()}, OTP deleted`);

    // Issue a full session here, same shape as login()/register() — callers (e.g. the
    // mobile app's OTP/verify-email screens) destructure `data.user`/`data.accessToken`/
    // `data.refreshToken` straight off this response with no fallback. Previously this
    // endpoint returned only { success, message }, so `data` was undefined and that
    // destructure threw "Cannot read property 'user' of undefined" on the client.
    const accessToken = this.generateAccessToken(updatedUser.id, updatedUser.email);
    const refreshToken = await this.createRefreshToken(updatedUser.id);
    const { password, ...safeUser } = updatedUser;

    this.auditLogs
      .log({ actorId: user.id, entityType: 'User', entityId: user.id, action: AuditAction.UPDATE, newValue: { action: 'email_verified_otp' } })
      .catch(() => {});

    return {
      success: true,
      message: 'Email verified successfully',
      data: { user: safeUser, accessToken, refreshToken },
    };
  }

  async resendEmailOtp(dto: ResendEmailOtpDto) {
    const email = dto.email.toLowerCase();
    const SAFE_RESPONSE = { success: true, message: 'OTP sent successfully' };

    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, name: true, isActive: true, emailVerified: true },
    });

    if (!user || !user.isActive || user.emailVerified) return SAFE_RESPONSE;

    await this.issueEmailVerificationOtp(email, user.name);
    return SAFE_RESPONSE;
  }

  // ─── Sessions ─────────────────────────────────────────────────────────────────

  async getSessions(userId: string) {
    const sessions = await this.prisma.refreshToken.findMany({
      where: { userId, expiresAt: { gte: new Date() } },
      select: { id: true, createdAt: true, expiresAt: true },
      orderBy: { createdAt: 'desc' },
    });
    return { success: true, data: sessions };
  }

  async revokeSession(sessionId: string, userId: string) {
    const session = await this.prisma.refreshToken.findFirst({ where: { id: sessionId, userId } });
    if (!session) throw new BadRequestException('Session not found or does not belong to this user');

    await this.prisma.refreshToken.delete({ where: { id: sessionId } });

    this.auditLogs
      .log({ actorId: userId, entityType: 'Auth', entityId: sessionId, action: AuditAction.LOGOUT, newValue: { action: 'session_revoked', sessionId } })
      .catch(() => {});

    return { success: true, message: 'Session revoked successfully' };
  }

  // ─── Private ──────────────────────────────────────────────────────────────────

  private generateAccessToken(userId: string, email: string): string {
    return this.jwtService.sign({ sub: userId, email });
  }

  private async createRefreshToken(userId: string): Promise<string> {
    const rawToken = randomBytes(64).toString('hex');
    const tokenHash = this.hashToken(rawToken);
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await this.prisma.refreshToken.create({ data: { userId, tokenHash, expiresAt } });
    return rawToken;
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /** Gates plaintext-OTP debug logging to non-production so it's never logged in prod. */
  private isDebugEmailOtp(): boolean {
    return this.config.get<string>('NODE_ENV') !== 'production';
  }

  private async issueEmailVerificationOtp(email: string, name: string): Promise<void> {
    this.logger.log(`[issueEmailVerificationOtp] Step 4a: delete previous OTP — email=${email}`);
    try {
      await this.prisma.otpVerification.deleteMany({
        where: { identifier: email, type: OtpType.EMAIL_VERIFICATION },
      });
      this.logger.log('[issueEmailVerificationOtp] Step 4a done');
    } catch (err) {
      this.logger.error(`[issueEmailVerificationOtp] Step 4a FAILED (deleteMany): ${(err as Error).message}`, (err as Error).stack);
      throw err;
    }

    this.logger.log('[issueEmailVerificationOtp] Step 4b: generate OTP');
    const otp = String(randomInt(100000, 1000000));
    const otpHash = this.hashToken(otp);
    const expiresAt = new Date(Date.now() + OTP_TTL_MS);
    this.logger.log('[issueEmailVerificationOtp] Step 4b done: OTP generated (not logged)');
    if (this.isDebugEmailOtp()) {
      this.logger.debug(`[issueEmailVerificationOtp] email=${email} otpStored(plain)=${otp} otpHashStored=${otpHash} type=${OtpType.EMAIL_VERIFICATION} expiresAt=${expiresAt.toISOString()}`);
    }

    this.logger.log('[issueEmailVerificationOtp] Step 4c: insert OtpVerification record');
    try {
      const created = await this.prisma.otpVerification.create({
        data: { identifier: email, otpHash, type: OtpType.EMAIL_VERIFICATION, expiresAt },
      });
      this.logger.log(`[issueEmailVerificationOtp] Step 4c done: OTP record created (id=${created.id})`);
    } catch (err) {
      this.logger.error(`[issueEmailVerificationOtp] Step 4c FAILED (otpVerification.create): ${(err as Error).message}`, (err as Error).stack);
      throw err;
    }

    this.logger.log(`[issueEmailVerificationOtp] Step 4d: sending OTP email via MailService — to=${email}`);
    const startedAt = Date.now();
    try {
      await this.emailService.sendEmailVerificationOtpEmail({ to: email, name, otp });
      this.logger.log(`[issueEmailVerificationOtp] Step 4d done: email sent in ${Date.now() - startedAt}ms`);
    } catch (err) {
      this.logger.error(
        `[issueEmailVerificationOtp] Step 4d FAILED (SMTP send, after ${Date.now() - startedAt}ms): ${(err as Error).message}`,
        (err as Error).stack,
      );
      if (this.config.get<string>('NODE_ENV') !== 'production') {
        this.logger.debug(`[issueEmailVerificationOtp][DEV] OTP: ${otp}`);
      }
      // Deliberately swallowed — login still returns requiresEmailVerification even if the email failed to send.
    }
  }
}
