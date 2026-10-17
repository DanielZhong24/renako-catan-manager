# Backend Service

The backend is a Hono API running on Node.js. It handles Discord OAuth,
extension authentication, game ingestion, Discord bot queries, and the
server-rendered admin interface. PostgreSQL is the source of truth for users,
identities, games, player statistics, and sessions.

## Running

From this directory:

```sh
npm install
npm run dev
```

The development server listens on `http://localhost:3000` by default. For the
full local environment, use the repository root's Docker Compose setup instead:

```sh
docker compose up --build
```

Available scripts:

| Script | Purpose |
| --- | --- |
| `npm run dev` | Run `tsx watch` for local development. |
| `npm run build` | Compile TypeScript to `dist`. |
| `npm start` | Run the compiled application. |

Required configuration is documented in the root `.env.example`.

## Structure

```text
backend/
|-- src/index.ts          # Application entry point and route mounting
|-- routes/
|   |-- authRoutes.ts     # Discord OAuth login and callback
|   |-- gameRoutes.ts     # Extension game ingestion
|   |-- discordRoutes.ts  # Bot-facing stats and session API
|   `-- adminRoutes.ts    # Admin login and server-rendered management pages
|-- services/
|   |-- userService.ts    # Users, Catan identities, stats, history, leaderboards
|   |-- gameService.ts    # Transactional game/player persistence and summaries
|   |-- sessionService.ts # Pending Discord game sessions
|   `-- adminService.ts   # Admin credentials, sessions, CRUD, and analytics
|-- schemas/gameSchema.ts # Zod validation for extension payloads
|-- db/
|   |-- db.ts             # PostgreSQL connection pool
|   `-- db-init/init.sql  # Tables, cleanup, and reporting views
|-- views/                # TSX HTML renderers for auth success and admin pages
`-- Dockerfile
```

`src/index.ts` creates the Hono application, enables logging and CORS, and
mounts each route group. Services own SQL access so route handlers coordinate
requests without duplicating database queries.

## API endpoints

All paths below are relative to `http://localhost:3000`.

### Authentication

| Method | Path | Description |
| :--- | :--- | :--- |
| `GET` | `/api/auth/login` | Starts Discord OAuth and sets a CSRF state cookie. |
| `GET` | `/api/auth/callback` | Exchanges the Discord code, upserts the user, and returns the extension-link success page. |

The callback URL must match both `REDIRECT_URI` and the Discord Developer Portal
configuration.

### Game ingestion

<table>
<thead>
<tr><th>Method</th><th>Path</th><th>Auth</th><th>Description</th></tr>
</thead>
<tbody>
<tr><td><code>POST</code></td><td><code>/api/games/ingest</code></td><td><code>x-api-key</code></td><td>Validates and stores one game and its player statistics.</td></tr>
</tbody>
</table>

The request body must contain `lobbyId`, an ISO `timestamp`, `overview`,
`dice_stats`, `res_card_stats`, `activity_stats`, and `resource_stats`.
Each overview player includes `name`, `vp`, `isBot`, `isWinner`, and `isMe`.
The uploader is identified by the API key. The operation links the uploader's
Catan name, resolves a guild from an active session when possible, and writes
the game and player rows in a PostgreSQL transaction.

### Discord-facing API

These endpoints use an in-memory rate limiter keyed by Discord ID, request IP,
or user agent. The bot sends `x-discord-id` when available.

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/discord/stats/:discordId` | Returns a user's game count, wins, win rate, and average VP. |
| `GET` | `/api/discord/history/:discordId` | Returns the user's tracked game history. |
| `GET` | `/api/discord/leaderboard/:guildId?limit=10` | Returns a guild leaderboard, limited to 1-50 entries. |
| `GET` | `/api/discord/user/:discordId` | Checks whether a Discord account is linked. |
| `GET` | `/api/discord/search?name=...` | Looks up statistics by Catan username. |
| `POST` | `/api/discord/sessions` | Creates a pending session from `uploaderId`, `guildId`, and `channelId`. |

### Admin pages

Admin routes use the `admin_session` HTTP-only cookie. Login is required for all
routes after `/admin/login`.

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/admin/login` | Displays the admin login form. |
| `POST` | `/admin/login` | Validates credentials and creates an eight-hour session. |
| `POST` | `/admin/logout` | Deletes the current session. |
| `GET` | `/admin` | Overview counts and system summary. |
| `GET` | `/admin/users` | Lists users. |
| `GET` | `/admin/users/new` | Displays the user creation form. |
| `POST` | `/admin/users` | Creates a user. |
| `GET` | `/admin/users/:discordId` | Shows a user and linked Catan identities. |
| `POST` | `/admin/users/:discordId` | Updates a user. |
| `POST` | `/admin/users/:discordId/delete` | Deletes a user. |
| `POST` | `/admin/users/identities` | Links a Catan name to a Discord ID. |
| `GET` | `/admin/games` | Lists stored games. |
| `GET` | `/admin/games/:gameId` | Shows a game and its players. |
| `GET` | `/admin/analytics` | Displays analytics series and top players. |
| `GET` | `/admin/servers` | Lists tracked servers. |

## Data model

`db/db-init/init.sql` creates:

- `users` and `catan_identities` for Discord-to-Catan identity mapping.
- `games` and `player_stats` for game results and JSONB statistics.
- `pending_sessions` for the Discord `/play` to extension upload handoff.
- `admin_users` and `admin_sessions` for admin authentication.
- `user_stats_view`, `leaderboard_view`, and `history_view` for reporting.

## Game ingestion flow

1. The extension sends a validated payload with `x-api-key`.
2. The API resolves the uploader and links the uploader's Catan name.
3. An active Discord session supplies the guild and channel when available.
4. `GameService` upserts the game, replaces its player rows, and commits the
	 transaction.
5. For guild games, the backend requests a match-summary announcement from the
	 bot's `/announce` endpoint.

## Troubleshooting

- `401 Missing API Key`: connect the extension through Discord first.
- `403 Invalid API Key`: the extension has stale credentials; use `/link` and
	reconnect it.
- OAuth errors: verify `DISCORD_AUTH_URL`, `REDIRECT_URI`, and the Discord
	application's registered redirect URL are identical.
- Database connection errors: start PostgreSQL with Compose and verify the
	`DB_USER`, `DB_PASSWORD`, and `DB_NAME` values.
