import { plainToInstance } from 'class-transformer';
import { IsEnum, IsNumber, IsOptional, IsString, validateSync } from 'class-validator';

enum Environment {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

class EnvironmentVariables {
  @IsEnum(Environment)
  NODE_ENV: Environment = Environment.Development;

  @IsNumber()
  PORT: number = 3000;

  @IsString()
  DATABASE_URL: string;

  @IsString()
  JWT_SECRET: string;

  @IsOptional()
  @IsString()
  JWT_EXPIRES_IN: string = '15m';

  @IsOptional()
  @IsString()
  CORS_ORIGIN: string = 'http://localhost:3000';

  @IsOptional()
  @IsString()
  BASE_URL: string;

  @IsOptional()
  @IsString()
  UPLOAD_DIR: string;

  @IsOptional()
  @IsString()
  TZ: string;

  // ── MSG91 SMS ────────────────────────────────────────────────────────────────
  // When set, OTPs are dispatched via MSG91. Omit for dev-mode console logging.
  @IsOptional()
  @IsString()
  MSG91_AUTH_KEY: string;

  @IsOptional()
  @IsString()
  MSG91_TEMPLATE_ID: string;

  @IsOptional()
  @IsString()
  MSG91_SENDER_ID: string;

  // ── Dev bypass ───────────────────────────────────────────────────────────────
  // Set to "true" in development to skip MSG91 and return OTP in the API response.
  // Ignored in production regardless of value.
  @IsOptional()
  @IsString()
  DEV_SMS_BYPASS: string;

  // ── AWS S3 ───────────────────────────────────────────────────────────────────
  @IsOptional()
  @IsString()
  AWS_REGION: string;

  @IsOptional()
  @IsString()
  AWS_ACCESS_KEY_ID: string;

  @IsOptional()
  @IsString()
  AWS_SECRET_ACCESS_KEY: string;

  @IsOptional()
  @IsString()
  S3_BUCKET: string;

  @IsOptional()
  @IsString()
  S3_SIGNED_URL_TTL: string;

  // ── Resend (email) ─────────────────────────────────────────────────────────────
  // Omit to fall back to console logging in dev mode.
  @IsOptional()
  @IsString()
  RESEND_API_KEY: string;

  @IsOptional()
  @IsString()
  MAIL_FROM: string;

  // TEST_EMAIL_MODE=true sends from Resend's onboarding@resend.dev sandbox address,
  // bypassing MAIL_FROM/custom-domain verification. Testing only — never set in production.
  @IsOptional()
  @IsString()
  TEST_EMAIL_MODE: string;
}

export function validate(config: Record<string, unknown>) {
  const validatedConfig = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });

  const errors = validateSync(validatedConfig, {
    skipMissingProperties: false,
  });

  if (errors.length > 0) {
    throw new Error(errors.toString());
  }

  return validatedConfig;
}
