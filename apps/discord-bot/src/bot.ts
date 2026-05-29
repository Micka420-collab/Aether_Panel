import { Client, GatewayIntentBits, Events, EmbedBuilder, type ChatInputCommandInteraction } from "discord.js";
import { aether, resolveServer } from "./api.js";

const ACCENT = 0x22b8d8;
const stateColor = (s: string) => (s === "running" ? 0x34d399 : s === "errored" ? 0xf85149 : 0xfbbf24);

export function createBot(): Client {
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });

  client.once(Events.ClientReady, (c) => console.log(`🤖 Aether bot online as ${c.user.tag}`));

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    try {
      await handle(interaction);
    } catch (e: any) {
      const msg = `⚠️ ${e?.message ?? "command failed"}`;
      if (interaction.deferred || interaction.replied) await interaction.editReply(msg);
      else await interaction.reply({ content: msg, ephemeral: true });
    }
  });

  return client;
}

async function handle(i: ChatInputCommandInteraction) {
  await i.deferReply();

  if (i.commandName === "servers") {
    const servers = await aether.servers();
    if (!servers.length) return void i.editReply("You have no servers.");
    const embed = new EmbedBuilder()
      .setColor(ACCENT)
      .setTitle("Your Aether servers")
      .setDescription(
        servers
          .map((s) => `**${s.name}** \`${s.game}\` — ${s.state}\n\`${s.id}\`${s.address ? ` · ${s.address}` : ""}`)
          .join("\n\n"),
      );
    return void i.editReply({ embeds: [embed] });
  }

  const ref = i.options.getString("server", true);
  const srv = await resolveServer(ref);
  if (!srv) return void i.editReply(`No server matching \`${ref}\`.`);

  switch (i.commandName) {
    case "status": {
      const c = await aether.connection(srv.id);
      const embed = new EmbedBuilder()
        .setColor(stateColor(c.state))
        .setTitle(srv.name)
        .addFields(
          { name: "State", value: c.state, inline: true },
          { name: "Address", value: c.address || "—", inline: true },
          { name: "Players", value: c.players ? `${c.players.online}/${c.players.max}` : "—", inline: true },
        );
      if (c.version) embed.setFooter({ text: `v${c.version}` });
      return void i.editReply({ embeds: [embed] });
    }
    case "start":
    case "stop":
    case "restart": {
      await aether.power(srv.id, i.commandName);
      return void i.editReply(`✅ Sent **${i.commandName}** to **${srv.name}**.`);
    }
    case "players": {
      const r = await aether.resources(srv.id);
      const p = r.resources?.players;
      return void i.editReply(p ? `**${srv.name}** — ${p.online}/${p.max} online${p.sample?.length ? `: ${p.sample.join(", ")}` : ""}` : `No player data for **${srv.name}** (is it running?).`);
    }
    case "console": {
      const command = i.options.getString("command", true);
      await aether.command(srv.id, command);
      return void i.editReply(`✅ Ran \`${command}\` on **${srv.name}**.`);
    }
  }
}
