# Chrome Extension

The extension is a Vite-built Manifest V3 Chrome extension for Colonist.io. It
has two jobs:

1. **Stats upload.** It reads the completed game's statistics from the page,
   identifies the local player, and uploads the result (plus the full recorded
   game log) to the backend API.
2. **Game recording and optional autoplay.** It records the game's websocket
   traffic and can forward it to the `catan-clanker` service, which can choose
   moves for the player. Autoplay is off by default.

## Running and building

From this directory:

```sh
npm install
npm run dev     # local: watch mode, targets the local Docker stack
npm run build   # production: targets the published backend
```

Backend and bot-service URLs are fixed per build, not per user. They are set in
the `TARGETS` table in `vite.config.ts` and injected as `__API_BASE_URL__` and
`__BOT_SERVICE_URL__`:

| Command | Mode | Backend | Bot service |
| --- | --- | --- | --- |
| `npm run dev` | `development` | `http://localhost:3000` | `http://localhost:8000` |
| `npm run build` | production | `https://amaori-renako.com` | none (empty) |

An empty `botServiceUrl` means the recorder never calls `catan-clanker`. Set it
to the service's public HTTPS URL, and add that origin to `host_permissions` in
`manifest.json`, once the service is deployed. For a one-off local build without
watch mode, run `npx vite build --mode development`.

Load the generated `dist/` directory in Chrome through `chrome://extensions`
with Developer mode enabled and **Load unpacked**. Reload the extension and
refresh any open colonist.io tab after each rebuild.

Before publishing to the Chrome Web Store, build with `npm run build` and bump
`version` in `manifest.json`.

The Vite build copies `manifest.json` and the PNG icons into `dist/`, emits the
popup page, and creates `content.js`, `recorder.js` and `background.js` from the
TypeScript entry points.

## Structure

```text
extension/
|-- manifest.json       # Manifest V3 permissions, host matches, and entry points
|-- popup.html          # Popup markup
|-- src/
|   |-- content.ts      # Colonist scraping lifecycle and API submission
|   |-- recorder.ts     # Websocket recorder and bot client (page MAIN world)
|   |-- scraper.ts      # DOM scraper strategies
|   |-- coordinator.ts  # Runs all scraper strategies in sequence
|   |-- background.ts   # Service worker for credentials, icon, and notifications
|   |-- popup.ts        # Connection status, errors, autoplay toggle, disconnect
|   |-- types.ts        # Game payload and scraper types
|   |-- env.d.ts        # Declarations for build-time URL constants
|   `-- style.css       # Popup/content styling
|-- icons/              # Connected and disconnected extension icons
|-- vite.config.ts      # Multi-entry Vite build, per-mode URLs, asset copying
`-- dist/               # Generated extension package, not source
```

## Runtime modules

### Content script

`content.ts` runs on Colonist pages. It detects completed games, prevents
duplicate processing for the same lobby, and asks `ScrapeCoordinator` to run
the scraper strategies. It stores the local player's lobby name as
`session_me`, adds the `isMe` flag to the overview, builds the upload payload,
and posts it to the backend. It also relays the popup's autoplay setting to the
recorder (see below).

### Recorder

`recorder.ts` runs in the page's own JavaScript world (`"world": "MAIN"`, at
`document_start`) so it can wrap `window.WebSocket` before Colonist opens its
socket. The content script runs in Chrome's isolated world and cannot see the
page's WebSocket, so the two scripts communicate through window events.

The recorder:

- decodes the MessagePack websocket traffic and keeps every event of the current
  game, starting at the game-start message;
- logs `GAME START` and `GAME END` lines to the page console (filter by
  `Renako`);
- at game end, dispatches `renako-game-complete` with the full log, which the
  content script attaches to the upload as `game_log`;
- if a bot-service URL is configured, forwards game events to
  `POST <botServiceUrl>/api/bot/games/events`. A failed call is logged and does
  not interrupt recording;
- when autoplay is enabled, encodes the service's chosen action as a Colonist
  frame and sends it after a one-second delay, and auto-declines incoming trade
  offers.

