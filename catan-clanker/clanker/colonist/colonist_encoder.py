"""Encode Colonist websocket captures for the Catanatron policy pipeline.

The websocket tracker produces normalized, pre-action observations. Converting
one of those observations into the model's 1002 features requires a
Catanatron-compatible Game built with the board/player lookup tables for the
source game; this module validates that final boundary rather than guessing
Colonist corner, edge, and tile IDs.
"""
"""143, 122, 94 invalid websocket sequence"""
import copy
import json
from pathlib import Path
from typing import Any, Callable, Iterator

from catanatron.game import Game
from catanatron.models.enums import (
    BRICK,
    CITY,
    ORE,
    ROAD,
    SETTLEMENT,
    SHEEP,
    WHEAT,
    WOOD,
    EdgeRef,
    NodeRef,
    ActionPrompt,
)
from catanatron.models.map import BASE_MAP_TEMPLATE, CatanMap
from catanatron.models.player import Color, SimplePlayer


WEBSOCKET_SCHEMA_VERSION = "colonist_ws_v1"
FEATURE_VERSION = "catanatron_v1"
ACTION_ENCODING_VERSION = "v1"
EXPECTED_FEATURE_COUNT = 1002

RESOURCE_IDS = {
    0: "desert",
    1: "lumber",
    2: "brick",
    3: "wool",
    4: "grain",
    5: "ore",
}
CARD_IDS = {
    1: "lumber",
    2: "brick",
    3: "wool",
    4: "grain",
    5: "ore",
    7: "knight",
    8: "victory_point",
    9: "monopoly",
    10: "road_building",
    11: "year_of_plenty",
}

COLONIST_PORT_TYPE_TO_CATANATRON = {
    1: None,
    2: WOOD,
    3: BRICK,
    4: SHEEP,
    5: WHEAT,
    6: ORE,
}
class EncodingError(ValueError):
    """Raised when a capture cannot be safely encoded."""


def _merge_dict(target: dict, diff: dict) -> None:
    """Apply a websocket object diff without replacing sibling state."""
    for key, value in diff.items():
        if isinstance(value, dict) and isinstance(target.get(key), dict):
            _merge_dict(target[key], value)
        else:
            target[key] = copy.deepcopy(value)


def _game_id(metadata: dict, snapshot: dict) -> str | None:
    details = snapshot.get("gameDetails", {})
    return str(
        metadata.get("databaseGameId")
        or details.get("databaseGameId")
        or details.get("gameId")
        or ""
    ) or None


def _normalize_state(metadata: dict, snapshot: dict, source_sequence: int) -> dict:
    state = snapshot.get("gameState")
    if not isinstance(state, dict):
        raise EncodingError("type 4 snapshot has no gameState object")

    dice = state.get("diceState", {})
    bank = state.get("bankState", {})
    current = state.get("currentState", {})
    map_state = state.get("mapState", {})
    return {
        "websocket_schema_version": WEBSOCKET_SCHEMA_VERSION,
        "action_encoding_version": ACTION_ENCODING_VERSION,
        "game_id": _game_id(metadata, snapshot),
        "player_color": snapshot.get("playerColor"),
        "play_order": snapshot.get("playOrder", []),
        "phase": "UNKNOWN",
        "current_player": current.get("currentTurnPlayerColor"),
        "completed_turns": current.get("completedTurns"),
        "action_state": current.get("actionState"),
        "dice": {
            "thrown": dice.get("diceThrown", False),
            "first": dice.get("dice1"),
            "second": dice.get("dice2"),
        },
        "bank": {
            "resources": {
                RESOURCE_IDS.get(int(resource), str(resource)): count
                for resource, count in bank.get("resourceCards", {}).items()
            },
            "development_cards": None,
        },
        "tiles": map_state.get("tileHexStates", {}),
        "corners": map_state.get("tileCornerStates", {}),
        "edges": map_state.get("tileEdgeStates", {}),
        "ports": map_state.get("portEdgeStates", {}),
        "players": state.get("playerStates", {}),
        "robber_tile": state.get("mechanicRobberState", {}).get(
            "locationTileIndex"
        ),
        "legal_actions": [],
        "source_sequence": source_sequence,
        "raw_state": state,
    }


def _canonical_action(action_type: str, parameter: Any = None) -> dict:
    return {"type": action_type, "parameter": parameter}


