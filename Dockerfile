# ─── Build stage ─────────────────────────────────────────────────────
FROM oven/bun:1.3 AS base
WORKDIR /app

# Install dependencies (use cache mount for bun cache)
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Copy source
COPY . .

# Generate Prisma client
RUN bun run db:generate

# Build the Next.js standalone output
RUN bun run build

# ─── Production stage ────────────────────────────────────────────────
FROM oven/bun:1.3-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Install only runtime system deps (no dev tooling)
# systeminformation needs no extra native deps on slim
# sqlite3 is needed for Prisma SQLite (dev); for prod, switch to postgresql
RUN apt-get update && apt-get install -y --no-install-recommends \
    openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Copy standalone server + static + public
COPY --from=base /app/.next/standalone ./
COPY --from=base /app/.next/static ./.next/static
COPY --from=base /app/public ./public
COPY --from=base /app/prisma ./prisma
COPY --from=base /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=base /app/node_modules/@prisma ./node_modules/@prisma

# Copy realtime mini-service
COPY --from=base /app/mini-services ./mini-services

# Create db directory
RUN mkdir -p /app/db

# Expose ports (3000 = app, 3003 = realtime sidecar)
EXPOSE 3000 3003

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3000/api/health || exit 1

# Start both the app and the realtime sidecar
# The app runs on port 3000, the realtime sidecar on 3003
COPY --from=base /app/scripts/start-services.sh ./start-services.sh
RUN chmod +x ./start-services.sh

CMD ["./start-services.sh"]
