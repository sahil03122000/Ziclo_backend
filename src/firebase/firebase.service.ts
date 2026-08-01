import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

import { cert, getApps, initializeApp } from 'firebase-admin/app';
import type { App, ServiceAccount } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import type { Auth, DecodedIdToken } from 'firebase-admin/auth';
import { getMessaging } from 'firebase-admin/messaging';
import type { Messaging, Message, MulticastMessage } from 'firebase-admin/messaging';

import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface FcmSendResult {
  successCount: number;
  failureCount: number;
  invalidTokens: string[];
}

export interface TopicResult {
  successCount: number;
  failureCount: number;
}

export interface FirebaseTokenPayload {
  uid: string;
  email?: string;
  phone?: string;
  emailVerified?: boolean;
  name?: string;
}

// Codes that indicate the token is permanently dead and should be deactivated
const DEAD_TOKEN_CODES = new Set([
  'messaging/invalid-registration-token',
  'messaging/registration-token-not-registered',
]);

const APP_NAME = 'ziclo';

@Injectable()
export class FirebaseService {
  private readonly logger = new Logger(FirebaseService.name);
  private messaging: Messaging | null = null;
  private auth: Auth | null = null;
  private readonly _configured: boolean;

  constructor(config: ConfigService) {
    const credential = this.resolveCredential(config);
    if (!credential) {
      this.logger.warn(
        'Firebase credentials not found — set FIREBASE_SERVICE_ACCOUNT or FIREBASE_SERVICE_ACCOUNT_PATH, ' +
          'or place the key file at firebase/service-account.json',
      );
      this._configured = false;
      return;
    }

    try {
      // Guard against double-init on hot-reload
      const existing: App | undefined = getApps().find((a) => a.name === APP_NAME);
      const app = existing ?? initializeApp({ credential: cert(credential) }, APP_NAME);

      this.messaging = getMessaging(app);
      this.auth = getAuth(app);
      this._configured = true;
      this.logger.log('Firebase Admin initialized — push notifications and token verification enabled');
    } catch (err: unknown) {
      this.logger.error(
        `Firebase Admin init failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      this._configured = false;
    }
  }

  // ─── Credential resolution (priority: env JSON > env path > default file) ────

  private resolveCredential(config: ConfigService): ServiceAccount | null {
    // 1. JSON string in env var (CI / containers / K8s secrets)
    const rawJson = config.get<string>('FIREBASE_SERVICE_ACCOUNT');
    if (rawJson) {
      try {
        return JSON.parse(rawJson) as ServiceAccount;
      } catch {
        this.logger.error('FIREBASE_SERVICE_ACCOUNT is not valid JSON — falling back to file');
      }
    }

    // 2. Explicit file path in env var
    const envPath = config.get<string>('FIREBASE_SERVICE_ACCOUNT_PATH');
    if (envPath) {
      const abs = join(process.cwd(), envPath);
      if (existsSync(abs)) {
        try {
          return JSON.parse(readFileSync(abs, 'utf8')) as ServiceAccount;
        } catch {
          this.logger.error(`Could not read service account at ${abs}`);
        }
      } else {
        this.logger.error(`FIREBASE_SERVICE_ACCOUNT_PATH points to missing file: ${abs}`);
      }
    }

    // 3. Default location — firebase/service-account.json in project root
    const defaultPath = join(process.cwd(), 'firebase', 'service-account.json');
    if (existsSync(defaultPath)) {
      try {
        return JSON.parse(readFileSync(defaultPath, 'utf8')) as ServiceAccount;
      } catch {
        this.logger.error(`Could not parse ${defaultPath}`);
      }
    }

    return null;
  }

  // ─── Status ───────────────────────────────────────────────────────────────────

  isConfigured(): boolean {
    return this._configured;
  }

  // ─── Send push to device tokens (multicast) ───────────────────────────────────

  async sendToTokens(
    tokens: string[],
    notification: { title: string; body: string },
    data?: Record<string, string>,
  ): Promise<FcmSendResult> {
    if (!this._configured || !this.messaging || !tokens.length) {
      return { successCount: 0, failureCount: 0, invalidTokens: [] };
    }

    const message: MulticastMessage = {
      tokens,
      notification,
      ...(data && { data }),
      android: { priority: 'high' },
      apns: {
        payload: { aps: { sound: 'default', badge: 1 } },
      },
    };

    const result = await this.messaging.sendEachForMulticast(message);

    const invalidTokens: string[] = [];
    result.responses.forEach((resp, idx) => {
      if (!resp.success && resp.error && DEAD_TOKEN_CODES.has(resp.error.code)) {
        invalidTokens.push(tokens[idx]);
      }
    });

    this.logger.log(
      `FCM multicast — tokens: ${tokens.length}, success: ${result.successCount}, ` +
        `failed: ${result.failureCount}, dead: ${invalidTokens.length}`,
    );

    return {
      successCount: result.successCount,
      failureCount: result.failureCount,
      invalidTokens,
    };
  }

  // ─── Send to FCM topic ────────────────────────────────────────────────────────

  async sendToTopic(
    topic: string,
    notification: { title: string; body: string },
    data?: Record<string, string>,
  ): Promise<string> {
    if (!this._configured || !this.messaging) {
      this.logger.warn(`sendToTopic("${topic}") skipped — Firebase not configured`);
      return '';
    }

    const message: Message = {
      topic,
      notification,
      ...(data && { data }),
      android: { priority: 'high' },
      apns: {
        payload: { aps: { sound: 'default' } },
      },
    };

    const messageId = await this.messaging.send(message);
    this.logger.log(`FCM topic "${topic}" sent — messageId: ${messageId}`);
    return messageId;
  }

  // ─── Topic subscription management ───────────────────────────────────────────

  async subscribeToTopic(tokens: string[], topic: string): Promise<TopicResult> {
    if (!this._configured || !this.messaging || !tokens.length) {
      return { successCount: 0, failureCount: 0 };
    }

    const result = await this.messaging.subscribeToTopic(tokens, topic);
    this.logger.log(
      `Topic subscribe "${topic}" — success: ${result.successCount}, failed: ${result.failureCount}`,
    );
    return { successCount: result.successCount, failureCount: result.failureCount };
  }

  async unsubscribeFromTopic(tokens: string[], topic: string): Promise<TopicResult> {
    if (!this._configured || !this.messaging || !tokens.length) {
      return { successCount: 0, failureCount: 0 };
    }

    const result = await this.messaging.unsubscribeFromTopic(tokens, topic);
    this.logger.log(
      `Topic unsubscribe "${topic}" — success: ${result.successCount}, failed: ${result.failureCount}`,
    );
    return { successCount: result.successCount, failureCount: result.failureCount };
  }

  // ─── Firebase ID token verification ──────────────────────────────────────────

  async verifyIdToken(idToken: string): Promise<FirebaseTokenPayload> {
    if (!this._configured || !this.auth) {
      throw new UnauthorizedException('Firebase not configured — cannot verify ID token');
    }

    let decoded: DecodedIdToken;
    try {
      decoded = await this.auth.verifyIdToken(idToken, true);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new UnauthorizedException(`Firebase token verification failed: ${message}`);
    }

    return {
      uid: decoded.uid,
      email: decoded.email,
      phone: decoded.phone_number,
      emailVerified: decoded.email_verified,
      name: decoded.name as string | undefined,
    };
  }
}
