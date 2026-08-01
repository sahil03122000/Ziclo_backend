import { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, loginAs } from './helpers/test-app';
import { seedTestOrg, cleanupTestOrg, SeedResult } from './helpers/seed';

describe('Auth (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let seed: SeedResult;
  const TAG = `auth-${Date.now()}`;
  // Register test uses a different email to avoid conflicting with seeded admin
  const REG_BASE = (Math.floor(Math.random() * 9_000_000) + 1_000_000).toString();
  const regEmail = `reg-${TAG}@example.com`;
  const regPhone = `+91${REG_BASE}009`;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    seed = await seedTestOrg(prisma, TAG);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: regEmail } }).catch(() => {});
    await cleanupTestOrg(prisma, seed);
    await app.close();
  });

  it('POST /auth/register → 201 with tokens', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ name: 'Reg User', email: regEmail, phone: regPhone, password: 'TestP@ss1!' })
      .expect(201);

    expect(res.body.data.accessToken).toBeDefined();
    expect(res.body.data.refreshToken).toBeDefined();
    expect(res.body.data.user.email).toBe(regEmail);
    expect(res.body.data.user.password).toBeUndefined();
  });

  it('POST /auth/register → 400 duplicate email', () => {
    return request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ name: 'Dup User', email: regEmail, phone: `+91${REG_BASE}008`, password: 'TestP@ss1!' })
      .expect(400);
  });

  it('POST /auth/login → 200 for ADMIN', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: seed.admin.email, password: 'TestP@ss1!', platform: 'MOBILE' })
      .expect(200);

    expect(res.body.data.accessToken).toBeDefined();
    expect(res.body.data.user.role).toBe('ADMIN');
  });

  it('POST /auth/login → 401 wrong password', () => {
    return request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: seed.admin.email, password: 'WrongPass1!', platform: 'MOBILE' })
      .expect(401);
  });

  it('GET /auth/me → 200 with valid token', async () => {
    const token = await loginAs(app, seed.admin.email, 'TestP@ss1!');
    const res = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.data.email).toBe(seed.admin.email);
  });

  it('GET /auth/me → 401 without token', () => {
    return request(app.getHttpServer()).get('/api/v1/auth/me').expect(401);
  });

  it('POST /auth/refresh → 200 returns new tokens', async () => {
    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: seed.admin.email, password: 'TestP@ss1!', platform: 'MOBILE' });

    const { refreshToken } = loginRes.body.data;

    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken })
      .expect(200);

    expect(res.body.data.accessToken).toBeDefined();
    expect(res.body.data.refreshToken).toBeDefined();
  });

  it('GET /auth/sessions → 200 returns session list', async () => {
    const token = await loginAs(app, seed.admin.email, 'TestP@ss1!');
    const res = await request(app.getHttpServer())
      .get('/api/v1/auth/sessions')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(Array.isArray(res.body.data)).toBe(true);
  });
});
