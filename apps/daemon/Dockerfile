# ── Aether daemon (Docker control plane) ─────────────────────────────────
FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json* tsconfig.base.json ./
COPY packages ./packages
COPY apps/daemon ./apps/daemon
RUN npm install --no-audit --no-fund
RUN npm run build:shared && npm run build --workspace @aether/daemon

# ── Runtime ──────────────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS run
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app /app
WORKDIR /app/apps/daemon
EXPOSE 8080
CMD ["node", "dist/index.js"]
