# Discord Bot Service

The Discord bot is a Discord.js client that exposes slash commands for Catan
statistics and starts games. It uses the backend API for all application data.
The bot also exposes a small internal Hono server so the backend can ask it to
announce a completed game in Discord.

## Running

From this directory:

```sh
npm install
npm run dev
```

Available scripts:

| Script | Purpose |
| --- | --- |
| `npm run dev` | Run the bot with `tsx watch`. |
| `npm run build` | Compile TypeScript to `dist`. |
| `npm start` | Run the compiled bot. |
| `npm run register` | Register slash commands with Discord. |

In Docker, the root Compose file supplies the bot environment and starts the
watch process automatically.

## Configuration

| Variable | Description |
| --- | --- |
| `DISCORD_TOKEN` | Bot token used to log in and register commands. |
| `DISCORD_CLIENT_ID` | Discord application ID used for command registration. |
| `API_BASE_URL` | URL placed in login links, normally `http://localhost:3000`. |
| `INTERNAL_API_URL` | Backend URL used by `ApiClient`; defaults to `http://api:3000`. |
| `PORT` | Internal bot HTTP port; defaults to `3001`. |

## Structure

```text
discord-bot/
|-- src/index.ts          # Discord client lifecycle and internal server startup
|-- src/deploy-commands.ts# One-shot slash-command registration
|-- commands/              # One class per slash command
|-- api/internalRoutes.ts  # Backend-to-bot announcement endpoint
|-- core/
|   |-- ApiClient.ts       # Typed backend requests and API error classification
|   |-- BotContext.ts      # Context passed to command execute methods
|   |-- CommandHandler.ts  # Dynamic command discovery and registration
|   `-- types.ts           # IBotCommand and shared command types
`-- utils/embedGenerator.ts# Match-summary and error embeds
```

`CommandHandler` scans `src/commands`, dynamically imports command modules, and
registers each primary command and alias with Discord. Each command receives a
shared `ApiClient` and command collection through `BotContext`.

## Slash commands

| Command | Alias | Behavior |
| --- | --- | --- |
| `/help` | `/hp` | Lists available commands and aliases. |
| `/link` | `/lk` | Checks account connection and shows the extension API key or login link. |
| `/play` | `/p` | Creates a 60-minute pending game session and opens Colonist.io. Server-only. |
| `/stats` | `/s` | Displays the requesting user's career statistics. |
| `/history` | `/h` | Displays the user's five most recent tracked games. |
| `/leaderboard` | `/l` | Displays the current server's leaderboard with pagination. Server-only. |
| `/lookup name:<catan-name>` | None | Searches statistics by Catan username. |

The bot passes the invoking Discord ID in `x-discord-id` for API rate limiting.
Commands treat HTTP 404 as a missing record and classify rate-limit or upstream
failures into user-facing error embeds.

## Internal endpoint

The bot's internal Hono server listens on `0.0.0.0:${PORT}`.

| Method | Path | Caller | Description |
| --- | --- | --- | --- |
| `POST` | `/announce` | Backend | Accepts `{ summary, guildId, channelId }`, finds the target channel, and posts a match-summary embed. |

The bot prefers the supplied `channelId`, then a text channel named
`catan-stats`, then the guild system channel. It needs Discord permissions to
view the channel, send messages, and embed links.

## Backend API contract

`ApiClient` calls these backend paths:

- `GET /api/discord/stats/:discordId`
- `GET /api/discord/history/:discordId`
- `GET /api/discord/user/:discordId`
- `GET /api/discord/search?name=...`
- `GET /api/discord/leaderboard/:guildId?limit=10`
- `POST /api/discord/sessions`

The bot does not access PostgreSQL directly. This keeps Discord command logic
focused on interaction and presentation while the backend owns persistence.

## Registering commands

Run this after the bot token and application ID are configured:

```sh
npm run register
```

The normal startup path also registers commands before logging in. Discord bot
permissions and the application installation scope must include the commands
permission for slash commands to appear in a server.