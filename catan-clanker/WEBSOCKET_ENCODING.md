# Colonist WebSocket Encoding Contract

This document defines the versioned contract between recorded Colonist websocket
messages and the model-input adapter.

## Versions

```text
websocket_schema_version: colonist_ws_v1
feature_version: catanatron_v1
action_encoding_version: v1
```

These versions have different responsibilities:

- `colonist_ws_v1` describes the normalized Colonist protocol data.
- `catanatron_v1` is the model feature contract used by
  `data/teacherV1_1game.jsonl`. It must only be attached after an adapter has
  produced the exact 1002-value vector.
- `v1` describes canonical action names and parameters. It is the same action
  encoding used by the training rows.

A raw websocket record must never claim to contain `catanatron_v1` features.

## Normalized observation

The adapter consumes a complete snapshot followed by state changes in arrival
order. The canonical observation is:

```json
{
  "websocket_schema_version": "colonist_ws_v1",
  "feature_version": "catanatron_v1",
  "action_encoding_version": "v1",
  "game_id": "257278212",
  "player_color": 1,
  "play_order": [1, 2, 3, 4],
  "phase": "SETUP|MAIN|FORCED|ROBBER|DISCARD",
  "current_player": 1,
  "dice": {
    "thrown": false,
    "first": 1,
    "second": 1
  },
  "bank": {
    "resources": {
      "lumber": 19,
      "brick": 19,
      "wool": 19,
      "grain": 19,
      "ore": 19
    },
    "development_cards": null
  },
  "tiles": [],
  "corners": {},
  "edges": {},
  "players": {},
  "robber_tile": null,
  "legal_actions": [],
  "source_sequence": 0
}
```

The `features` field is added only by the model adapter:

```json
{
  "features": [0.0, 0.0],
  "feature_length": 1002
}
```

The adapter must reject an observation unless `feature_length == 1002` and the
feature index manifest for `catanatron_v1` is available.

## Protocol source mapping

| Colonist message | Normalized field |
| ---: | --- |
| type `1` | game id and session metadata |
| type `4` | complete initial observation |
| type `28` | resource distribution event |
| type `30` | `legal_actions` with settlement/city corners |
| type `31` | `legal_actions` with road edges |
| type `33` | `legal_actions` with robber tiles |
| type `43` | trade event |
| type `91` | merge `payload.diff` into the observation |
| type `45` | terminal game event |

For type `91`, apply `payload.diff` before creating the next model
observation. A decision observation must represent the state before its action.

## Enum mappings

Colonist resource and tile IDs:

| Colonist id | Canonical name |
| ---: | --- |
| 0 | desert |
| 1 | lumber |
| 2 | brick |
| 3 | wool |
| 4 | grain |
| 5 | ore |

Colonist card IDs:

| Colonist id | Canonical name |
| ---: | --- |
| 1 | lumber |
| 2 | brick |
| 3 | wool |
| 4 | grain |
| 5 | ore |
| 7 | knight |
| 8 | victory_point |
| 9 | monopoly |
| 10 | road_building |
| 11 | year_of_plenty |

Player colors remain numeric in the websocket adapter. The feature adapter must
map them to the fixed Catanatron player order and then apply the model's player
perspective.

## Canonical action encoding v1

The model-facing action is always an object with a `type` and optional
`parameter`:

```json
{"type":"BUILD_SETTLEMENT","parameter":21}
```

The parameter is a Colonist board index until the feature/action adapter maps it
to the Catanatron action index.

| Canonical action | Parameter |
| --- | --- |
| `ROLL` | `null` |
| `END_TURN` | `null` |
| `BUILD_ROAD` | edge index |
| `BUILD_SETTLEMENT` | corner index |
| `BUILD_CITY` | corner index |
| `MOVE_ROBBER` | tile index |
| `DISCARD_RESOURCE` | resource name |
| `MARITIME_TRADE` | trade object |
| `BUY_DEVELOPMENT_CARD` | `null` |
| `PLAY_DEVELOPMENT_CARD` | card name/object |
| `STEAL_RESOURCE` | victim player color |
| `PLAYER_TRADE` | trade object |

Setup placement messages use the same canonical build actions. The distinction
between setup and normal building belongs in `phase`, not in the action type.

## Action conversion rules

Nested type `91` game-log entries are converted as follows:

| game-log type | `pieceEnum` | Canonical action |
| ---: | ---: | --- |
| 4 or 5 | 0 or 1 | `BUILD_ROAD` |
| 4 or 5 | 2 | `BUILD_SETTLEMENT` |
| 4 or 5 | 3 | `BUILD_CITY` |
| 10 | absent | `ROLL` |
| 11 | absent | `MOVE_ROBBER` |
| 16 | absent | `STEAL_RESOURCE` |
| 20 | absent | `PLAY_DEVELOPMENT_CARD` |
| 44 | absent | `END_TURN` |
| 115 | absent | `PLAYER_TRADE` |
| 116 | absent | `MARITIME_TRADE` |

A type `91` log entry identifies what happened, but its associated state diff
must be used to obtain the exact corner, edge, tile, card, or player parameter.
Do not infer a location from the log type alone.

## Legal-action conversion

Availability messages become legal actions before inference:

```text
30: BUILD_SETTLEMENT or BUILD_CITY for each legal corner
31: BUILD_ROAD for each legal edge
33: MOVE_ROBBER for each legal robber tile
```

The current phase and player resources then filter those candidates. The model
must only select from the filtered legal actions.

## Required alignment checks

Before passing an observation to the model, verify:

1. A type `4` snapshot has been received.
2. All state diffs are applied in sequence order.
3. No source sequence gap or duplicate exists.
4. The player-color mapping is fixed for the whole game.
5. Hex, corner, and edge indices are mapped through explicit lookup tables.
6. Resource/card enums have been translated through the tables above.
7. The observation is pre-action, not post-action.
8. The encoded vector has exactly 1002 values.
9. The vector uses the original `catanatron_v1` index order and normalization.
10. The selected action exists in `legal_actions`.

## Important limitation

This contract does not invent the missing `catanatron_v1` feature index map. The
original Catanatron encoder must still be recovered or recreated and recorded as
an explicit manifest. Until then, `colonist_ws_v1` can normalize the live state,
but it cannot honestly claim that its output is model-compatible.
