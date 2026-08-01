FROM node:20-alpine AS builder
WORKDIR /app

ARG CACHEBUST=1
COPY package*.json ./
RUN npm ci

# ─── Stage 1: Build ──────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npx prisma generate
RUN npm run build

# ─── Stage 2: Production runtime ─────────────────────────────────────────────
FROM node:20-alpine AS runtime
WORKDIR /app

RUN addgroup -g 1001 -S nodejs && adduser -S nestjs -u 1001 -G nodejs

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist
# Generated Prisma query-engine binaries
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
# Schema needed by prisma migrate deploy
COPY prisma ./prisma

USER nestjs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/v1/health || exit 1

CMD ["node", "dist/main"]
