import { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { PrismaService } from '../src/prisma/prisma.service';
import { S3Service } from '../src/uploads/s3.service';
import { createTestApp, loginAs } from './helpers/test-app';
import { seedTestOrg, cleanupTestOrg, SeedResult } from './helpers/seed';

const mockS3: Partial<S3Service> = {
  upload: jest.fn().mockResolvedValue(undefined),
  delete: jest.fn().mockResolvedValue(undefined),
  exists: jest.fn().mockResolvedValue(true),
  getSignedUrl: jest.fn().mockResolvedValue('https://mock-s3.example.com/tasks/test-uuid.jpg'),
  ping: jest.fn().mockResolvedValue({ ok: true, latencyMs: 5 }),
};

describe('Uploads (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let seed: SeedResult;
  let adminToken: string;
  let uploadedFilename: string;
  const TAG = `upl-${Date.now()}`;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp([{ provide: S3Service, useValue: mockS3 }]));
    seed = await seedTestOrg(prisma, TAG);
    adminToken = await loginAs(app, seed.admin.email, 'TestP@ss1!');
  });

  afterAll(async () => {
    await cleanupTestOrg(prisma, seed);
    await app.close();
  });

  it('POST /uploads → 201 upload an image (S3 mocked)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/uploads?folder=tasks')
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', Buffer.from('fake-image-bytes'), { filename: 'test.jpg', contentType: 'image/jpeg' })
      .expect(201);

    expect(res.body.data.url).toBe('https://mock-s3.example.com/tasks/test-uuid.jpg');
    expect(res.body.data.filename).toMatch(/\.jpg$/);
    expect(res.body.data.key).toMatch(/^tasks\//);
    uploadedFilename = res.body.data.filename;
  });

  it('POST /uploads → 400 invalid mime type', () => {
    return request(app.getHttpServer())
      .post('/api/v1/uploads?folder=tasks')
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', Buffer.from('fake'), { filename: 'test.pdf', contentType: 'application/pdf' })
      .expect(400);
  });

  it('POST /uploads → 400 invalid folder', () => {
    return request(app.getHttpServer())
      .post('/api/v1/uploads?folder=badname')
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', Buffer.from('fake'), { filename: 'test.jpg', contentType: 'image/jpeg' })
      .expect(400);
  });

  it('DELETE /uploads/:filename → 200 admin deletes file', async () => {
    await request(app.getHttpServer())
      .delete(`/api/v1/uploads/${uploadedFilename}?folder=tasks`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(mockS3.delete).toHaveBeenCalled();
  });

  it('POST /uploads → 401 without auth', () => {
    return request(app.getHttpServer())
      .post('/api/v1/uploads?folder=tasks')
      .attach('file', Buffer.from('fake'), { filename: 'test.jpg', contentType: 'image/jpeg' })
      .expect(401);
  });
});
