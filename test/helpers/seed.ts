import { Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';

import { PrismaService } from '../../src/prisma/prisma.service';

export const TEST_PASSWORD = 'TestP@ss1!';

export interface SeedResult {
  org: { id: string; name: string; slug: string };
  admin: { id: string; email: string; name: string };
  worker: { id: string; email: string; name: string };
  area: { id: string };
  pincode: { id: string };
  officeLocation: { id: string; latitude: number; longitude: number };
}

export async function seedTestOrg(prisma: PrismaService, tag: string): Promise<SeedResult> {
  const hash = await bcrypt.hash(TEST_PASSWORD, 10);
  // 7-digit base keeps phone length at exactly 10 digits (+91 + 10)
  const base = (Math.floor(Math.random() * 9_000_000) + 1_000_000).toString();

  const org = await prisma.organization.create({
    data: { name: `Test Org ${tag}`, slug: `test-org-${tag}` },
  });

  const admin = await prisma.user.create({
    data: {
      name: 'Test Admin',
      email: `admin-${tag}@example.com`,
      phone: `+91${base}000`,
      password: hash,
      role: Role.ADMIN,
      organizationId: org.id,
    },
  });
  await prisma.organizationUser.create({
    data: { organizationId: org.id, userId: admin.id, role: Role.ADMIN, isActive: true },
  });

  const worker = await prisma.user.create({
    data: {
      name: 'Test Worker',
      email: `worker-${tag}@example.com`,
      phone: `+91${base}001`,
      password: hash,
      role: Role.WORKER,
      organizationId: org.id,
    },
  });
  await prisma.organizationUser.create({
    data: { organizationId: org.id, userId: worker.id, role: Role.WORKER, isActive: true },
  });

  const area = await prisma.area.create({
    data: { name: `Test Area ${tag}`, city: 'Test City', state: 'Test State' },
  });

  const pincode = await prisma.pincode.create({
    data: { pincode: base, city: 'Test City', state: 'Test State' },
  });

  const officeLocation = await prisma.officeLocation.create({
    data: {
      name: `Test Office ${tag}`,
      latitude: 12.9716,
      longitude: 77.5946,
      radius: 1_000_000, // 1000 km — any GPS coordinate matches in tests
      isActive: true,
      areaId: area.id,
    },
  });

  return {
    org: { id: org.id, name: org.name, slug: org.slug },
    admin: { id: admin.id, email: admin.email, name: admin.name },
    worker: { id: worker.id, email: worker.email, name: worker.name },
    area: { id: area.id },
    pincode: { id: pincode.id },
    officeLocation: { id: officeLocation.id, latitude: officeLocation.latitude, longitude: officeLocation.longitude },
  };
}

export async function cleanupTestOrg(prisma: PrismaService, seed: SeedResult): Promise<void> {
  await prisma.organization.delete({ where: { id: seed.org.id } }).catch(() => {});
  await prisma.user.deleteMany({ where: { id: { in: [seed.admin.id, seed.worker.id] } } }).catch(() => {});
  await prisma.area.delete({ where: { id: seed.area.id } }).catch(() => {});
  await prisma.pincode.delete({ where: { id: seed.pincode.id } }).catch(() => {});
}
