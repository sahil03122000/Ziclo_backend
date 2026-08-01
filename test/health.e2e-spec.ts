import { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, loginAs } from './helpers/test-app';
import { seedTestOrg, cleanupTestOrg, SeedResult } from './helpers/seed';

describe('Health (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let seed: SeedResult;
  let adminToken: string;
  const TAG = `health-${Date.now()}`;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    seed = await seedTestOrg(prisma, TAG);
    adminToken = await loginAs(app, seed.admin.email, 'TestP@ss1!');
  });

  afterAll(async () => {
    await cleanupTestOrg(prisma, seed);
    await app.close();
  });

  it('GET /health → 200 public (no auth required)', () => {
    return request(app.getHttpServer())
      .get('/api/v1/health')
      .expect(200)
      .expect((res) => {
        expect(res.body.data.status).toBe('ok');
        expect(typeof res.body.data.uptime).toBe('number');
        expect(res.body.data.timestamp).toBeDefined();
      });
  });

  it('GET /health/detailed → 401 without token', () => {
    return request(app.getHttpServer()).get('/api/v1/health/detailed').expect(401);
  });

  it('GET /health/detailed → 200 with admin token', () => {
    return request(app.getHttpServer())
      .get('/api/v1/health/detailed')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200)
      .expect((res) => {
        expect(res.body.data.status).toMatch(/^(ok|degraded)$/);
        expect(res.body.data.services.database).toBeDefined();
        expect(res.body.data.services.s3).toBeDefined();
        expect(res.body.data.services.firebase).toBeDefined();
        expect(res.body.data.services.razorpay).toBeDefined();
        expect(res.body.data.services.database.status).toBe('connected');
      });
  });
});