def _availability_actions(message_type: int, payload: Any) -> list[dict]:
    """Convert availability messages while preserving source board indices."""
    if not isinstance(payload, list):
        return []

    action_type = {30: "BUILD_SETTLEMENT", 31: "BUILD_ROAD", 33: "MOVE_ROBBER"}.get(
        message_type
    )
    if action_type is None:
        return []

    return [_canonical_action(action_type, item) for item in payload]


class ColonistWebsocketEncoder:
    """Replay a raw websocket capture into normalized pre-action observations."""

    def __init__(self):
        self.metadata: dict = {}
        self.snapshot: dict | None = None
        self.observation: dict | None = None
        self.last_sequence: int | None = None

    def observations(self, records: list[dict]) -> Iterator[dict]:
        for record in records:
            data = record.get("data", {})
            message_type = data.get("type")
            sequence = data.get("sequence")
            if sequence is not None:
                if self.last_sequence is not None and sequence <= self.last_sequence:
                    raise EncodingError(f"Invalid websocket sequence: {sequence}")
                self.last_sequence = sequence

            if message_type == 1:
                self.metadata = data.get("payload", {})
                continue

            if message_type == 4:
                self.snapshot = data.get("payload", {})
                self.observation = _normalize_state(
                    self.metadata,
                    self.snapshot,
                    sequence or 0,
                )
                continue

            if self.observation is None:
                continue

            if message_type == 91:
                diff = data.get("payload", {}).get("diff", {})
                _merge_dict(self.observation["raw_state"], diff)
                refreshed = _normalize_state(
                    self.metadata,
                    {**self.snapshot, "gameState": self.observation["raw_state"]},
                    sequence or 0,
                )
                # Availability pushes from earlier messages describe a decision
                # that has now changed; do not leak them into the new state.
                refreshed["legal_actions"] = []
                # Diff-level turn signals: a real turn start announces itself
                # inside this diff; merged state alone cannot distinguish a
                # fresh turn from setup placement.
                diff_dice = diff.get("diceState", {})
                diff_current = diff.get("currentState", {})
                refreshed["last_diff"] = {
                    "dice_thrown": diff_dice.get("diceThrown")
                    if isinstance(diff_dice, dict)
                    else None,
                    "turn_player": diff_current.get("currentTurnPlayerColor")
                    if isinstance(diff_current, dict)
                    else None,
                }
                self.observation.update(refreshed)
                yield copy.deepcopy(self.observation)
                continue

            if message_type in (30, 31, 33):
                self.observation["legal_actions"] = _availability_actions(
                    message_type,
                    data.get("payload"),
                )
                self.observation["source_sequence"] = sequence or 0
                yield copy.deepcopy(self.observation)

    def process(self, record: dict) -> list[dict]:
        """
        Consume one websocket envelope.
        Return zero or more decision observations.
        """
        return list(self.observations([record]))
    
    @classmethod
    def from_file(cls, path: str | Path) -> Iterator[dict]:
        records = json.loads(Path(path).read_text(encoding="utf-8"))
        if not isinstance(records, list):
            raise EncodingError("websocket capture must contain a JSON list")
        yield from cls().observations(records)


def feature_manifest(num_players: int = 4, map_type: str = "BASE") -> list[str]:
    """Return the exact ordered feature names used by catanatron_v1."""
    from catanatron.features import get_feature_ordering

    features = get_feature_ordering(num_players, map_type)
    if len(features) != EXPECTED_FEATURE_COUNT:
        raise EncodingError(
            f"Expected {EXPECTED_FEATURE_COUNT} features, got {len(features)}"
        )
    return features


def _axial_to_cube(x: Any, y: Any) -> tuple[int, int, int]:
    x_value = int(x)
    y_value = int(y)
    return (x_value, y_value, -x_value - y_value)


NODE_COORDINATE_OFFSETS = {
    NodeRef.NORTH: (0, 0, 0),
    NodeRef.NORTHEAST: (1, -1, 1),
    NodeRef.SOUTHEAST: (0, 1, 0),
    NodeRef.SOUTH: (0, 0, 1),
    NodeRef.SOUTHWEST: (-1, 1, 0),
    NodeRef.NORTHWEST: (0, -1, 1),
}

