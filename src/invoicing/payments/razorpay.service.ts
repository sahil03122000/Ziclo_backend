import * as crypto from 'crypto';
import * as https from 'https';

import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface RazorpayOrder {
  id: string;
  amount: number;
  amount_paid: number;
  amount_due: number;
  currency: string;
  receipt: string;
  status: string;
}

export type RazorpayMode = 'test' | 'live';

@Injectable()
export class RazorpayService {
  private readonly logger = new Logger(RazorpayService.name);
  private readonly keyId: string;
  private readonly keySecret: string;
  private readonly mode: RazorpayMode;

  constructor(config: ConfigService) {
    this.keyId    = config.get<string>('RAZORPAY_KEY_ID')     ?? '';
    this.keySecret = config.get<string>('RAZORPAY_KEY_SECRET') ?? '';
    this.mode      = this.keyId.startsWith('rzp_test_') ? 'test' : 'live';

    // Fail fast at application startup, not at request time. Previously a missing
    // key only produced a warning here, so the app would boot "successfully" and
    // every payment request would then fail at createOrder()/verifyPaymentSignature()
    // with a 503 — surprising the client deep into the booking flow instead of
    // surfacing the misconfiguration immediately, loudly, and to the deployer.
    if (this.keyId && this.keySecret) {
      // Never log the secret — only the key id, and only its prefix/mode, not the full value.
      const maskedKeyId = this.keyId.length > 8 ? `${this.keyId.slice(0, 8)}…${this.keyId.slice(-4)}` : this.keyId;
      this.logger.log(`✓ Razorpay configured — mode: ${this.mode.toUpperCase()}, keyId: ${maskedKeyId}`);
    } else {
      this.logger.error('✗ Razorpay NOT configured — RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET missing');
      throw new Error(
        'Razorpay payment gateway is not configured. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET ' +
          'in the environment before starting the app — refusing to boot with a broken payment gateway.',
      );
    }
  }

  // ─── Create order ─────────────────────────────────────────────────────────────

  async createOrder(amountInPaise: number, receipt: string): Promise<RazorpayOrder> {
    this.assertConfigured();

    const body  = JSON.stringify({ amount: amountInPaise, currency: 'INR', receipt });
    const creds = Buffer.from(`${this.keyId}:${this.keySecret}`).toString('base64');

    return new Promise<RazorpayOrder>((resolve, reject) => {
      const req = https.request(
        {
          hostname: 'api.razorpay.com',
          path:     '/v1/orders',
          method:   'POST',
          headers:  {
            Authorization:  `Basic ${creds}`,
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
          },
        },
        (res) => {
          let raw = '';
          res.on('data', (c) => (raw += c));
          res.on('end', () => {
            try {
              const parsed = JSON.parse(raw) as RazorpayOrder & { error?: { description?: string } };
              if ((res.statusCode ?? 0) >= 400) {
                const reason = parsed.error?.description ?? res.statusMessage ?? 'Unknown error';
                this.logger.error(`Razorpay order creation failed: ${reason}`);
                reject(new BadRequestException(`Razorpay: ${reason}`));
              } else {
                this.logger.log(`Razorpay order created — orderId: ${parsed.id}, amount: ₹${amountInPaise / 100}, mode: ${this.mode}`);
                resolve(parsed);
              }
            } catch {
              reject(new BadRequestException('Failed to parse Razorpay response'));
            }
          });
        },
      );

      req.on('error', (err) => {
        this.logger.error(`Razorpay connection failed: ${err.message}`);
        reject(new BadRequestException(`Razorpay connection failed: ${err.message}`));
      });
      req.write(body);
      req.end();
    });
  }

  // ─── Verify payment signature ─────────────────────────────────────────────────

  verifyPaymentSignature(razorpayOrderId: string, razorpayPaymentId: string, signature: string): boolean {
    this.assertConfigured();

    const expected = crypto
      .createHmac('sha256', this.keySecret)
      .update(`${razorpayOrderId}|${razorpayPaymentId}`)
      .digest('hex');

    let result = false;
    try {
      const a = Buffer.from(expected, 'hex');
      const b = Buffer.from(signature, 'hex');
      result = a.length === b.length && crypto.timingSafeEqual(a, b);
    } catch {
      result = false;
    }

    if (result) {
      this.logger.log(`Payment verified — orderId: ${razorpayOrderId}, paymentId: ${razorpayPaymentId}`);
    } else {
      this.logger.warn(`Verification failed — orderId: ${razorpayOrderId}, paymentId: ${razorpayPaymentId} — signature mismatch`);
    }

    return result;
  }

  // ─── Accessors ────────────────────────────────────────────────────────────────

  getKeyId(): string {
    this.assertConfigured();
    return this.keyId;
  }

  getMode(): RazorpayMode {
    return this.mode;
  }

  isConfigured(): boolean {
    return Boolean(this.keyId && this.keySecret);
  }

  // ─── Private ─────────────────────────────────────────────────────────────────

  private assertConfigured(): void {
    if (!this.keyId || !this.keySecret) {
      throw new ServiceUnavailableException(
        'Razorpay payment gateway is not configured. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.',
      );
    }
  }
}
