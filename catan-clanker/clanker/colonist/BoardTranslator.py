from clanker.colonist.colonist_encoder import COLONIST_PORT_TYPE_TO_CATANATRON, FEATURE_VERSION, WEBSOCKET_SCHEMA_VERSION, EncodingError, _location_coordinate, _board_coordinate_maps, _axial_to_cube, feature_manifest
from typing import Any, Callable
from catanatron.models.board import STATIC_GRAPH
from catanatron.models.tiles import LandTile
from catanatron.models.player import Color, SimplePlayer
from catanatron.models.map import BASE_MAP_TEMPLATE, CatanMap
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
    ActionPrompt,
)

ACTION_ENCODING_VERSION = "v1"

COLOR_NAME_TO_ID = {
    "RED" : 1,
    "BLUE": 2,
    "WHITE": 3,
    "ORANGE": 4,
}

class BoardTranslator:
    """Converts board locations between Colonist indices and Catanatron ids.

    Colonist addresses corners, edges and tiles by index; the policy vocabulary
    uses Catanatron node ids, node-pair edges and cube coordinates.
    """

    BUILD_NODE_ACTIONS = ("BUILD_SETTLEMENT", "BUILD_CITY")



    def __init__(self, catan_map: CatanMap, observation: dict):
        node_by_coord, edge_by_coord = _board_coordinate_maps(catan_map)
        self.catan_map = catan_map
        self.corner_to_node: dict[int, int] = {}
        self.node_to_corner: dict[int, int] = {}
        self.edge_to_nodes: dict[int, list[int]] = {}
        self.nodes_to_edge: dict[tuple[int, int], int] = {}
        self.tile_to_cube: dict[int, tuple[int, int, int]] = {}

        for index, raw in (observation.get("corners") or {}).items():
            node = node_by_coord.get(_location_coordinate(raw))
            if node is not None:
                self.corner_to_node[int(index)] = node
                self.node_to_corner[node] = int(index)
        for index, raw in (observation.get("edges") or {}).items():
            nodes = edge_by_coord.get(_location_coordinate(raw))
            if nodes is not None:
                self.edge_to_nodes[int(index)] = list(nodes)
                self.nodes_to_edge[tuple(sorted(nodes))] = int(index)
        for index, raw in (observation.get("tiles") or {}).items():
            coordinate = _location_coordinate(raw)
            if coordinate is not None:
                self.tile_to_cube[int(index)] = _axial_to_cube(*coordinate[:2])
        self.cube_to_tile = {cube: index for index, cube in self.tile_to_cube.items()}

    def to_catanatron(self, actions: list[dict], game=None, actor=None) -> list[dict]:
        """Rewrite Colonist-indexed actions into Catanatron form.

        The original Colonist parameter is kept under ``colonist_parameter``.
        """
        converted = []
        for action in actions:
            kind, index = action["type"], action["parameter"]
            if kind in self.BUILD_NODE_ACTIONS:
                node = self.corner_to_node.get(index)
                if node is not None:
                    converted.append({**action, "parameter": node, "colonist_parameter": index})
            elif kind == "BUILD_ROAD":
                nodes = self.edge_to_nodes.get(index)
                if nodes is not None:
                    converted.append(
                        {**action, "parameter": sorted(nodes), "colonist_parameter": index}
                    )
            elif kind == "MOVE_ROBBER":
                converted.extend(self._robber_actions(action, game, actor))
            else:
                converted.append(action)
        return converted

    def _robber_actions(self, action: dict, game, actor) -> list[dict]:
        index = action["parameter"]
        cube = self.tile_to_cube.get(index)
        tile = self.catan_map.land_tiles.get(cube) if cube is not None else None
        if tile is None:
            return []
        victims = set()
        if game is not None:
            for node in tile.nodes.values():
                building = game.state.board.buildings.get(node)
                if building and building[0] != actor:
                    victims.add(building[0].value)
        return [
            {
                "type": "MOVE_ROBBER",
                "parameter": [list(cube), victim],
                "colonist_parameter": index,
            }
            for victim in (sorted(victims) or [None])
        ]

    def colonist_parameter(self, kind: str, value: Any) -> Any:
        """Colonist index for a Catanatron build location (None if unknown)."""
        if kind in self.BUILD_NODE_ACTIONS:
            return self.node_to_corner.get(value)
        if kind == "BUILD_ROAD":
            return self.nodes_to_edge.get(tuple(sorted(value)))
        return value

    def to_colonist(self, action: dict) -> dict:
        """Strip the Catanatron form back to what the Colonist socket expects."""
        result = {
            "type": action["type"],
            "parameter": action.get("colonist_parameter", action["parameter"]),
        }

        if action["type"] == "MOVE_ROBBER":
            victim = action["parameter"][1]
            result["victim"] = COLOR_NAME_TO_ID.get(victim)

        return result


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