The recorder only starts when it sees the game-start message, so a game that is
joined by refreshing the page mid-game is not recorded.

> The recorder still downloads a `renako-<gameId>.json` file at game end. This
> is a debugging and training-data aid, not intended behavior for end users.

### Scraper strategies

`scraper.ts` contains a shared `BaseScraper` for tab navigation, table reading,
and chart reading. The concrete strategies collect:

- `OverviewScraper`: player names, victory points, bot flags, and winner.
- `DiceScraper`: dice-roll counts.
- `ResCardScraper`: resource-card statistics.
- `DevCardScraper`: development-card statistics.
- `ActivityScraper`: per-player activity table.
- `ResourceScraper`: per-player resource table.

The selectors target Colonist's rendered DOM. Changes to Colonist tab names,
class names, or table markers may require scraper updates.

### Coordinator

`coordinator.ts` runs the registered strategies sequentially with a short delay
between each strategy. It returns a `Partial<GameStats>` object and restores
the user's original active tab after scraping.

### Background service worker

`background.ts` stores `discordId`, `apiKey`, and a connection timestamp in
`chrome.storage.local`. It receives `SET_CREDENTIALS` through
`chrome.runtime.onMessageExternal`, updates the connected/disconnected icon,
and forwards game upload success or failure to the popup.

### Popup

`popup.ts` reads stored credentials, displays connection state, renders upload
errors and success messages, and clears the API key and Discord ID when the user
disconnects. It also hosts the **Let Renako play for me** checkbox, stored as
`botSendsActions` in `chrome.storage.local`. It is off by default and is a
per-user runtime setting, so it can be switched off without a new release.
`content.ts` relays the value to the recorder as a `renako-settings` event.

## Backend contract

The extension submits to the build's backend URL (`__API_BASE_URL__`):

```text
POST <apiBaseUrl>/api/games/ingest
Content-Type: application/json
x-api-key: <api key from chrome.storage.local>
```

Payload shape:

```json
{
  "lobbyId": "lobby-id",
  "timestamp": "2026-01-01T12:00:00.000Z",
  "overview": [
    {
      "name": "Player",
      "vp": 10,
      "isBot": false,
      "isWinner": true,
      "isMe": true
    }
  ],
  "dice_stats": {},
  "res_card_stats": {},
  "dev_card_stats": {},
  "activity_stats": [],
  "resource_stats": [],
  "game_log": []
}
```

`game_log` is the full decoded websocket event stream captured by the recorder.

The backend returns `201` with `{ "success": true, "gameId": ... }` when the
game is stored. Errors are shown in the page banner and popup. The backend
rejects games with one human and three or more bots (`400 Bot Farming
Detected`) unless it runs with `ALLOW_BOT_GAMES=true`, which is for local
testing only.

## Authentication flow

1. A user runs `/link` in Discord and opens the backend OAuth login link.
2. The backend authenticates Discord and renders the success page.
3. The success page sends `SET_CREDENTIALS` to the extension with the Discord
   ID and generated API key.
4. The background worker stores the credentials locally.
5. Future game uploads use the API key in `x-api-key`.

The backend's `EXTENSION_ID` value must match the installed extension's ID when
the success page sends the credentials. An unpacked build gets its own ID from
Chrome, so set `EXTENSION_ID` to that value for local testing.

## Permissions and host access

The manifest grants storage and notification permissions. `host_permissions`
and `externally_connectable` list `localhost`, the current production host
`https://amaori-renako.com`, and the previous host `https://renako.ootduck.com`
(kept during the move). The linking page can only message the extension from an
origin listed in `externally_connectable`, so a new backend host must be added
there. Content scripts run on `https://colonist.io/*`.

## Troubleshooting

- The popup says **Handshake Required**: run `/link`, complete OAuth, and make
  sure the extension is loaded from the expected build.
- Upload returns `401`: credentials are missing from extension storage.
- Upload returns `403`: the API key is invalid or stale; reconnect the account.
- No game is uploaded: inspect the page console for selector changes and verify
  the game-end DOM still contains the expected Colonist tabs and tables.