EDGE_COORDINATE_OFFSETS = {
    EdgeRef.EAST: (1, 0, 1),
    EdgeRef.SOUTHEAST: (0, 1, 0),
    EdgeRef.SOUTHWEST: (0, 0, 2),
    EdgeRef.WEST: (0, 0, 1),
    EdgeRef.NORTHWEST: (0, 0, 0),
    EdgeRef.NORTHEAST: (1, -1, 2),
}
EDGE_ENDPOINT_REFS = {
    EdgeRef.EAST: (NodeRef.NORTHEAST, NodeRef.SOUTHEAST),
    EdgeRef.SOUTHEAST: (NodeRef.SOUTHEAST, NodeRef.SOUTH),
    EdgeRef.SOUTHWEST: (NodeRef.SOUTH, NodeRef.SOUTHWEST),
    EdgeRef.WEST: (NodeRef.SOUTHWEST, NodeRef.NORTHWEST),
    EdgeRef.NORTHWEST: (NodeRef.NORTHWEST, NodeRef.NORTH),
    EdgeRef.NORTHEAST: (NodeRef.NORTH, NodeRef.NORTHEAST),
}


def _offset_coordinate(x: int, y: int, offset: tuple[int, int, int]):
    return (x + offset[0], y + offset[1], offset[2])


def _colonist_corner_tiles(x: int, y: int, z: int) -> frozenset:
    """Cube coordinates of the three tiles meeting at a Colonist corner."""
    if z == 0:
        tiles = ((x, y), (x, y - 1), (x + 1, y - 1))
    else:
        tiles = ((x, y), (x - 1, y + 1), (x, y + 1))
    return frozenset(_axial_to_cube(a, b) for a, b in tiles)


def _board_coordinate_maps(catan_map: CatanMap):
    """Map Colonist corner/edge coordinates to Catanatron node ids/edges.

    A corner is identified by the three tiles (water included) that meet at
    it. Both boards describe the same hex lattice, so this match is exact.
    """
    node_tiles: dict[int, set] = {}
    for coordinate, tile in catan_map.tiles.items():
        for node_id in tile.nodes.values():
            node_tiles.setdefault(node_id, set()).add(coordinate)
    node_by_tiles = {
        frozenset(node_tiles[node_id]): node_id for node_id in catan_map.land_nodes
    }

    node_coordinates = {}
    for (tile_x, tile_y, _), _tile in catan_map.land_tiles.items():
        for offset in NODE_COORDINATE_OFFSETS.values():
            coordinate = _offset_coordinate(tile_x, tile_y, offset)
            node_id = node_by_tiles.get(_colonist_corner_tiles(*coordinate))
            if node_id is None:
                raise EncodingError(
                    f"No Catanatron node for Colonist corner {coordinate}"
                )
            node_coordinates[coordinate] = node_id
    if len(set(node_coordinates.values())) != len(catan_map.land_nodes):
        raise EncodingError("Colonist and Catanatron corners do not match 1:1")

    edge_coordinates = {}
    for (tile_x, tile_y, _), _tile in catan_map.land_tiles.items():
        for edge_ref, (node_a_ref, node_b_ref) in EDGE_ENDPOINT_REFS.items():
            coordinate = _offset_coordinate(
                tile_x, tile_y, EDGE_COORDINATE_OFFSETS[edge_ref]
            )
            node_a_coordinate = _offset_coordinate(
                tile_x, tile_y, NODE_COORDINATE_OFFSETS[node_a_ref]
            )
            node_b_coordinate = _offset_coordinate(
                tile_x, tile_y, NODE_COORDINATE_OFFSETS[node_b_ref]
            )
            try:
                normalized_edge = tuple(
                    sorted(
                        (
                            node_coordinates[node_a_coordinate],
                            node_coordinates[node_b_coordinate],
                        )
                    )
                )
            except KeyError as error:
                raise EncodingError(
                    f"No Catanatron endpoint for Colonist edge {coordinate}"
                ) from error
            previous = edge_coordinates.setdefault(coordinate, normalized_edge)
            if previous != normalized_edge:
                raise EncodingError(
                    f"Colonist edge coordinate collision at {coordinate}"
                )
    return node_coordinates, edge_coordinates


def _location_coordinate(raw: Any):
    if not isinstance(raw, dict) or raw.get("x") is None or raw.get("y") is None:
        return None
    return (int(raw["x"]), int(raw["y"]), int(raw.get("z", 0)))



