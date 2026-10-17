"""Encode Colonist websocket captures for the Catanatron policy pipeline.

The websocket tracker produces normalized, pre-action observations. Converting
one of those observations into the model's 1002 features requires a
Catanatron-compatible Game built with the board/player lookup tables for the
source game; this module validates that final boundary rather than guessing
Colonist corner, edge, and tile IDs.
"""

import copy
import json
import networkx as nx
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
)
from catanatron.models.map import BASE_MAP_TEMPLATE, CatanMap
from catanatron.models.player import Color, SimplePlayer
from catanatron.models.tiles import LandTile

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
                self.observation.update(refreshed)
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


def _colonist_color_to_catanatron(color: Any) -> Color:
    mapping = {
        1: Color.RED,
        2: Color.BLUE,
        3: Color.WHITE,
        4: Color.ORANGE,
    }
    if isinstance(color, Color):
        return color
    if isinstance(color, str):
        key = int(color) if color.isdigit() else color.upper()
        return mapping.get(key, Color.RED)
    return mapping.get(int(color), Color.RED)


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


def _board_coordinate_maps(catan_map: CatanMap):
    catan_graph = nx.Graph()
    colonist_graph = nx.Graph()
    for (tile_x, tile_y, _), tile in catan_map.land_tiles.items():
        tile_key = (tile_x, tile_y)
        catan_tile = ("tile", tile_key)
        catan_graph.add_node(catan_tile, kind="tile", key=tile_key)
        for node_id in tile.nodes.values():
            catan_node = ("node", node_id)
            catan_graph.add_node(catan_node, kind="node")
            catan_graph.add_edge(catan_tile, catan_node)

        colonist_tile = ("tile", tile_key)
        colonist_graph.add_node(colonist_tile, kind="tile", key=tile_key)
        for offset in NODE_COORDINATE_OFFSETS.values():
            coordinate = _offset_coordinate(tile_x, tile_y, offset)
            colonist_node = ("node", coordinate)
            colonist_graph.add_node(colonist_node, kind="node")
            colonist_graph.add_edge(colonist_tile, colonist_node)

    def node_match(left: dict, right: dict) -> bool:
        return left["kind"] == right["kind"] and (
            left["kind"] != "tile" or left["key"] == right["key"]
        )

    matcher = nx.isomorphism.GraphMatcher(
        catan_graph,
        colonist_graph,
        node_match=node_match,
    )
    try:
        mapping = next(matcher.isomorphisms_iter())
    except StopIteration as error:
        raise EncodingError("Colonist and Catanatron board topologies do not match") from error

    node_coordinates = {
        colonist_node[1]: catan_node[1]
        for catan_node, colonist_node in mapping.items()
        if catan_node[0] == "node"
    }
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


def _colonist_resource_to_catanatron(resource_id: Any):
    mapping = {
        0: None,
        1: WOOD,
        2: BRICK,
        3: SHEEP,
        4: WHEAT,
        5: ORE,
    }
    if resource_id is None:
        return None
    return mapping.get(int(resource_id), None)


def _build_tiles_from_observation(map_state: dict) -> CatanMap:
    catan_map = CatanMap.from_template(BASE_MAP_TEMPLATE)
    for raw_tile in map_state.get("tileHexStates", {}).values():
        if not isinstance(raw_tile, dict):
            continue
        x = raw_tile.get("x")
        y = raw_tile.get("y")
        if x is None or y is None:
            continue
        coordinate = _axial_to_cube(x, y)
        tile = catan_map.tiles.get(coordinate)
        if not isinstance(tile, LandTile):
            continue
        tile.resource = _colonist_resource_to_catanatron(raw_tile.get("type"))
        tile.number = raw_tile.get("diceNumber")
    return catan_map


def _apply_player_state(game: Game, players_state: dict) -> None:
    if not isinstance(players_state, dict):
        return
    resource_id_to_name = {
        1: WOOD,
        2: BRICK,
        3: SHEEP,
        4: WHEAT,
        5: ORE,
    }
    for color_id, state in players_state.items():
        if not isinstance(state, dict):
            continue
        catan_color = _colonist_color_to_catanatron(color_id)
        try:
            index = game.state.colors.index(catan_color)
        except ValueError:
            continue
        cards = state.get("resourceCards", {}).get("cards", [])
        if isinstance(cards, list):
            for resource in resource_id_to_name.values():
                game.state.player_state[f"P{index}_{resource}_IN_HAND"] = 0
            for card in cards:
                resource = resource_id_to_name.get(int(card))
                if resource is None:
                    continue
                game.state.player_state[f"P{index}_{resource}_IN_HAND"] += 1

        victory_points = state.get("victoryPointsState", {}).get("points")
        if victory_points is None:
            victory_points = state.get("victoryPointsState", {}).get("value", 0)
        game.state.player_state[f"P{index}_ACTUAL_VICTORY_POINTS"] = int(victory_points)
        game.state.player_state[f"P{index}_VICTORY_POINTS"] = int(victory_points)


