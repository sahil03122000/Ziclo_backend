import { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, loginAs } from './helpers/test-app';
import { seedTestOrg, cleanupTestOrg, SeedResult } from './helpers/seed';

describe('Tasks (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let seed: SeedResult;
  let adminToken: string;
  let taskId: string;
  const TAG = `task-${Date.now()}`;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    seed = await seedTestOrg(prisma, TAG);
    adminToken = await loginAs(app, seed.admin.email, 'TestP@ss1!');
  });

  afterAll(async () => {
    await cleanupTestOrg(prisma, seed);
    await app.close();
  });

  it('POST /tasks → 201 create task', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/tasks')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Organization-Id', seed.org.id)
      .send({
        title: 'E2E Test Task',
        description: 'Created in e2e test',
        priority: 'HIGH',
        dueDate: new Date(Date.now() + 86_400_000).toISOString(),
        pincodeId: seed.pincode.id,
      })
      .expect(201);

    expect(res.body.data.title).toBe('E2E Test Task');
    expect(res.body.data.organizationId).toBe(seed.org.id);
    taskId = res.body.data.id;
  });

  it('GET /tasks → 200 list tasks (org scoped)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/tasks')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Organization-Id', seed.org.id)
      .expect(200);

    expect(Array.isArray(res.body.data.tasks)).toBe(true);
    expect(res.body.data.meta).toBeDefined();
  });

  it('GET /tasks/:id → 200 get task by ID', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/tasks/${taskId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Organization-Id', seed.org.id)
      .expect(200);

    expect(res.body.data.id).toBe(taskId);
  });

  it('GET /tasks/:id → 401 without auth', () => {
    return request(app.getHttpServer()).get(`/api/v1/tasks/${taskId}`).expect(401);
  });

  it('PATCH /tasks/:id → 200 update task', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/v1/tasks/${taskId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Organization-Id', seed.org.id)
      .send({ title: 'Updated Task Title' })
      .expect(200);

    expect(res.body.data.title).toBe('Updated Task Title');
  });

  it('DELETE /tasks/:id → 200 delete task', async () => {
    await request(app.getHttpServer())
      .delete(`/api/v1/tasks/${taskId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Organization-Id', seed.org.id)
      .expect(200);
  });
});
