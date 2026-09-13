# Chrome Extension

The extension is a Vite-built Manifest V3 Chrome extension for Colonist.io. It
reads the completed game's statistics from the page, identifies the local
player, and uploads the result to the backend API.

## Running and building

From this directory:

```sh
npm install
npm run build
```

`npm run dev` runs `vite build --watch`, which rebuilds `dist/` when source
files change. Load the generated `dist/` directory in Chrome through
`chrome://extensions` with Developer mode enabled and **Load unpacked**.

The Vite build copies `manifest.json` and the PNG icons into `dist/`, emits the
popup page, and creates `content.js` and `background.js` from the TypeScript
entry points.

## Structure

```text
extension/
|-- manifest.json       # Manifest V3 permissions, host matches, and entry points
|-- popup.html          # Popup markup
|-- src/
|   |-- content.ts      # Colonist scraping lifecycle and API submission
|   |-- scraper.ts      # DOM scraper strategies
|   |-- coordinator.ts  # Runs all scraper strategies in sequence
|   |-- background.ts   # Service worker for credentials, icon, and notifications
|   |-- popup.ts        # Connection status, errors, and disconnect behavior
|   |-- types.ts        # Game payload and scraper types
|   `-- style.css       # Popup/content styling
|-- icons/              # Connected and disconnected extension icons
|-- vite.config.ts      # Multi-entry Vite build and static asset copying
`-- dist/               # Generated extension package, not source
```

## Runtime modules

### Content script

`content.ts` runs on Colonist pages. It detects completed games, prevents
duplicate processing for the same lobby, and asks `ScrapeCoordinator` to run
the scraper strategies. It stores the local player's lobby name as
`session_me`, adds the `isMe` flag to the overview, builds the upload payload,
and posts it to the backend.

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
disconnects.

## Backend contract

The extension submits to:

```text
POST http://localhost:3000/api/games/ingest
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
  "resource_stats": []
}
```

The backend returns `201` with `{ "success": true, "gameId": ... }` when the
game is stored. Errors are shown in the page banner and popup; failed lobbies
are marked so the same game is not repeatedly scraped.

## Authentication flow

1. A user runs `/link` in Discord and opens the backend OAuth login link.
2. The backend authenticates Discord and renders the success page.
3. The success page sends `SET_CREDENTIALS` to the extension with the Discord
   ID and generated API key.
4. The background worker stores the credentials locally.
5. Future game uploads use the API key in `x-api-key`.

The extension ID in `manifest.json` and the backend's `EXTENSION_ID` value must
match the installed extension when the success page validates the connection.

## Permissions and host access

The manifest grants storage and notification permissions. It allows the
extension to communicate with the backend on localhost and the configured
production host, and runs the content script on `https://colonist.io/*`.

## Troubleshooting

- The popup says **Handshake Required**: run `/link`, complete OAuth, and make
  sure the extension is loaded from the expected build.
- Upload returns `401`: credentials are missing from extension storage.
- Upload returns `403`: the API key is invalid or stale; reconnect the account.
- No game is uploaded: inspect the page console for selector changes and verify
  the game-end DOM still contains the expected Colonist tabs and tables.