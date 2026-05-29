# ── Aether Discord bot ───────────────────────────────────────────────────
FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json* tsconfig.base.json ./
COPY apps/discord-bot ./apps/discord-bot
RUN npm install --no-audit --no-fund --workspace @aether/discord-bot --include-workspace-root=false || npm install --no-audit --no-fund
RUN npm run build --workspace @aether/discord-bot

FROM node:20-bookworm-slim AS run
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app /app
WORKDIR /app/apps/discord-bot
# Register slash commands then start the bot.
CMD ["sh", "-c", "node dist/register.js; node dist/index.js"]
