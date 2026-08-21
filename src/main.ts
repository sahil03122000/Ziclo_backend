// Must run before AppModule (and anything it imports, e.g. the Cloudinary config) is
// loaded, so process.env is populated from .env in local dev before those modules read it.
import 'dotenv/config';

import { join } from 'path';

import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';

import { ConfigService } from '@nestjs/config';

import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { AppLogger } from './common/logger/app-logger.service';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: new AppLogger(),
  });

  // ─── Security headers ───────────────────────────────────────────────────────
  app.use(
    helmet({
      contentSecurityPolicy: false,
    }),
  );

  // ─── Pre-pipe request body logging (runs before ValidationPipe) ─────────────
  app.use('/api/v1/admin/managers', (req: any, _res: any, next: () => void) => {
    if (req.method === 'POST') {
      const { password: _pw, ...loggable } = req.body ?? {};
      console.log('[createManager] Raw request body:', JSON.stringify(loggable));
    }
    next();
  });

  // ─── Static file serving ─────────────────────────────────────────────────────
  // Serves /uploads/images/<filename> at http://host/uploads/images/<filename>
  // bypasses the api/v1 global prefix intentionally.
  app.useStaticAssets(join(process.cwd(), 'uploads'), { prefix: '/uploads' });
  // Serves generated report files at http://host/exports/<filename>
  app.useStaticAssets(join(process.cwd(), 'exports'), { prefix: '/exports' });

  // ─── Request body size limit ────────────────────────────────────────────────
  // verify callback preserves raw body on req.rawBody — required for Razorpay webhook signature verification
  app.use(require('express').json({
    limit: '5mb',
    verify: (req: any, _res: any, buf: Buffer) => { req.rawBody = buf; },
  }));
  app.use(require('express').urlencoded({ extended: true, limit: '5mb' }));

  // ─── Pre-pipe request body logging — Service Management update debugging ────
  // Registered after the body parsers (above) so req.body is actually populated,
  // and before Nest's routing/ValidationPipe, so it captures the raw payload the
  // client sent regardless of whether validation later accepts or rejects it.
  app.use('/api/v1/booking/services', (req: any, _res: any, next: () => void) => {
    if (req.method === 'PUT') {
      console.log('[updateService] Raw request body:', JSON.stringify(req.body));
    }
    next();
  });

  // ─── CORS ───────────────────────────────────────────────────────────────────
  // Default to '*' so mobile devices on the LAN are never blocked during dev.
  // In production set CORS_ORIGIN to the specific allowed origin(s).
  const allowedOrigins = (process.env.CORS_ORIGIN || '*')
    .split(',')
    .map((o) => o.trim());

  app.enableCors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`Origin ${origin} not allowed by CORS`));
      }
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    // Content-Disposition/Content-Length aren't on the browser's default CORS-safelisted
    // response headers — without this, a Web frontend reading response.headers.get(
    // 'Content-Disposition') (e.g. to name the downloaded invoice PDF file) gets null on any
    // cross-origin request, even though the PDF body itself still downloads fine. Relevant to
    // GET invoicing/invoices/:id/pdf specifically, which sets both.
    exposedHeaders: ['Content-Disposition', 'Content-Length'],
    credentials: true,
  });

  // ─── Global prefix ──────────────────────────────────────────────────────────
  app.setGlobalPrefix('api/v1');

  // ─── Validation pipe ────────────────────────────────────────────────────────
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
      // Guarantee flat string[] errors regardless of NestJS version behaviour
      exceptionFactory: (errors) => {
        const messages = errors.flatMap((e) =>
          e.constraints
            ? Object.values(e.constraints).map((msg) => `${e.property}: ${msg}`)
            : [`${e.property}: invalid value`],
        );
        console.error('[ValidationPipe] Validation failed:', JSON.stringify(messages));
        return new BadRequestException({
          statusCode: 400,
          message: 'Validation failed',
          errors: messages,
        });
      },
    }),
  );

  // ─── Global interceptor + exception filter ──────────────────────────────────
  app.useGlobalInterceptors(new ResponseInterceptor());
  app.useGlobalFilters(new GlobalExceptionFilter());

  // ─── Swagger / OpenAPI ──────────────────────────────────────────────────────
  const swaggerConfig = new DocumentBuilder()
    .setTitle('Ziclo Enterprise API')
    .setDescription(
      '## Enterprise Field-Service Management Platform\n\n' +
      '### Authentication\n' +
      '1. Use **`POST /api/v1/auth/firebase-login`** (recommended — Firebase Phone Auth) or\n' +
      '   **`POST /api/v1/auth/login`** (email + password, admin/manager only)\n' +
      '2. Copy the `accessToken` from the response\n' +
      '3. Click **Authorize** above and enter `Bearer <token>`\n\n' +
      '### Roles\n' +
      '| Role | Description |\n' +
      '|------|-------------|\n' +
      '| `SUPER_ADMIN` | Platform owner — manages orgs, plans, overrides |\n' +
      '| `ADMIN` | Organization admin — manages all org resources |\n' +
      '| `MANAGER` | Manages workers, reviews tasks, confirms bookings |\n' +
      '| `WORKER` | Field staff — executes tasks, checks in/out |\n' +
      '| `USER` | End customer — creates bookings, views invoices |\n\n' +
      '### Response Envelope\n' +
      'All responses are wrapped: `{ success: boolean, data: T, message?: string }`\n\n' +
      '### Rate Limiting\n' +
      'Default: 100 req/min per IP. Auth endpoints: 10 req/min. OTP: 5 req/min.',
    )
    .setVersion('2.0.0')
    .setContact('Ziclo Support', '', 'support@ziclo.in')
    .addServer('http://192.168.1.9:3000', 'LAN')
    .addServer('http://localhost:3000', 'Local')
    .addServer('http://api.ziclo.in', 'Production')
    .addServer(process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`, 'Local / LAN')
    .addServer('http://api.ziclo.in', 'Production')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: 'JWT access token from /auth/login or /auth/firebase-login' },
      'JWT',
    )
    // ── Authentication ──────────────────────────────────────────────────────
    .addTag('Authentication', 'Firebase phone login, email+password login, token refresh, password management, session management')
    // ── Users & Addresses ───────────────────────────────────────────────────
    .addTag('Users', 'User profile, role assignment, status management, CSV export')
    .addTag('Addresses', 'Saved delivery/service addresses with GPS coordinates, default management')
    // ── Field Operations ────────────────────────────────────────────────────
    .addTag('Attendance', 'GPS + selfie check-in/check-out, monthly summary, admin corrections')
    .addTag('Tasks', 'Full task lifecycle — create, assign, start, complete, approve, reject')
    .addTag('Areas', 'Geographic service area management and manager assignments')
    .addTag('Pincodes', 'Pincode management, manager and worker pincode assignments')
    .addTag('Office Locations', 'Geofenced office locations for check-in radius enforcement')
    // ── Booking Engine ──────────────────────────────────────────────────────
    .addTag('Booking / Services', 'Service catalogue — slug, booking type, payment type, dynamic flow endpoints')
    .addTag('Booking / Time Slots', 'Slot capacity and availability window management')
    .addTag('Booking / Bookings', 'Full booking lifecycle — create with step values, preview pricing, assign, reschedule, cancel, complete')
    .addTag('Booking / Config', 'Customer-facing booking configuration — tax %, advance payment %, active service areas, service-area check')
    // ── Admin Catalog ───────────────────────────────────────────────────────
    .addTag('Admin / Staff', 'Manager and worker listings with real-time attendance, work status, office location, and area assignment — ADMIN only')
    .addTag('Admin / Catalog', 'Dynamic service configuration — categories, services, booking steps, options, packages, add-ons, pricing rules, conditional rules, payment rules')
    // ── Invoicing & Payments ────────────────────────────────────────────────
    .addTag('Invoicing / Invoices', 'Auto-generation from bookings, manual invoices, GST, line items, PDF metadata, status lifecycle')
    .addTag('Invoicing / Payments', 'Razorpay order creation + signature verification, offline payments (cash/card/UPI), refunds')
    // ── CRM ─────────────────────────────────────────────────────────────────
    .addTag('CRM', 'Pipeline overview and CRM dashboard — lead funnel, deal forecast')
    .addTag('CRM / Customers', 'Customer CRUD with contact associations and booking history')
    .addTag('CRM / Leads', 'Lead pipeline — NEW → CONTACTED → QUALIFIED → PROPOSAL_SENT → WON/LOST — includes conversion to Customer')
    .addTag('CRM / Deals', 'Deal management with stage tracking and value forecast')
    .addTag('CRM / Contacts', 'Contact management linked to customers')
    .addTag('CRM / Activities', 'Activity log — calls, emails, meetings, notes, tasks')
    // ── Notifications & Uploads ─────────────────────────────────────────────
    .addTag('Banners', 'Home screen banner management — create, update, reorder, activate/deactivate, soft-delete (Admin); public active banners list')
    .addTag('Notifications', 'FCM device token registration, in-app notification inbox, bulk push dispatch')
    .addTag('Uploads', 'Multipart image upload (JPG/PNG/WebP, 10 MB max) to local storage by folder')
    // ── Intelligence ────────────────────────────────────────────────────────
    .addTag('Dashboard', 'Role-specific aggregated stats — Admin, Manager, Worker, Super-Admin (cached 60 s)')
    .addTag('Reports', 'Task, attendance, revenue, booking and CRM pipeline reports with CSV export')
    .addTag('Analytics', 'Time-series analytics — weekly / monthly / yearly trends')
    .addTag('Audit Logs', 'Immutable audit trail of all mutations with actor, entity, before/after values')
    .addTag('Admin / Activity Log', 'Human-readable activity timeline — paginated log, per-entry detail, dashboard feed, today\'s stats')
    .addTag('Settings', 'System settings key-value store — ADMIN only')
    .addTag('Health', 'Liveness and readiness probes with DB latency and memory metrics')
    // ── Tenancy & Plans ─────────────────────────────────────────────────────
    .addTag('Plans', 'Subscription plan catalogue — name, price, feature limits — SUPER_ADMIN managed')
    .addTag('Organizations', 'Tenant CRUD — create, dashboard, update, delete')
    .addTag('Organization Members', 'Invite, role update, soft-remove organization members')
    .addTag('Organization Subscriptions', 'TRIAL → PAID upgrade, plan change, cancel, renew, invoice history')
    .addTag('Super Admin', 'Platform-level operations — org status, subscription override, hard delete, cross-org user list')
    // ── Support & Webhooks ──────────────────────────────────────────────────
    .addTag('Support', 'Support ticket lifecycle — create, comment, attach, assign, escalate, resolve, close')
    .addTag('Webhooks', 'Razorpay event callbacks — payment captured/failed, order paid, refund processed, subscription events')
    .addTag('Website', 'Public marketing website content — settings, home, statistics, SEO (Module 1)')
    .addTag('Website / Services', 'Public marketing website catalogue — categories, services, property types, packages, pricing options (Module 2). Separate from the Mobile App\'s authenticated booking-flow endpoints.')
    .addTag('Website / Content', 'Public marketing website content — banners, gallery, why-Ziclo, app showcase, download links, testimonials, FAQ (Module 3)')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);

  SwaggerModule.setup('api/docs', app, document, {
    jsonDocumentUrl: '/api/docs-json',
    customSiteTitle: 'Ziclo API Docs',
    customfavIcon: '',
    swaggerOptions: {
      persistAuthorization: true,
      tagsSorter: 'alpha',
      operationsSorter: 'alpha',
      docExpansion: 'none',
      filter: true,
      showRequestDuration: true,
      tryItOutEnabled: true,
    },
  });

  const config = app.get(ConfigService);
  const port = config.get<number>('port') ?? 3000;
  const baseUrl = config.get<string>('baseUrl');

  await app.listen(port, '0.0.0.0');

  if (!baseUrl) {
    console.warn(
      `\n[CONFIG] WARNING: BASE_URL is not set.\n` +
      `  Upload and export endpoints will return HTTP 500 until BASE_URL is configured.\n` +
      `  Add BASE_URL=http://<your-lan-ip>:${port} to your .env file.\n`,
    );
  }

  console.log('\nServer running on:');
  console.log(`  http://0.0.0.0:${port}`);
  console.log('\nBASE_URL:');
  console.log(`  ${baseUrl ?? '(not set — see warning above)'}`);
  if (baseUrl) {
    console.log(`\n  API:     ${baseUrl}/api/v1`);
    console.log(`  Swagger: ${baseUrl}/api/docs`);
  }
}

bootstrap();
