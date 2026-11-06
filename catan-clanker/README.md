# catan-clanker (bot service)

A FastAPI service that takes recorded Colonist.io websocket events, rebuilds the
game state, and returns the move a trained policy would make. The extension's
recorder is its only client. It is optional: stats uploads and game recording do
not depend on it.

## How it works

1. The extension POSTs each game event to `/api/bot/games/events`.
2. `bot_api.py` keeps one `LiveGameSession` per `game_id` in memory.
3. `colonist_encoder.py` normalizes the websocket events into observations.
4. `BoardTranslator.py` converts the observation into a
   [Catanatron](https://github.com/bcollazo/catanatron) game (vendored in
   `catanatron/`) and encodes the 1002-value feature vector.
5. `policy.py` loads `../models/teacher_policy_v1.pt`, a small MLP
   (input -> 256 -> 128 -> actions), masks the output to the legal actions, and
   picks the best one.
6. The action is translated back to Colonist terms and returned.

Dice rolls are forced protocol actions and never reach the model. Domestic
(player-to-player) trades are not supported; maritime bank trades are.

## API

`POST /api/bot/games/events`

```json
{ "game_id": "269377880", "bot_color": 1, "event": { "data": { "type": 91, "payload": {} } } }
```

`bot_color` may be `null` until the game snapshot arrives.

Responses:

| `status` | Meaning |
| --- | --- |
| `WAIT` | No decision needed for this event. |
| `ACTION` | Includes `action` (`{ type, parameter }`), `via` (`policy` or `forced`), and `decision_kind`. |

Processing errors return HTTP 400 with the exception message. CORS allows
`POST`/`OPTIONS` from `https://colonist.io` only.

## Running

With Docker (from the repository root):

```sh
docker compose up --build catan-clanker
```

The service listens on port `8000`. The image is built from the repository
root because the Dockerfile copies both `catan-clanker/` and `models/`.

Without Docker, from this directory (Python 3.12):

```sh
pip install torch --index-url https://download.pytorch.org/whl/cpu
pip install -r requirements.txt
python -m uvicorn bot_api:app --port 8000
```

## Deployment notes

- **Build context** must be the repository root, with the Dockerfile path set to
  `catan-clanker/Dockerfile`. `models/` must be committed.
- **Port:** the Dockerfile `CMD` binds `8000`. If the host injects its own
  `PORT`, set `PORT=8000` or change the `CMD`.
- **Single worker only.** Sessions live in an in-memory dict and are never
  evicted, so do not run replicas or multiple workers, and expect slow memory
  growth.
- **No authentication.** Anyone who can reach the URL can post events. Put it
  behind the backend or add an API-key check before exposing it publicly.
- **HTTPS** is required for browsers on colonist.io to call it (plain HTTP is
  blocked as mixed content except on `localhost`).
- The extension's production build has no bot-service URL configured; set it in
  `extension/vite.config.ts` after deploying.

## Training and analysis tools

| File | Purpose |
| --- | --- |
| `extractData.py` | Normalizes a recorded game JSON into analytics-friendly records. |
| `readData.py`, `readData1.py` | Print a recorded game in order, or as JSONL. |
| `gameHistory/` | Recorded games used for training data. |
| `../data/teacherV1_1game.jsonl` | Training rows built from one game. |
| `WEBSOCKET_ENCODING.md` | Versioned contract between websocket data and the model input. |
| `EVENT_LEGEND.md` | Colonist event and log ID reference. |
| `test_live_session.py`, `test_scraper_game_builder.py` | Test scripts. |

The model was trained by behaviour cloning on very little data, so expect weak
play.
