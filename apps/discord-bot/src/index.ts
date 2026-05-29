import { createBot } from "./bot.js";

const token = process.env.DISCORD_TOKEN;
if (!token) {
  console.error("Set DISCORD_TOKEN (and AETHER_URL / AETHER_TOKEN).");
  process.exit(1);
}

createBot().login(token);
