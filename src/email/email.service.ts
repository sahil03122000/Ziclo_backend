import {
  Injectable,
  InternalServerErrorException,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

export interface SupportTicketCustomerEmailOptions {
  to:           string;
  customerName: string;
  ticketNumber: string;
  subject:      string;
  priority:     string;
  status:       string;
}

export interface SupportTicketAdminAlertOptions {
  ticketNumber:  string;
  customerName:  string;
  customerEmail: string;
  bookingRef:    string | null;
  subject:       string;
  description:   string;
  priority:      string;
  status:        string;
}

export interface PasswordResetEmailOptions {
  to: string;
  name: string;
  resetUrl: string;
}

export interface PasswordResetOtpEmailOptions {
  to: string;
  name: string;
  otp: string;
}

export interface WelcomeEmailOptions {
  to: string;
  name: string;
}

export interface EmailVerificationOtpEmailOptions {
  to: string;
  name: string;
  otp: string;
}

@Injectable()
export class EmailService implements OnModuleInit {
  private readonly logger = new Logger(EmailService.name);
  private readonly isDev: boolean;
  private transporter: nodemailer.Transporter | null = null;

  constructor(private readonly config: ConfigService) {
    this.isDev = this.config.get<string>('NODE_ENV') !== 'production';
  }

  onModuleInit() {
    const host = this.config.get<string>('MAIL_HOST');
    if (!host) {
      this.logger.warn(
        `Email SMTP configured: NO — ${this.isDev ? 'OTPs will be logged to console (dev mode)' : 'MAIL_HOST is required in production'}`,
      );
      return;
    }

    this.transporter = nodemailer.createTransport({
      host,
      port: this.config.get<number>('MAIL_PORT') ?? 587,
      secure: false, // STARTTLS on port 587
      auth: {
        user: this.config.getOrThrow<string>('MAIL_USER'),
        pass: this.config.getOrThrow<string>('MAIL_PASSWORD'),
      },
      // Bounded so a slow/unreachable SMTP host fails fast instead of hanging the request.
      connectionTimeout: 8000,
      greetingTimeout: 8000,
      socketTimeout: 10000,
    });

    this.logger.log(`Email SMTP configured: YES (host: ${host}:${this.config.get<number>('MAIL_PORT') ?? 587})`);
  }

  async sendOtp(to: string, otp: string): Promise<void> {
    if (!this.transporter) {
      throw new InternalServerErrorException(
        'Email SMTP is not configured. Set MAIL_HOST, MAIL_PORT, MAIL_USER, MAIL_PASSWORD in environment variables.',
      );
    }

    const from =
      this.config.get<string>('MAIL_FROM') ?? this.config.get<string>('MAIL_USER');

    this.logger.log(`Sending OTP email to ${to}...`);

    try {
      const info = await this.transporter.sendMail({
        from: `"Ziclo" <${from}>`,
        to,
        subject: 'Your Login OTP',
        html: this.buildOtpHtml(otp),
      });
      this.logger.log(`Email sent successfully to ${to}`);
      this.logger.log(`Brevo Message ID: ${info.messageId}`);
    } catch (err) {
      const error = err as Error;
      this.logger.error(`Failed to send OTP email to ${to}: ${error.message}`, error.stack);
      throw new InternalServerErrorException(`Failed to send OTP email: ${error.message}`);
    }
  }

  async sendPasswordResetEmail(opts: PasswordResetEmailOptions): Promise<void> {
    if (!this.transporter) {
      throw new InternalServerErrorException(
        'Email SMTP is not configured. Set MAIL_HOST, MAIL_PORT, MAIL_USER, MAIL_PASSWORD in environment variables.',
      );
    }

    const from =
      this.config.get<string>('MAIL_FROM') ?? this.config.get<string>('MAIL_USER');

    this.logger.log(`Sending password reset email to ${opts.to}...`);

    try {
      const info = await this.transporter.sendMail({
        from: `"Ziclo" <${from}>`,
        to: opts.to,
        subject: 'Reset your Ziclo password',
        html: this.buildPasswordResetHtml(opts),
      });
      this.logger.log(`Password reset email sent to ${opts.to} (messageId=${info.messageId as string})`);
    } catch (err) {
      const error = err as Error;
      this.logger.error(`Failed to send password reset email to ${opts.to}: ${error.message}`, error.stack);
      throw new InternalServerErrorException(`Failed to send password reset email: ${error.message}`);
    }
  }

  async sendPasswordResetOtpEmail(opts: PasswordResetOtpEmailOptions): Promise<void> {
    if (!this.transporter) {
      throw new InternalServerErrorException(
        'Email SMTP is not configured. Set MAIL_HOST, MAIL_PORT, MAIL_USER, MAIL_PASSWORD in environment variables.',
      );
    }

    const from =
      this.config.get<string>('MAIL_FROM') ?? this.config.get<string>('MAIL_USER');

    this.logger.log(`Sending password reset OTP email to ${opts.to}...`);

    try {
      const info = await this.transporter.sendMail({
        from: `"Ziclo" <${from}>`,
        to: opts.to,
        subject: 'Your Ziclo password reset OTP',
        html: this.buildPasswordResetOtpHtml(opts),
      });
      this.logger.log(`Password reset OTP email sent to ${opts.to} (messageId=${info.messageId as string})`);
    } catch (err) {
      const error = err as Error;
      this.logger.error(`Failed to send password reset OTP email to ${opts.to}: ${error.message}`, error.stack);
      throw new InternalServerErrorException(`Failed to send password reset OTP email: ${error.message}`);
    }
  }

  async sendWelcomeEmail(opts: WelcomeEmailOptions): Promise<void> {
    if (!this.transporter) {
      this.logger.warn('Email not configured — skipping welcome email');
      return;
    }
    const from = this.config.get<string>('MAIL_FROM') ?? this.config.get<string>('MAIL_USER');
    const supportEmail = this.config.get<string>('SUPPORT_ADMIN_EMAIL') ?? 'support@ziclo.in';
    try {
      await this.transporter.sendMail({
        from: `"Ziclo" <${from}>`,
        to: opts.to,
        subject: 'Welcome to Ziclo – Registration Successful',
        html: this.buildWelcomeHtml(opts, supportEmail),
      });
      this.logger.log(`Welcome email sent to ${opts.to}`);
    } catch (err) {
      this.logger.error(`Failed to send welcome email to ${opts.to}: ${(err as Error).message}`);
    }
  }

  async sendEmailVerificationOtpEmail(opts: EmailVerificationOtpEmailOptions): Promise<void> {
    if (!this.transporter) {
      throw new InternalServerErrorException(
        'Email SMTP is not configured. Set MAIL_HOST, MAIL_PORT, MAIL_USER, MAIL_PASSWORD in environment variables.',
      );
    }
    const from = this.config.get<string>('MAIL_FROM') ?? this.config.get<string>('MAIL_USER');
    this.logger.log(`[sendEmailVerificationOtpEmail] Step: connecting to SMTP host and sending to ${opts.to}...`);
    const startedAt = Date.now();
    try {
      const info = await this.transporter.sendMail({
        from: `"Ziclo" <${from}>`,
        to: opts.to,
        subject: 'Verify your Ziclo email address',
        html: this.buildEmailVerificationOtpHtml(opts),
      });
      this.logger.log(
        `[sendEmailVerificationOtpEmail] Step done: sent to ${opts.to} in ${Date.now() - startedAt}ms (messageId=${info.messageId as string})`,
      );
    } catch (err) {
      const error = err as Error;
      this.logger.error(
        `[sendEmailVerificationOtpEmail] Step FAILED after ${Date.now() - startedAt}ms (SMTP error/timeout) for ${opts.to}: ${error.message}`,
        error.stack,
      );
      throw new InternalServerErrorException(`Failed to send email verification OTP: ${error.message}`);
    }
  }

  async sendSupportTicketCreatedToCustomer(opts: SupportTicketCustomerEmailOptions): Promise<void> {
    if (!this.transporter) {
      this.logger.warn('Email not configured — skipping support ticket customer notification');
      return;
    }
    const from = this.config.get<string>('MAIL_FROM') ?? this.config.get<string>('MAIL_USER');
    try {
      await this.transporter.sendMail({
        from:    `"Ziclo Support" <${from}>`,
        to:      opts.to,
        subject: 'Support Ticket Created',
        html:    this.buildSupportTicketCustomerHtml(opts),
      });
      this.logger.log(`Support ticket created email sent to ${opts.to} (${opts.ticketNumber})`);
    } catch (err) {
      this.logger.error(`Failed to send support ticket email to ${opts.to}: ${(err as Error).message}`);
    }
  }

  async sendNewSupportTicketAlertToAdmin(opts: SupportTicketAdminAlertOptions): Promise<void> {
    if (!this.transporter) {
      this.logger.warn('Email not configured — skipping support ticket admin alert');
      return;
    }
    const from = this.config.get<string>('MAIL_FROM') ?? this.config.get<string>('MAIL_USER');
    const adminEmail = this.config.get<string>('SUPPORT_ADMIN_EMAIL') ?? 'sahil84330@gmail.com';
    try {
      await this.transporter.sendMail({
        from:    `"Ziclo Support" <${from}>`,
        to:      adminEmail,
        subject: 'New Support Ticket Raised',
        html:    this.buildSupportTicketAdminAlertHtml(opts),
      });
      this.logger.log(`Support ticket admin alert sent (${opts.ticketNumber})`);
    } catch (err) {
      this.logger.error(`Failed to send support ticket admin alert: ${(err as Error).message}`);
    }
  }

  // ─── HTML builders ────────────────────────────────────────────────────────────

  private buildSupportTicketCustomerHtml(opts: SupportTicketCustomerEmailOptions): string {
    const firstName = opts.customerName.split(' ')[0];
    return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Support Ticket Created</title></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:40px 16px">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px">
        <tr><td align="center" style="padding-bottom:24px">
          <span style="font-size:26px;font-weight:800;color:#2563eb;letter-spacing:-0.5px">Ziclo</span>
        </td></tr>
        <tr><td style="background:#ffffff;border-radius:12px;box-shadow:0 2px 12px rgba(0,0,0,0.08);overflow:hidden">
          <table width="100%" cellpadding="0" cellspacing="0"><tr><td style="background:#2563eb;height:4px"></td></tr></table>
          <table width="100%" cellpadding="0" cellspacing="0" style="padding:36px 40px">
            <tr><td>
              <p style="font-size:22px;font-weight:700;color:#111827;margin:0 0 8px">Your Support Ticket Has Been Created</p>
              <p style="font-size:15px;color:#6b7280;margin:0 0 24px">Hi ${firstName}, we have received your support request and our team will get back to you soon.</p>
              <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:8px;margin:0 0 24px">
                <tr><td style="padding:12px 16px;border-bottom:1px solid #e5e7eb;background:#f9fafb">
                  <span style="font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px">Ticket Number</span>
                  <p style="font-size:18px;font-weight:700;color:#2563eb;margin:4px 0 0">${opts.ticketNumber}</p>
                </td></tr>
                <tr><td style="padding:12px 16px;border-bottom:1px solid #e5e7eb">
                  <span style="font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px">Subject</span>
                  <p style="font-size:14px;color:#111827;margin:4px 0 0">${opts.subject}</p>
                </td></tr>
                <tr><td style="padding:12px 16px;border-bottom:1px solid #e5e7eb">
                  <span style="font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px">Priority</span>
                  <p style="font-size:14px;color:#111827;margin:4px 0 0">${opts.priority}</p>
                </td></tr>
                <tr><td style="padding:12px 16px">
                  <span style="font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px">Status</span>
                  <p style="font-size:14px;color:#111827;margin:4px 0 0">${opts.status}</p>
                </td></tr>
              </table>
              <p style="font-size:13px;color:#6b7280;margin:0">Please keep this ticket number for reference. Our support team will reach out to you.</p>
            </td></tr>
          </table>
        </td></tr>
        <tr><td align="center" style="padding-top:24px">
          <p style="font-size:12px;color:#9ca3af;margin:0">© ${new Date().getFullYear()} Ziclo. All rights reserved.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
  }

  private buildSupportTicketAdminAlertHtml(opts: SupportTicketAdminAlertOptions): string {
    return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>New Support Ticket</title></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:40px 16px">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px">
        <tr><td align="center" style="padding-bottom:24px">
          <span style="font-size:26px;font-weight:800;color:#2563eb;letter-spacing:-0.5px">Ziclo Support</span>
        </td></tr>
        <tr><td style="background:#ffffff;border-radius:12px;box-shadow:0 2px 12px rgba(0,0,0,0.08);overflow:hidden">
          <table width="100%" cellpadding="0" cellspacing="0"><tr><td style="background:#dc2626;height:4px"></td></tr></table>
          <table width="100%" cellpadding="0" cellspacing="0" style="padding:36px 40px">
            <tr><td>
              <p style="font-size:22px;font-weight:700;color:#111827;margin:0 0 4px">New Support Ticket Raised</p>
              <p style="font-size:15px;color:#6b7280;margin:0 0 24px">A new support ticket has been created by an admin.</p>
              <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:8px;margin:0 0 24px">
                <tr><td style="padding:12px 16px;border-bottom:1px solid #e5e7eb;background:#fef2f2">
                  <span style="font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px">Ticket Number</span>
                  <p style="font-size:18px;font-weight:700;color:#dc2626;margin:4px 0 0">${opts.ticketNumber}</p>
                </td></tr>
                <tr><td style="padding:12px 16px;border-bottom:1px solid #e5e7eb">
                  <span style="font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px">Customer</span>
                  <p style="font-size:14px;color:#111827;margin:4px 0 0">${opts.customerName} &lt;${opts.customerEmail}&gt;</p>
                </td></tr>
                ${opts.bookingRef ? `<tr><td style="padding:12px 16px;border-bottom:1px solid #e5e7eb">
                  <span style="font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px">Booking</span>
                  <p style="font-size:14px;color:#111827;margin:4px 0 0">${opts.bookingRef}</p>
                </td></tr>` : ''}
                <tr><td style="padding:12px 16px;border-bottom:1px solid #e5e7eb">
                  <span style="font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px">Subject</span>
                  <p style="font-size:14px;color:#111827;margin:4px 0 0">${opts.subject}</p>
                </td></tr>
                <tr><td style="padding:12px 16px;border-bottom:1px solid #e5e7eb">
                  <span style="font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px">Description</span>
                  <p style="font-size:14px;color:#111827;margin:4px 0 0">${opts.description}</p>
                </td></tr>
                <tr><td style="padding:12px 16px;border-bottom:1px solid #e5e7eb">
                  <span style="font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px">Priority</span>
                  <p style="font-size:14px;color:#111827;margin:4px 0 0">${opts.priority}</p>
                </td></tr>
                <tr><td style="padding:12px 16px">
                  <span style="font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px">Status</span>
                  <p style="font-size:14px;color:#111827;margin:4px 0 0">${opts.status}</p>
                </td></tr>
              </table>
            </td></tr>
          </table>
        </td></tr>
        <tr><td align="center" style="padding-top:24px">
          <p style="font-size:12px;color:#9ca3af;margin:0">© ${new Date().getFullYear()} Ziclo. Internal notification — do not forward.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
  }

  private buildWelcomeHtml(opts: WelcomeEmailOptions, supportEmail: string): string {
    const firstName = opts.name.split(' ')[0];
    return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Welcome to Ziclo</title></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:40px 16px">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px">
        <tr><td align="center" style="padding-bottom:24px">
          <span style="font-size:26px;font-weight:800;color:#2563eb;letter-spacing:-0.5px">Ziclo</span>
        </td></tr>
        <tr><td style="background:#ffffff;border-radius:12px;box-shadow:0 2px 12px rgba(0,0,0,0.08);overflow:hidden">
          <table width="100%" cellpadding="0" cellspacing="0"><tr><td style="background:#2563eb;height:4px"></td></tr></table>
          <table width="100%" cellpadding="0" cellspacing="0" style="padding:36px 40px">
            <tr><td>
              <p style="font-size:22px;font-weight:700;color:#111827;margin:0 0 8px">Welcome to Ziclo, ${firstName}!</p>
              <p style="font-size:15px;color:#6b7280;margin:0 0 20px">
                Your registration was successful. We're glad to have you on board.
              </p>
              <p style="font-size:14px;color:#374151;margin:0 0 20px">
                You can now log in to your Ziclo account using your registered email and password to start booking services.
              </p>
              <p style="font-size:13px;color:#6b7280;margin:0">
                Need help? Reach us at <a href="mailto:${supportEmail}" style="color:#2563eb">${supportEmail}</a>.
              </p>
            </td></tr>
          </table>
        </td></tr>
        <tr><td align="center" style="padding-top:24px">
          <p style="font-size:12px;color:#9ca3af;margin:0">© ${new Date().getFullYear()} Ziclo. All rights reserved.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
  }

  private buildEmailVerificationOtpHtml(opts: EmailVerificationOtpEmailOptions): string {
    const firstName = opts.name.split(' ')[0];
    return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Verify your Ziclo email</title></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:40px 16px">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px">
        <tr><td align="center" style="padding-bottom:24px">
          <span style="font-size:26px;font-weight:800;color:#2563eb;letter-spacing:-0.5px">Ziclo</span>
        </td></tr>
        <tr><td style="background:#ffffff;border-radius:12px;box-shadow:0 2px 12px rgba(0,0,0,0.08);overflow:hidden">
          <table width="100%" cellpadding="0" cellspacing="0"><tr><td style="background:#2563eb;height:4px"></td></tr></table>
          <table width="100%" cellpadding="0" cellspacing="0" style="padding:36px 40px">
            <tr><td>
              <p style="font-size:22px;font-weight:700;color:#111827;margin:0 0 8px">Verify your email</p>
              <p style="font-size:15px;color:#6b7280;margin:0 0 28px">
                Hi ${firstName}, use the OTP below to verify your Ziclo account email.
              </p>
              <div style="text-align:center;margin:0 0 28px">
                <span style="display:inline-block;font-size:40px;font-weight:800;letter-spacing:12px;color:#2563eb;padding:18px 28px;background:#eff6ff;border-radius:10px">
                  ${opts.otp}
                </span>
              </div>
              <p style="font-size:13px;color:#854d0e;margin:0 0 24px;background:#fef9c3;border-radius:8px;border-left:3px solid #eab308;padding:12px 16px">
                ⏱ This OTP expires in <strong>10 minutes</strong>.
              </p>
              <p style="font-size:13px;color:#6b7280;margin:0">
                Do not share this code with anyone. If you did not request this, please ignore this email.
              </p>
            </td></tr>
          </table>
        </td></tr>
        <tr><td align="center" style="padding-top:24px">
          <p style="font-size:12px;color:#9ca3af;margin:0">© ${new Date().getFullYear()} Ziclo. All rights reserved.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
  }

  private buildOtpHtml(otp: string): string {
    return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /></head>
<body style="font-family:Arial,sans-serif;background:#f4f4f4;padding:24px;margin:0">
  <div style="max-width:480px;margin:auto;background:#ffffff;padding:36px;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,0.08)">
    <h2 style="margin:0 0 16px;color:#111827;font-size:20px">Your Login OTP</h2>
    <p style="color:#374151;font-size:15px;margin:0 0 28px">
      Use the code below to complete your login. It expires in <strong>5 minutes</strong>.
    </p>
    <div style="text-align:center;margin:0 0 28px">
      <span style="display:inline-block;font-size:38px;font-weight:700;letter-spacing:10px;color:#2563eb;padding:16px 24px;background:#eff6ff;border-radius:8px">
        ${otp}
      </span>
    </div>
    <p style="color:#6b7280;font-size:13px;margin:0">
      Do not share this code with anyone. If you did not request this OTP, please ignore this email.
    </p>
  </div>
</body>
</html>`;
  }

  private buildPasswordResetOtpHtml(opts: PasswordResetOtpEmailOptions): string {
    const firstName = opts.name.split(' ')[0];
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Your Ziclo password reset OTP</title>
</head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:40px 16px">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px">

          <!-- Header -->
          <tr>
            <td align="center" style="padding-bottom:24px">
              <span style="font-size:26px;font-weight:800;color:#2563eb;letter-spacing:-0.5px">Ziclo</span>
            </td>
          </tr>

          <!-- Card -->
          <tr>
            <td style="background:#ffffff;border-radius:12px;box-shadow:0 2px 12px rgba(0,0,0,0.08);overflow:hidden">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr><td style="background:#2563eb;height:4px"></td></tr>
              </table>
              <table width="100%" cellpadding="0" cellspacing="0" style="padding:36px 40px">
                <tr>
                  <td>
                    <p style="font-size:22px;font-weight:700;color:#111827;margin:0 0 8px">Password Reset OTP</p>
                    <p style="font-size:15px;color:#6b7280;margin:0 0 28px">
                      Hi ${firstName}, use the OTP below to reset your Ziclo account password.
                    </p>

                    <!-- OTP box -->
                    <div style="text-align:center;margin:0 0 28px">
                      <span style="display:inline-block;font-size:40px;font-weight:800;letter-spacing:12px;color:#2563eb;padding:18px 28px;background:#eff6ff;border-radius:10px">
                        ${opts.otp}
                      </span>
                    </div>

                    <!-- Expiry notice -->
                    <table cellpadding="0" cellspacing="0" style="margin:0 0 24px;background:#fef9c3;border-radius:8px;border-left:3px solid #eab308;width:100%">
                      <tr>
                        <td style="padding:12px 16px;font-size:13px;color:#854d0e">
                          ⏱ This OTP expires in <strong>10 minutes</strong>. Request a new one if it has expired.
                        </td>
                      </tr>
                    </table>

                    <!-- Divider -->
                    <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px">
                      <tr><td style="border-top:1px solid #e5e7eb"></td></tr>
                    </table>

                    <!-- Security warning -->
                    <table cellpadding="0" cellspacing="0" style="background:#fef2f2;border-radius:8px;border-left:3px solid #ef4444;width:100%">
                      <tr>
                        <td style="padding:12px 16px;font-size:13px;color:#991b1b">
                          🔒 <strong>Security notice:</strong> Never share this OTP with anyone.
                          If you did not request a password reset, you can safely ignore this email — your account is safe.
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="padding-top:24px">
              <p style="font-size:12px;color:#9ca3af;margin:0">© ${new Date().getFullYear()} Ziclo. All rights reserved.</p>
              <p style="font-size:12px;color:#9ca3af;margin:4px 0 0">This email was sent to ${opts.to}</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
  }

  private buildPasswordResetHtml(opts: PasswordResetEmailOptions): string {
    const firstName = opts.name.split(' ')[0];
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Reset your Ziclo password</title>
</head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:40px 16px">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px">

          <!-- Header -->
          <tr>
            <td align="center" style="padding-bottom:24px">
              <span style="font-size:26px;font-weight:800;color:#2563eb;letter-spacing:-0.5px">Ziclo</span>
            </td>
          </tr>

          <!-- Card -->
          <tr>
            <td style="background:#ffffff;border-radius:12px;box-shadow:0 2px 12px rgba(0,0,0,0.08);overflow:hidden">

              <!-- Blue bar -->
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="background:#2563eb;height:4px"></td>
                </tr>
              </table>

              <!-- Body -->
              <table width="100%" cellpadding="0" cellspacing="0" style="padding:36px 40px">
                <tr>
                  <td>
                    <p style="font-size:22px;font-weight:700;color:#111827;margin:0 0 8px">
                      Reset your password
                    </p>
                    <p style="font-size:15px;color:#6b7280;margin:0 0 28px">
                      Hi ${firstName}, we received a request to reset your Ziclo account password.
                    </p>

                    <!-- CTA button -->
                    <table cellpadding="0" cellspacing="0" style="margin:0 0 28px">
                      <tr>
                        <td style="border-radius:8px;background:#2563eb">
                          <a href="${opts.resetUrl}"
                             target="_blank"
                             style="display:inline-block;padding:14px 32px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:8px">
                            Reset Password
                          </a>
                        </td>
                      </tr>
                    </table>

                    <!-- Expiry notice -->
                    <table cellpadding="0" cellspacing="0" style="margin:0 0 24px;background:#fef9c3;border-radius:8px;border-left:3px solid #eab308;width:100%">
                      <tr>
                        <td style="padding:12px 16px;font-size:13px;color:#854d0e">
                          ⏱ This link expires in <strong>15 minutes</strong>. If it has expired, request a new one.
                        </td>
                      </tr>
                    </table>

                    <!-- Fallback URL -->
                    <p style="font-size:13px;color:#6b7280;margin:0 0 6px">
                      If the button doesn't work, copy and paste this URL into your browser:
                    </p>
                    <p style="font-size:12px;color:#2563eb;word-break:break-all;margin:0 0 28px">
                      ${opts.resetUrl}
                    </p>

                    <!-- Divider -->
                    <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px">
                      <tr><td style="border-top:1px solid #e5e7eb"></td></tr>
                    </table>

                    <!-- Security warning -->
                    <table cellpadding="0" cellspacing="0" style="background:#fef2f2;border-radius:8px;border-left:3px solid #ef4444;width:100%">
                      <tr>
                        <td style="padding:12px 16px;font-size:13px;color:#991b1b">
                          🔒 <strong>Security notice:</strong> Ziclo will never ask you for your password.
                          If you did not request this reset, please ignore this email — your account is safe.
                          Never share this link with anyone.
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="padding-top:24px">
              <p style="font-size:12px;color:#9ca3af;margin:0">
                © ${new Date().getFullYear()} Ziclo. All rights reserved.
              </p>
              <p style="font-size:12px;color:#9ca3af;margin:4px 0 0">
                This email was sent to ${opts.to}
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
  }
}
