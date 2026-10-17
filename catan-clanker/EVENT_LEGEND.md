# Colonist Event ID Reference

This is the protocol reference used by `readData.py` and `extractData.py`.

## Top-level websocket IDs

| ID | Name | Meaning |
| ---: | --- | --- |
| 1 | `GAME_START` | Starts or joins a game. |
| 4 | `GAME_SNAPSHOT` | Complete initial game state. |
| 28 | `RESOURCE_DISTRIBUTION` | Resource cards distributed after a roll. |
| 30 | `AVAILABLE_BUILDING_CORNERS` | Legal settlement/city locations. |
| 31 | `AVAILABLE_BUILDING_EDGES` | Legal road locations. |
| 33 | `AVAILABLE_ROBBER_TILES` | Tiles where the robber may move. |
| 43 | `TRADE_REQUEST_OR_RESULT` | Trade request or card exchange payload. |
| 45 | `GAME_END` | Final scores and game statistics. |
| 91 | `STATE_DIFF` | Incremental change to the game state. Gameplay logs are nested inside `payload.diff.gameLogState[*].text`. |

Other top-level IDs are retained as `PROTOCOL_TYPE_<id>` until their meaning is confirmed.

## Nested gameplay log IDs

These IDs appear as `payload.diff.gameLogState[*].text.type` inside a type `91` state diff.

| ID | Name | Meaning |
| ---: | --- | --- |
| 4 | `PLACE_*` | Place a road or settlement. |
| 5 | `BUILD_*` | Build a road, settlement, or city. |
| 10 | `ROLL` | Roll two dice. |
| 11 | `MOVE_ROBBER` | Move the robber to another tile. |
| 14 | `DISCARD_DEVELOPMENT_CARD` | Discard or use a development card. |
| 16 | `STEAL_RESOURCE` | Rob another player. |
| 20 | `PLAY_DEVELOPMENT_CARD` | Play a development card. |
| 44 | `END_TURN` | Finish the current player's turn. |
| 45 | `WIN_GAME` | Player wins the game. |
| 47 | `RECEIVE_RESOURCES` | Receive resource cards. |
| 49 | `ROBBER_BLOCK` | Robber blocks resource production. |
| 55 | `DISCARD_RESOURCES` | Discard resource cards. |
| 64 | `PLAYER_CONNECTION_CHANGE` | Player disconnects or reconnects. |
| 66 | `RECEIVE_ACHIEVEMENT` | Receive longest road or largest army. |
| 115 | `PLAYER_TRADE` | Trade cards with another player. |
| 116 | `BANK_TRADE` | Trade cards with the bank. |
| 118 | `OFFER_TRADE` | Offer a trade to another player. |
| 146 | `RESOURCE_DISTRIBUTION_BLOCKED` | Resource production is blocked. |

## Resource and card IDs

### Resources and board tile types

| ID | Meaning |
| ---: | --- |
| 0 | Desert |
| 1 | Lumber |
| 2 | Brick |
| 3 | Wool |
| 4 | Grain |
| 5 | Ore |

### Cards

| ID | Meaning |
| ---: | --- |
| 1 | Lumber |
| 2 | Brick |
| 3 | Wool |
| 4 | Grain |
| 5 | Ore |
| 7 | Knight |
| 8 | Victory point |
| 9 | Monopoly |
| 10 | Road building |
| 11 | Year of plenty |

Player numbers in event payloads are Colonist color IDs, not usernames.
