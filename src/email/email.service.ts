import { Injectable, InternalServerErrorException, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email';
const RETRY_DELAY_MS = 2000;

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

export interface BookingConfirmationEmailOptions {
  to: string;
  name: string;
  bookingRef: string;
  serviceName: string;
  scheduledDate: string;
  amount?: string;
}

export interface PaymentReceiptEmailOptions {
  to: string;
  name: string;
  bookingRef: string;
  paymentId: string;
  amount: string;
  paymentDate: string;
}

@Injectable()
export class EmailService implements OnModuleInit {
  private readonly logger = new Logger(EmailService.name);
  private readonly isDev: boolean;
  private apiKey: string | null = null;
  private senderName: string | null = null;
  private senderEmail: string | null = null;

  constructor(private readonly config: ConfigService) {
    this.isDev = this.config.get<string>('NODE_ENV') !== 'production';
  }

  onModuleInit() {
    const apiKey = this.config.get<string>('BREVO_API_KEY');
    const senderName = this.config.get<string>('BREVO_SENDER_NAME');
    const senderEmail = this.config.get<string>('BREVO_SENDER_EMAIL');

    if (!apiKey || !senderName || !senderEmail) {
      this.logger.warn(
        `Brevo email configured: NO — ${this.isDev ? 'OTPs will be logged to console (dev mode)' : 'BREVO_API_KEY, BREVO_SENDER_NAME and BREVO_SENDER_EMAIL are required in production'}`,
      );
      return;
    }

    this.apiKey = apiKey;
    this.senderName = senderName;
    this.senderEmail = senderEmail;
    this.logger.log(`Brevo email configured: YES (sender: ${senderName} <${senderEmail}>)`);
  }

  // ─── Sending (never throws — logs and returns) ─────────────────────────────────

  /** Calls the Brevo Transactional Email API, retrying once after 2s on failure. */
  private async callBrevoApi(to: string, subject: string, html: string): Promise<{ ok: true; messageId?: string } | { ok: false; error: string }> {
    const body = JSON.stringify({
      sender: { name: this.senderName, email: this.senderEmail },
      to: [{ email: to }],
      subject,
      htmlContent: html,
    });

    const attempt = async (): Promise<{ ok: true; messageId?: string } | { ok: false; error: string }> => {
      const res = await fetch(BREVO_API_URL, {
        method: 'POST',
        headers: {
          'api-key': this.apiKey as string,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body,
      });

      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        return { ok: false, error: `HTTP ${res.status}: ${errBody}` };
      }

      const json = (await res.json().catch(() => ({}))) as { messageId?: string };
      return { ok: true, messageId: json.messageId };
    };

    try {
      const first = await attempt();
      if (first.ok) return first;

      this.logger.warn(`Brevo send to ${to} failed (${first.error}) — retrying once in ${RETRY_DELAY_MS}ms`);
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));

      const second = await attempt();
      return second;
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  private async send(to: string, subject: string, html: string, logLabel: string): Promise<void> {
    if (!this.apiKey || !this.senderEmail) {
      this.logger.warn(`[${logLabel}] Brevo not configured — skipping email to ${to}`);
      return;
    }

    const startedAt = Date.now();
    const result = await this.callBrevoApi(to, subject, html);

    if (!result.ok) {
      this.logger.error(`[${logLabel}] Failed to send email to ${to} after ${Date.now() - startedAt}ms: ${result.error}`);
      return;
    }

    this.logger.log(`[${logLabel}] Email sent to ${to} in ${Date.now() - startedAt}ms (messageId=${result.messageId})`);
  }

  async sendOtp(to: string, otp: string): Promise<void> {
    if (!this.apiKey || !this.senderEmail) {
      throw new InternalServerErrorException(
        'Email is not configured. Set BREVO_API_KEY, BREVO_SENDER_NAME and BREVO_SENDER_EMAIL in environment variables.',
      );
    }

    const result = await this.callBrevoApi(to, 'Your Login OTP', this.buildOtpHtml(otp));
    if (!result.ok) {
      this.logger.error(`Failed to send OTP email to ${to}: ${result.error}`);
      throw new InternalServerErrorException(`Failed to send OTP email: ${result.error}`);
    }
    this.logger.log(`OTP email sent to ${to}`);
  }

  async sendPasswordResetEmail(opts: PasswordResetEmailOptions): Promise<void> {
    await this.send(opts.to, 'Reset your Ziclo password', this.buildPasswordResetHtml(opts), 'sendPasswordResetEmail');
  }

  /** Forgot Password OTP — logs and never throws so callers (login/register/forgot-password) never crash; the OTP row is already saved before this is called. */
  async sendPasswordResetOtpEmail(opts: PasswordResetOtpEmailOptions): Promise<void> {
    await this.send(opts.to, 'Your Ziclo password reset OTP', this.buildPasswordResetOtpHtml(opts), 'sendPasswordResetOtpEmail');
    if (this.isDev && !this.apiKey) {
      this.logger.debug(`[sendPasswordResetOtpEmail][DEV] OTP for ${opts.to}: ${opts.otp}`);
    }
  }

  async sendWelcomeEmail(opts: WelcomeEmailOptions): Promise<void> {
    const supportEmail = this.config.get<string>('SUPPORT_ADMIN_EMAIL') ?? 'support@ziclo.in';
    await this.send(opts.to, 'Welcome to Ziclo – Registration Successful', this.buildWelcomeHtml(opts, supportEmail), 'sendWelcomeEmail');
  }

  /** Email Verification OTP (login gate) — logs and never throws; the OTP row is already saved before this is called. */
  async sendEmailVerificationOtpEmail(opts: EmailVerificationOtpEmailOptions): Promise<void> {
    await this.send(opts.to, 'Verify your email - Ziclo', this.buildEmailVerificationOtpHtml(opts), 'sendEmailVerificationOtpEmail');
    if (this.isDev && !this.apiKey) {
      this.logger.debug(`[sendEmailVerificationOtpEmail][DEV] OTP for ${opts.to}: ${opts.otp}`);
    }
  }

  async sendBookingConfirmationEmail(opts: BookingConfirmationEmailOptions): Promise<void> {
    await this.send(opts.to, `Booking Confirmed – ${opts.bookingRef}`, this.buildBookingConfirmationHtml(opts), 'sendBookingConfirmationEmail');
  }

  async sendPaymentReceiptEmail(opts: PaymentReceiptEmailOptions): Promise<void> {
    await this.send(opts.to, `Payment Receipt – ${opts.bookingRef}`, this.buildPaymentReceiptHtml(opts), 'sendPaymentReceiptEmail');
  }

  async sendSupportTicketCreatedToCustomer(opts: SupportTicketCustomerEmailOptions): Promise<void> {
    await this.send(opts.to, 'Support Ticket Created', this.buildSupportTicketCustomerHtml(opts), 'sendSupportTicketCreatedToCustomer');
  }

  async sendNewSupportTicketAlertToAdmin(opts: SupportTicketAdminAlertOptions): Promise<void> {
    const adminEmail = this.config.get<string>('SUPPORT_ADMIN_EMAIL') ?? 'sahil84330@gmail.com';
    await this.send(adminEmail, 'New Support Ticket Raised', this.buildSupportTicketAdminAlertHtml(opts), 'sendNewSupportTicketAlertToAdmin');
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
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Verify your email - Ziclo</title></head>
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

  private buildBookingConfirmationHtml(opts: BookingConfirmationEmailOptions): string {
    const firstName = opts.name.split(' ')[0];
    return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Booking Confirmed</title></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:40px 16px">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px">
        <tr><td align="center" style="padding-bottom:24px">
          <span style="font-size:26px;font-weight:800;color:#2563eb;letter-spacing:-0.5px">Ziclo</span>
        </td></tr>
        <tr><td style="background:#ffffff;border-radius:12px;box-shadow:0 2px 12px rgba(0,0,0,0.08);overflow:hidden">
          <table width="100%" cellpadding="0" cellspacing="0"><tr><td style="background:#16a34a;height:4px"></td></tr></table>
          <table width="100%" cellpadding="0" cellspacing="0" style="padding:36px 40px">
            <tr><td>
              <p style="font-size:22px;font-weight:700;color:#111827;margin:0 0 8px">Booking Confirmed</p>
              <p style="font-size:15px;color:#6b7280;margin:0 0 24px">Hi ${firstName}, your booking has been confirmed.</p>
              <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:8px;margin:0 0 24px">
                <tr><td style="padding:12px 16px;border-bottom:1px solid #e5e7eb;background:#f9fafb">
                  <span style="font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px">Booking Reference</span>
                  <p style="font-size:18px;font-weight:700;color:#2563eb;margin:4px 0 0">${opts.bookingRef}</p>
                </td></tr>
                <tr><td style="padding:12px 16px;border-bottom:1px solid #e5e7eb">
                  <span style="font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px">Service</span>
                  <p style="font-size:14px;color:#111827;margin:4px 0 0">${opts.serviceName}</p>
                </td></tr>
                <tr><td style="padding:12px 16px;${opts.amount ? 'border-bottom:1px solid #e5e7eb' : ''}">
                  <span style="font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px">Scheduled Date</span>
                  <p style="font-size:14px;color:#111827;margin:4px 0 0">${opts.scheduledDate}</p>
                </td></tr>
                ${opts.amount ? `<tr><td style="padding:12px 16px">
                  <span style="font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px">Amount</span>
                  <p style="font-size:14px;color:#111827;margin:4px 0 0">${opts.amount}</p>
                </td></tr>` : ''}
              </table>
              <p style="font-size:13px;color:#6b7280;margin:0">We'll notify you once your service provider is on the way.</p>
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

  private buildPaymentReceiptHtml(opts: PaymentReceiptEmailOptions): string {
    const firstName = opts.name.split(' ')[0];
    return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Payment Receipt</title></head>
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
              <p style="font-size:22px;font-weight:700;color:#111827;margin:0 0 8px">Payment Receipt</p>
              <p style="font-size:15px;color:#6b7280;margin:0 0 24px">Hi ${firstName}, thanks for your payment. Here's your receipt.</p>
              <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:8px;margin:0 0 24px">
                <tr><td style="padding:12px 16px;border-bottom:1px solid #e5e7eb;background:#f9fafb">
                  <span style="font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px">Amount Paid</span>
                  <p style="font-size:18px;font-weight:700;color:#2563eb;margin:4px 0 0">${opts.amount}</p>
                </td></tr>
                <tr><td style="padding:12px 16px;border-bottom:1px solid #e5e7eb">
                  <span style="font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px">Booking Reference</span>
                  <p style="font-size:14px;color:#111827;margin:4px 0 0">${opts.bookingRef}</p>
                </td></tr>
                <tr><td style="padding:12px 16px;border-bottom:1px solid #e5e7eb">
                  <span style="font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px">Payment ID</span>
                  <p style="font-size:14px;color:#111827;margin:4px 0 0">${opts.paymentId}</p>
                </td></tr>
                <tr><td style="padding:12px 16px">
                  <span style="font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px">Date</span>
                  <p style="font-size:14px;color:#111827;margin:4px 0 0">${opts.paymentDate}</p>
                </td></tr>
              </table>
              <p style="font-size:13px;color:#6b7280;margin:0">Keep this receipt for your records.</p>
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
}
