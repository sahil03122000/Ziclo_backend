import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { FirebaseService } from '../firebase/firebase.service';
import { PrismaService } from '../prisma/prisma.service';
import { S3Service } from '../uploads/s3.service';

@Injectable()
export class HealthService {
  private readonly startTime = Date.now();

  constructor(
    private readonly prisma: PrismaService,
    private readonly firebase: FirebaseService,
    private readonly s3: S3Service,
    private readonly config: ConfigService,
  ) {}

  getBasic() {
    return {
      success: true,
      data: {
        status: 'ok',
        uptime: Math.floor((Date.now() - this.startTime) / 1000),
        timestamp: new Date().toISOString(),
      },
    };
  }

  async getDetailed() {
    // ── Database ──────────────────────────────────────────────────────────────
    let dbStatus: 'connected' | 'error' = 'error';
    let dbLatencyMs = -1;
    try {
      const t0 = Date.now();
      await this.prisma.$queryRaw`SELECT 1`;
      dbLatencyMs = Date.now() - t0;
      dbStatus = 'connected';
    } catch {
      dbStatus = 'error';
    }

    // ── S3 ────────────────────────────────────────────────────────────────────
    const s3Configured = !!this.config.get<string>('S3_BUCKET');
    let s3Status: 'ok' | 'not_configured' | 'error' = 'not_configured';
    let s3LatencyMs = -1;
    if (s3Configured) {
      const result = await this.s3.ping();
      s3Status = result.ok ? 'ok' : 'error';
      s3LatencyMs = result.latencyMs;
    }

    // ── Firebase ──────────────────────────────────────────────────────────────
    const firebaseStatus = this.firebase.isConfigured() ? 'ok' : 'not_configured';

    // ── Razorpay ──────────────────────────────────────────────────────────────
    const razorpayConfigured = !!(
      this.config.get<string>('RAZORPAY_KEY_ID') &&
      this.config.get<string>('RAZORPAY_KEY_SECRET')
    );

    const overall =
      dbStatus === 'connected' &&
      (s3Status === 'ok' || s3Status === 'not_configured') &&
      (firebaseStatus === 'ok' || firebaseStatus === 'not_configured');

    const mem = process.memoryUsage();
    const toMb = (bytes: number) => +(bytes / 1_048_576).toFixed(2);

    return {
      success: true,
      data: {
        status: overall ? 'ok' : 'degraded',
        uptime: Math.floor((Date.now() - this.startTime) / 1000),
        timestamp: new Date().toISOString(),
        version: process.env.npm_package_version ?? '1.0.0',
        environment: process.env.NODE_ENV ?? 'development',
        services: {
          database: { status: dbStatus, latencyMs: dbLatencyMs },
          s3: { status: s3Status, latencyMs: s3LatencyMs },
          firebase: { status: firebaseStatus },
          razorpay: { configured: razorpayConfigured },
        },
        memory: {
          rssМb: toMb(mem.rss),
          heapUsedMb: toMb(mem.heapUsed),
          heapTotalMb: toMb(mem.heapTotal),
          externalMb: toMb(mem.external),
        },
        process: {
          pid: process.pid,
          platform: process.platform,
          nodeVersion: process.version,
        },
      },
    };
  }
}
