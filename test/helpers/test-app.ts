import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import request from 'supertest';

import { AppModule } from '../../src/app.module';
import { GlobalExceptionFilter } from '../../src/common/filters/global-exception.filter';
import { ResponseInterceptor } from '../../src/common/interceptors/response.interceptor';
import { PrismaService } from '../../src/prisma/prisma.service';

export interface ProviderOverride {
  provide: unknown;
  useValue: unknown;
}

export async function createTestApp(overrides: ProviderOverride[] = []) {
  let builder = Test.createTestingModule({ imports: [AppModule] }).overrideGuard(ThrottlerGuard).useValue({ canActivate: () => true });

  for (const { provide, useValue } of overrides) {
    builder = builder.overrideProvider(provide).useValue(useValue) as typeof builder;
  }

  const moduleFixture: TestingModule = await builder.compile();

  const app = moduleFixture.createNestApplication();
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  app.useGlobalFilters(new GlobalExceptionFilter());
  app.useGlobalInterceptors(new ResponseInterceptor());

  await app.init();

  const prisma = moduleFixture.get(PrismaService);
  const jwt = moduleFixture.get(JwtService);

  return { app, prisma, jwt, moduleFixture };
}

export async function loginAs(app: INestApplication, email: string, password: string): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/api/v1/auth/login')
    .send({ email, password, platform: 'MOBILE' });
  return res.body?.data?.accessToken as string;
}

export function signToken(jwt: JwtService, userId: string, email: string): string {
  return jwt.sign({ sub: userId, email });
}
