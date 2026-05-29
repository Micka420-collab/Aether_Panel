# ── Aether daemon (Docker control plane) ─────────────────────────────────
FROM node:20-bookworm-slim AS build
WORKDIR /app
# Copy the whole monorepo source (the root .dockerignore excludes node_modules,
# .next, .env, .git) so all npm workspaces match the lockfile and devDeps
# (typescript/tsc, etc.) install & hoist correctly.
COPY . .
RUN npm install --include=dev --no-audit --no-fund
RUN npm run build:shared && npm run build --workspace @aether/daemon

# ── Runtime ──────────────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS run
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app /app
WORKDIR /app/apps/daemon
EXPOSE 8080
CMD ["node", "dist/index.js"]
