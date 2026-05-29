# ── Aether panel (Next.js) ───────────────────────────────────────────────
FROM node:20-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
# Build needs a (placeholder) DATABASE_URL for prisma generate; no DB is touched.
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build"

# Copy the whole monorepo source (the root .dockerignore excludes node_modules,
# .next, .env, .git) so all npm workspaces match the lockfile and devDeps
# (typescript/tsc, etc.) install & hoist correctly.
COPY . .
RUN npm install --include=dev --no-audit --no-fund

RUN npm run build:shared \
 && npm run db:generate --workspace @aether/panel \
 && npm run build --workspace @aether/panel

# ── Runtime ──────────────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS run
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=build /app /app
WORKDIR /app/apps/panel
EXPOSE 3000
# Sync the schema to the DB (idempotent), seed defaults, then start.
# `db push` creates tables from schema.prisma; WITHOUT --accept-data-loss it
# refuses destructive changes instead of silently dropping data. For production,
# adopt `prisma migrate deploy` with checked-in migrations.
CMD ["sh", "-c", "npx prisma db push --skip-generate && npm run db:seed && npm run start"]
