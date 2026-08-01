import { INestApplication } from '@nestjs/common';
import { InvoiceStatus, PaymentMethod } from '@prisma/client';
import request from 'supertest';

import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, loginAs } from './helpers/test-app';
import { seedTestOrg, cleanupTestOrg, SeedResult } from './helpers/seed';

describe('Payments (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let seed: SeedResult;
  let adminToken: string;
  let invoiceId: string;
  let paymentId: string;
  const TAG = `pay-${Date.now()}`;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    seed = await seedTestOrg(prisma, TAG);
    adminToken = await loginAs(app, seed.admin.email, 'TestP@ss1!');

    // Seed a SENT invoice owned by the org (linked via customer)
    const invoice = await prisma.invoice.create({
      data: {
        invoiceNumber: `INV-TEST-${TAG}`,
        status: InvoiceStatus.SENT,
        customerId: seed.admin.id,
        createdById: seed.admin.id,
        total: 1000,
        subtotal: 847.46,
        taxAmount: 152.54,
        cgst: 76.27,
        sgst: 76.27,
        taxableAmount: 847.46,
      },
    });
    invoiceId = invoice.id;
  });

  afterAll(async () => {
    await prisma.invoice.delete({ where: { id: invoiceId } }).catch(() => {});
    await cleanupTestOrg(prisma, seed);
    await app.close();
  });

  it('POST /invoicing/payments → 201 record offline payment', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/invoicing/payments')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Organization-Id', seed.org.id)
      .send({ invoiceId, amount: 1000, method: PaymentMethod.CASH })
      .expect(201);

    expect(res.body.data.amount).toBe(1000);
    expect(res.body.data.status).toBe('SUCCESS');
    paymentId = res.body.data.id;
  });

  it('GET /invoicing/payments → 200 list payments', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/invoicing/payments')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Organization-Id', seed.org.id)
      .expect(200);

    expect(Array.isArray(res.body.data.payments)).toBe(true);
  });

  it('GET /invoicing/payments/:id → 200 get payment by ID', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/invoicing/payments/${paymentId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Organization-Id', seed.org.id)
      .expect(200);

    expect(res.body.data.id).toBe(paymentId);
  });

  it('GET /invoicing/payments → 401 without auth', () => {
    return request(app.getHttpServer()).get('/api/v1/invoicing/payments').expect(401);
  });
});
