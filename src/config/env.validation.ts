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

  // ── Cloudinary (image/icon uploads) ─────────────────────────────────────────────
  @IsOptional()
  @IsString()
  CLOUDINARY_CLOUD_NAME: string;

  @IsOptional()
  @IsString()
  CLOUDINARY_API_KEY: string;

  @IsOptional()
  @IsString()
  CLOUDINARY_API_SECRET: string;

  // ── Brevo (email API) ──────────────────────────────────────────────────────────
  // Omit to fall back to console logging in dev mode.
  @IsOptional()
  @IsString()
  BREVO_API_KEY: string;

  @IsOptional()
  @IsString()
  BREVO_SENDER_NAME: string;

  @IsOptional()
  @IsString()
  BREVO_SENDER_EMAIL: string;
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
