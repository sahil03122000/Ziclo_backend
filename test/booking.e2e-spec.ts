import { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, loginAs } from './helpers/test-app';
import { seedTestOrg, cleanupTestOrg, SeedResult } from './helpers/seed';

describe('Booking (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let seed: SeedResult;
  let adminToken: string;
  let serviceId: string;
  let bookingId: string;
  const TAG = `book-${Date.now()}`;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    seed = await seedTestOrg(prisma, TAG);
    adminToken = await loginAs(app, seed.admin.email, 'TestP@ss1!');

    // Create a service directly — no org scoping on Service model
    const svc = await prisma.service.create({
      data: { name: `Test Service ${TAG}`, duration: 60, price: 500 },
    });
    serviceId = svc.id;
  });

  afterAll(async () => {
    await prisma.service.delete({ where: { id: serviceId } }).catch(() => {});
    await cleanupTestOrg(prisma, seed);
    await app.close();
  });

  it('GET /booking/services → 200 list services', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/booking/services')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(Array.isArray(res.body.data.services)).toBe(true);
  });

  it('POST /booking/bookings → 201 create booking', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/booking/bookings')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Organization-Id', seed.org.id)
      .send({
        serviceId,
        scheduledAt: new Date(Date.now() + 86_400_000).toISOString(),
        notes: 'E2E test booking',
      })
      .expect(201);

    expect(res.body.data.serviceId).toBe(serviceId);
    expect(res.body.data.status).toBe('PENDING');
    bookingId = res.body.data.id;
  });

  it('GET /booking/bookings → 200 list bookings', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/booking/bookings')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Organization-Id', seed.org.id)
      .expect(200);

    expect(Array.isArray(res.body.data.bookings)).toBe(true);
    expect(res.body.data.meta).toBeDefined();
  });

  it('GET /booking/bookings/:id → 200 get booking by ID', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/booking/bookings/${bookingId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Organization-Id', seed.org.id)
      .expect(200);

    expect(res.body.data.id).toBe(bookingId);
  });

  it('GET /booking/bookings → 401 without auth', () => {
    return request(app.getHttpServer()).get('/api/v1/booking/bookings').expect(401);
  });
});