def _rebuild_connected_components(board) -> None:
    """Fill Board.connected_components, which placement legality reads.

    Components are sets of nodes joined by one color's roads. Nodes held by an
    opponent are excluded because they cut the road network.
    """
    board.connected_components.clear()
    # Direct writes skip Board.build_settlement, so apply its side effects here:
    # occupied nodes and their neighbours are no longer buildable (distance rule).
    board.board_buildable_ids = set(board.map.land_nodes)
    for node in board.buildings:
        board.board_buildable_ids.discard(node)
        board.board_buildable_ids.difference_update(STATIC_GRAPH.neighbors(node))
    board.buildable_edges_cache = {}
    board.player_port_resources_cache = {}
    colors = {color for color, _ in board.buildings.values()}
    colors.update(board.roads.values())
    for color in colors:
        blocked = {
            node for node, (owner, _) in board.buildings.items() if owner != color
        }
        parent: dict[int, int] = {}

        def find(node: int) -> int:
            parent.setdefault(node, node)
            while parent[node] != node:
                parent[node] = parent[parent[node]]
                node = parent[node]
            return node

        for node, (owner, _) in board.buildings.items():
            if owner == color:
                find(node)
        for (a, b), owner in board.roads.items():
            if owner != color:
                continue
            for node in (a, b):
                if node not in blocked:
                    find(node)
            if a not in blocked and b not in blocked:
                parent[find(a)] = find(b)

        groups: dict[int, set[int]] = {}
        for node in list(parent):
            groups.setdefault(find(node), set()).add(node)
        board.connected_components[color] = list(groups.values())


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

    _rebuild_connected_components(game.state.board)

    for catan_color, by_type in game.state.buildings_by_color.items():
        index = game.state.colors.index(catan_color)
        built = {kind: len(nodes) for kind, nodes in by_type.items()}
        state = game.state.player_state
        state[f"P{index}_ROADS_AVAILABLE"] = 15 - built.get(ROAD, 0)
        state[f"P{index}_CITIES_AVAILABLE"] = 4 - built.get(CITY, 0)
        state[f"P{index}_SETTLEMENTS_AVAILABLE"] = 5 - built.get(SETTLEMENT, 0)

def _apply_ports_from_snapshot(game: Game, ports: dict) -> None:
    if not isinstance(ports, dict):
        ports = {}

    _, edge_coordinates = _board_coordinate_maps(game.state.board.map)

    port_nodes: dict[Any, set[int]] = {}

    for _port_id, port in ports.items():
        if not isinstance(port, dict):
            continue

        x = port.get("x")
        y = port.get("y")
        z = port.get("z")
        raw_type = port.get("type")

        if x is None or y is None or z is None or raw_type is None:
            continue

        edge_coordinate = (
            int(x),
            int(y),
            int(z),
        )

        endpoints = edge_coordinates.get(edge_coordinate)
        if endpoints is None:
            continue

        resource = COLONIST_PORT_TYPE_TO_CATANATRON.get(int(raw_type))

        # If unknown port IDs are possible, distinguish them from generic.
        if int(raw_type) not in COLONIST_PORT_TYPE_TO_CATANATRON:
            continue

        port_nodes.setdefault(resource, set()).update(endpoints)

    game.state.board.map.port_nodes = port_nodes

    # Ownership depends on current buildings, so cached results are now stale.
    game.state.board.player_port_resources_cache.clear()

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
    game.state.current_prompt = ActionPrompt.PLAY_TURN
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
    _apply_ports_from_snapshot(
        game,
        map_state.get("portEdgeStates", {}),
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
    # encoded["maritime_trade_possibilities"] = game.state.maritime_trade_possibilities(current_color)
    return encoded