def _apply_buildings_from_snapshot(game: Game, corners: dict, edges: dict) -> None:
    if not isinstance(corners, dict):
        corners = {}
    if not isinstance(edges, dict):
        edges = {}

    node_coordinates, edge_coordinates = _board_coordinate_maps(game.state.board.map)

    for corner_id, corner in corners.items():
        if not isinstance(corner, dict):
            continue
        owner = corner.get("owner")
        building_type = corner.get("buildingType") or corner.get("type")
        if owner is None or building_type is None:
            continue
        catan_color = _colonist_color_to_catanatron(owner)
        try:
            corner_coordinate = (
                int(corner["x"]),
                int(corner["y"]),
                int(corner["z"]),
            )
            node_id = node_coordinates[corner_coordinate]
        except (KeyError, TypeError, ValueError):
            continue

        building = (
            SETTLEMENT
            if building_type in (1, "1", "SETTLEMENT", "settlement")
            else CITY
        )
        game.state.board.buildings[node_id] = (catan_color, building)
        game.state.buildings_by_color[catan_color][building].append(node_id)

    for edge_id, edge in edges.items():
        if not isinstance(edge, dict):
            continue
        owner = edge.get("owner")
        if owner is None:
            continue
        catan_color = _colonist_color_to_catanatron(owner)
        if edge.get("x") is None or edge.get("y") is None or edge.get("z") is None:
            continue
        edge_coordinate = (int(edge["x"]), int(edge["y"]), int(edge["z"]))
        road = edge_coordinates.get(edge_coordinate)
        if road is None:
            continue
        game.state.board.roads[road] = catan_color
        game.state.board.roads[(road[1], road[0])] = catan_color
        game.state.buildings_by_color[catan_color][ROAD].append(road)


def build_game_from_observation(observation: dict) -> Game:
    """Build a Catanatron Game object from a Colonist websocket observation."""
    if observation.get("websocket_schema_version") != WEBSOCKET_SCHEMA_VERSION:
        raise EncodingError("unexpected websocket schema version")

    map_state = observation.get("raw_state", {}).get("mapState") or {}
    board_map = _build_tiles_from_observation(map_state)
    color_order = []
    for raw_color in observation.get("play_order") or [1, 2, 3, 4]:
        catan_color = _colonist_color_to_catanatron(raw_color)
        if catan_color not in color_order:
            color_order.append(catan_color)
    for fallback in (Color.RED, Color.BLUE, Color.WHITE, Color.ORANGE):
        if fallback not in color_order:
            color_order.append(fallback)

    players = [SimplePlayer(color) for color in color_order]
    game = Game(players=players, catan_map=board_map)
    game.state.players = players
    game.state.colors = tuple(color_order)
    game.state.color_to_index = {color: index for index, color in enumerate(color_order)}

    current_color = _colonist_color_to_catanatron(
        observation.get("player_color")
        or observation.get("current_player")
        or 1
    )
    game.state.current_player_index = game.state.colors.index(current_color)
    game.state.current_turn_index = game.state.current_player_index
    game.state.current_prompt = None
    game.state.is_initial_build_phase = False

    robber_index = observation.get("robber_tile")
    if robber_index is not None:
        raw_tile = map_state.get("tileHexStates", {}).get(str(robber_index))
        if isinstance(raw_tile, dict):
            coordinate = _axial_to_cube(raw_tile.get("x"), raw_tile.get("y"))
            if coordinate in board_map.land_tiles:
                game.state.board.robber_coordinate = coordinate

    _apply_player_state(game, observation.get("players", {}))
    _apply_buildings_from_snapshot(
        game,
        observation.get("corners", {}),
        observation.get("edges", {}),
    )
    return game


def encode_catanatron_game(game, current_color) -> dict:
    """Encode a reconstructed Catanatron Game, not a raw websocket snapshot."""
    from catanatron.features import create_sample_vector

    names = feature_manifest(len(game.state.colors))
    values = create_sample_vector(game, current_color, features=names)
    if len(values) != len(names):
        raise EncodingError(
            f"Feature vector has {len(values)} values, expected {len(names)}"
        )
    return {
        "feature_version": FEATURE_VERSION,
        "feature_names": names,
        "features": values,
        "feature_length": len(values),
    }


def encode_observation(
    observation: dict,
    game_builder: Callable[[dict], Any],
) -> dict:
    """Build a Catanatron Game from normalized state and encode its features.

    ``game_builder`` owns the source-specific board, color, corner, edge, tile,
    resource, and player-state mappings. Keeping it injectable prevents silent
    corruption when Colonist IDs do not match Catanatron IDs.
    """
    if observation.get("websocket_schema_version") != WEBSOCKET_SCHEMA_VERSION:
        raise EncodingError("unexpected websocket schema version")
    game = game_builder(observation)
    current_color = game.state.current_color()
    encoded = encode_catanatron_game(game, current_color)
    encoded["action_encoding_version"] = ACTION_ENCODING_VERSION
    encoded["legal_actions"] = observation.get("legal_actions", [])
    return encoded
