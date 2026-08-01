import {
  Injectable,
  InternalServerErrorException,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface Msg91OtpPayload {
  mobile: string;
  template_id: string;
  sender: string;
  otp: string;
  otp_expiry: number;
  otp_length: number;
}

interface Msg91Response {
  type: 'success' | 'error';
  message: string;
}

// MSG91 error substrings that indicate a DLT configuration problem.
// These are delivery-time failures — the API call itself may have returned 200.
const DLT_ERROR_PATTERNS = [
  'dlt template',
  'dlt scrubbing',
  'template not found',
  'template id not found',
  'sender not found',
  'sender id not found',
  'entity not found',
];

@Injectable()
export class SmsService implements OnModuleInit {
  private readonly logger = new Logger(SmsService.name);
  private readonly isDev: boolean;

  constructor(private readonly config: ConfigService) {
    this.isDev = this.config.get<string>('NODE_ENV') !== 'production';
  }

  // Logs provider status once at startup so missing credentials are immediately visible.
  onModuleInit() {
    const authKey = this.config.get<string>('MSG91_AUTH_KEY');
    if (!authKey) {
      if (this.isDev) {
        this.logger.warn(
          'MSG91_AUTH_KEY is not set — OTPs will be printed to the console (dev mode).',
        );
      } else {
        this.logger.error(
          'MSG91_AUTH_KEY is required in production. Set it in your environment variables.',
        );
      }
    } else {
      this.logger.log('MSG91 SMS provider ready.');
    }
  }

  async send(phone: string, otp: string): Promise<void> {
    const authKey = this.config.get<string>('MSG91_AUTH_KEY');

    if (!authKey) {
      if (!this.isDev) {
        throw new InternalServerErrorException(
          'SMS provider is not configured. Contact the administrator.',
        );
      }
      // DEVELOPMENT ONLY — OTP is logged to console when MSG91 is not configured.
      // In production this branch is unreachable: authKey is always required.
      this.logger.warn(`[DEV-SMS] MSG91 not configured. OTP for ${phone}: ${otp}`); // DEVELOPMENT ONLY
      return;
    }

    await this.sendViaMsg91(phone, otp, authKey);
  }

  // ─── MSG91 ───────────────────────────────────────────────────────────────────

  private async sendViaMsg91(
    phone: string,
    otp: string,
    authKey: string,
  ): Promise<void> {
    const templateId = this.config.getOrThrow<string>('MSG91_TEMPLATE_ID');
    const senderId = this.config.get<string>('MSG91_SENDER_ID') ?? 'OTPSMS';

    // MSG91 expects E.164 without the leading '+': +919876543210 → 919876543210
    const mobile = phone.replace(/^\+/, '');

    const payload: Msg91OtpPayload = {
      mobile,
      template_id: templateId,
      sender: senderId,
      otp,
      otp_expiry: 5,
      otp_length: 6,
    };

    this.logger.log(
      `MSG91 → POST https://control.msg91.com/api/v5/otp | mobile: ${mobile} | template: ${templateId} | sender: ${senderId}`,
    );

    let response: Response;
    try {
      response = await fetch('https://control.msg91.com/api/v5/otp', {
        method: 'POST',
        headers: {
          authkey: authKey,
          'content-type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
    } catch (err) {
      this.logger.error(`MSG91 network error: ${(err as Error).message}`);
      throw new InternalServerErrorException('Failed to send OTP. Please try again.');
    }

    let result: Msg91Response;
    try {
      result = (await response.json()) as Msg91Response;
    } catch {
      this.logger.error(`MSG91 invalid JSON response [HTTP ${response.status}]`);
      throw new InternalServerErrorException('Failed to send OTP. Please try again.');
    }

    // Always log the full raw response so failures are diagnosable in server logs.
    this.logger.log(
      `MSG91 ← [HTTP ${response.status}] ${JSON.stringify(result)}`,
    );

    if (!response.ok || result.type !== 'success') {
      this.handleMsg91Error(result, templateId, senderId);
    }

    this.logger.log(`MSG91 OTP dispatched to ${mobile} | request_id: ${result.message}`);
  }

  // Classifies the MSG91 error and logs an actionable message before throwing.
  private handleMsg91Error(
    result: Msg91Response,
    templateId: string,
    senderId: string,
  ): never {
    const lowerMessage = (result.message ?? '').toLowerCase();
    const isDltError = DLT_ERROR_PATTERNS.some((p) => lowerMessage.includes(p));

    if (isDltError) {
      this.logger.error(
        `MSG91 DLT error — template_id "${templateId}" or sender_id "${senderId}" ` +
          `is not registered / approved on the TRAI DLT portal.\n` +
          `Steps to fix:\n` +
          `  1. Log in to https://msg91.com → Sender ID → verify "${senderId}" is active.\n` +
          `  2. Go to DLT → Templates → confirm template "${templateId}" is approved.\n` +
          `  3. Ensure the template content matches what is registered on DLT exactly.\n` +
          `MSG91 raw response: ${JSON.stringify(result)}`,
      );
      throw new InternalServerErrorException(
        'SMS delivery failed: DLT template or sender not configured correctly. Contact administrator.',
      );
    }

    this.logger.error(
      `MSG91 send failed: ${JSON.stringify(result)}`,
    );
    throw new InternalServerErrorException('Failed to send OTP. Please try again.');
  }
}
