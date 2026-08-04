# ─── Stage 1: Build ──────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npx prisma generate
RUN npm run build
RUN find /app/dist -type f

# ─── Stage 2: Production runtime ─────────────────────────────────────────────
FROM node:20-alpine AS runtime
WORKDIR /app

RUN addgroup -g 1001 -S nodejs && adduser -S nestjs -u 1001 -G nodejs

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY prisma ./prisma

# uploads/images, uploads/icons, and exports are written to at runtime by the
# non-root "nestjs" user (multer diskStorage, report generation). Without this,
# /app is root-owned (default COPY ownership) and mkdirSync() in those request
# handlers fails with EACCES, crashing the request — e.g. POST /uploads/image
# returning a 502 in production even though the route itself exists.
RUN mkdir -p /app/uploads/images /app/uploads/icons /app/exports \
  && chown -R nestjs:nodejs /app/uploads /app/exports

USER nestjs

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD wget -qO- http://localhost:8080/api/v1/health || exit 1

CMD ["node", "dist/main"]