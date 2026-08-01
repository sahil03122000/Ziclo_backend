# Ziclo Backend

Enterprise field-service management platform built with NestJS, Prisma, and PostgreSQL.

## Stack

- **Framework:** NestJS 11 (TypeScript)
- **ORM:** Prisma 6 + PostgreSQL
- **Auth:** JWT (access + refresh tokens), OTP via SMS (MSG91) and Email (Brevo SMTP)
- **Docs:** Swagger / OpenAPI at `/api/docs` (non-production only)

## Setup

```bash
npm install
```

Copy the example env file and fill in your values:

```bash
cp .env.example .env
```

Push the schema to your database:

```bash
npx prisma db push
```

## Running

```bash
# development (watch mode)
npm run start:dev

# production
npm run start:prod
```

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `NODE_ENV` | Yes | `development` or `production` |
| `PORT` | No | HTTP port (default `3000`) |
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `JWT_SECRET` | Yes | Secret for signing JWTs |
| `JWT_EXPIRES_IN` | No | Token TTL (default `7d`) |
| `CORS_ORIGIN` | No | Comma-separated origins, or `*` |
| `MSG91_AUTH_KEY` | No | MSG91 key — omit to log OTPs in dev |
| `MSG91_TEMPLATE_ID` | No | DLT-registered OTP template ID |
| `MSG91_SENDER_ID` | No | 6-char DLT sender ID |
| `MAIL_HOST` | No | SMTP host (e.g. `smtp-relay.brevo.com`) |
| `MAIL_PORT` | No | SMTP port (default `587`) |
| `MAIL_USER` | No | SMTP username |
| `MAIL_PASSWORD` | No | SMTP password |
| `MAIL_FROM` | No | From address (falls back to `MAIL_USER`) |

## API Base URL

```
/api/v1
```

Swagger UI (dev only): `http://localhost:3000/api/docs`
