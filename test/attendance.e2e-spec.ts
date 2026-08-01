import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';

import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, loginAs, signToken } from './helpers/test-app';
import { seedTestOrg, cleanupTestOrg, SeedResult } from './helpers/seed';

describe('Attendance (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let seed: SeedResult;
  let adminToken: string;
  let workerToken: string;
  const TAG = `att-${Date.now()}`;

  beforeAll(async () => {
    ({ app, prisma, jwt } = await createTestApp());
    seed = await seedTestOrg(prisma, TAG);
    adminToken = await loginAs(app, seed.admin.email, 'TestP@ss1!');
    workerToken = signToken(jwt, seed.worker.id, seed.worker.email);
  });

  afterAll(async () => {
    await cleanupTestOrg(prisma, seed);
    await app.close();
  });

  it('POST /attendance/checkin → 200 worker checks in', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/attendance/checkin')
      .set('Authorization', `Bearer ${workerToken}`)
      .set('X-Organization-Id', seed.org.id)
      .send({
        officeLocationId: seed.officeLocation.id,
        latitude: seed.officeLocation.latitude,
        longitude: seed.officeLocation.longitude,
        selfieImageUrl: 'https://example.com/selfie.jpg',
      })
      .expect(201);

    expect(res.body.data.status).toBe('CHECKED_IN');
    expect(res.body.data.organizationId).toBe(seed.org.id);
  });

  it('GET /attendance/me/today → 200 worker sees today attendance', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/attendance/me/today')
      .set('Authorization', `Bearer ${workerToken}`)
      .set('X-Organization-Id', seed.org.id)
      .expect(200);

    expect(res.body.data).not.toBeNull();
    expect(res.body.data.status).toBe('CHECKED_IN');
  });

  it('POST /attendance/checkout → 200 worker checks out', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/attendance/checkout')
      .set('Authorization', `Bearer ${workerToken}`)
      .set('X-Organization-Id', seed.org.id)
      .send({
        latitude: seed.officeLocation.latitude,
        longitude: seed.officeLocation.longitude,
        selfieImageUrl: 'https://example.com/selfie-out.jpg',
      })
      .expect(201);

    expect(res.body.data.status).toBe('CHECKED_OUT');
  });

  it('GET /attendance/me/history → 200 paginated history', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/attendance/me/history')
      .set('Authorization', `Bearer ${workerToken}`)
      .expect(200);

    expect(Array.isArray(res.body.data.attendances)).toBe(true);
    expect(res.body.data.meta).toBeDefined();
  });

  it('GET /attendance → 200 admin lists all (org scoped)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/attendance')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Organization-Id', seed.org.id)
      .expect(200);

    expect(Array.isArray(res.body.data.attendances)).toBe(true);
  });

  it('GET /attendance → 401 without auth', () => {
    return request(app.getHttpServer()).get('/api/v1/attendance').expect(401);
  });
});
