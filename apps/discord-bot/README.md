# Aether Discord control bot

Control your Aether game servers from Discord with slash commands. It talks to
the public `/api/v1` using an **API key** you create in your Aether account
(Account → API keys). Single-tenant: the bot acts as that one account.

## Commands

| Command | Action |
|---------|--------|
| `/servers` | List your servers (name, game, state, id) |
| `/status <server>` | State, address and player count |
| `/start <server>` | Start a server |
| `/stop <server>` | Stop a server |
| `/restart <server>` | Restart a server |
| `/players <server>` | Online players |
| `/console <server> <command>` | Run a console command |

`<server>` matches by name or id (partial allowed).

## Setup

1. Create a Discord application + bot at https://discord.com/developers, copy the
   **bot token** and **application (client) id**. Invite it with the
   `applications.commands` scope.
2. In Aether, create an API key with at least `control.*` and `players.read`.
3. Configure env and run:

```bash
cd apps/discord-bot
export DISCORD_TOKEN=...        # bot token
export DISCORD_CLIENT_ID=...    # application id
export DISCORD_GUILD_ID=...     # optional: a guild id for instant command registration
export AETHER_URL=http://localhost:3000
export AETHER_TOKEN=aeth_...    # your API key

npm install
npm run register   # registers the slash commands (once / after changes)
npm run start      # runs the bot
```

Or build the Docker image: `docker build -f apps/discord-bot/Dockerfile -t aether/discord-bot .`
(the container registers commands on boot, then starts).

The required scopes are enforced by the API key, so the bot can only do what the
key is allowed to do.
