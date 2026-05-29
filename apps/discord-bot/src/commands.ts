import { SlashCommandBuilder } from "discord.js";

const serverOpt = (b: SlashCommandBuilder) =>
  b.addStringOption((o) => o.setName("server").setDescription("Server name or id").setRequired(true));

export const commands = [
  new SlashCommandBuilder().setName("servers").setDescription("List your Aether servers"),
  serverOpt(new SlashCommandBuilder().setName("status").setDescription("Show a server's status & address")),
  serverOpt(new SlashCommandBuilder().setName("start").setDescription("Start a server")),
  serverOpt(new SlashCommandBuilder().setName("stop").setDescription("Stop a server")),
  serverOpt(new SlashCommandBuilder().setName("restart").setDescription("Restart a server")),
  serverOpt(new SlashCommandBuilder().setName("players").setDescription("Show online players")),
  serverOpt(new SlashCommandBuilder().setName("console").setDescription("Run a console command")).addStringOption((o) =>
    o.setName("command").setDescription("The command to run").setRequired(true),
  ),
].map((c) => c.toJSON());
