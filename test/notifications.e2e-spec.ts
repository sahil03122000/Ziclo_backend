import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';

import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, loginAs, signToken } from './helpers/test-app';
import { seedTestOrg, cleanupTestOrg, SeedResult } from './helpers/seed';

describe('Notifications (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let seed: SeedResult;
  let adminToken: string;
  let workerToken: string;
  const TAG = `notif-${Date.now()}`;

  beforeAll(async () => {
    ({ app, prisma, jwt } = await createTestApp());
    seed = await seedTestOrg(prisma, TAG);
    adminToken = await loginAs(app, seed.admin.email, 'TestP@ss1!');
    workerToken = signToken(jwt, seed.worker.id, seed.worker.email);
  });

  afterAll(async () => {
    await prisma.deviceToken.deleteMany({ where: { userId: { in: [seed.worker.id, seed.admin.id] } } }).catch(() => {});
    await cleanupTestOrg(prisma, seed);
    await app.close();
  });

  it('POST /notifications/register-device → 201', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/notifications/register-device')
      .set('Authorization', `Bearer ${workerToken}`)
      .send({ token: `fcm-token-${TAG}`, platform: 'MOBILE' })
      .expect(201);

    expect(res.body.data.token).toBe(`fcm-token-${TAG}`);
    expect(res.body.data.isActive).toBe(true);
  });

  it('GET /notifications → 200 returns notification list', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/notifications')
      .set('Authorization', `Bearer ${workerToken}`)
      .expect(200);

    expect(Array.isArray(res.body.data.notifications)).toBe(true);
    expect(typeof res.body.data.unreadCount).toBe('number');
  });

  it('PATCH /notifications/read-all → 200', async () => {
    const res = await request(app.getHttpServer())
      .patch('/api/v1/notifications/read-all')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.success).toBe(true);
  });

  it('GET /notifications → 401 without auth', () => {
    return request(app.getHttpServer()).get('/api/v1/notifications').expect(401);
  });

  it('POST /notifications/register-device → 401 without auth', () => {
    return request(app.getHttpServer())
      .post('/api/v1/notifications/register-device')
      .send({ token: 'some-token', platform: 'MOBILE' })
      .expect(401);
  });
});
