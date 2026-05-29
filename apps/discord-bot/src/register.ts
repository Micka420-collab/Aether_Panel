import { REST, Routes } from "discord.js";
import { commands } from "./commands.js";

const token = process.env.DISCORD_TOKEN!;
const clientId = process.env.DISCORD_CLIENT_ID!;
const guildId = process.env.DISCORD_GUILD_ID; // optional: instant registration in one guild

if (!token || !clientId) {
  console.error("Set DISCORD_TOKEN and DISCORD_CLIENT_ID");
  process.exit(1);
}

const rest = new REST({ version: "10" }).setToken(token);

const route = guildId ? Routes.applicationGuildCommands(clientId, guildId) : Routes.applicationCommands(clientId);

rest
  .put(route, { body: commands })
  .then(() => console.log(`✓ Registered ${commands.length} commands ${guildId ? `to guild ${guildId}` : "globally"}`))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
