"""Read normalized Colonist history in debug or human-readable replay mode.

Examples:
    python readData.py game.json --debug
    python readData.py game.json --replay
    python readData.py game.json --debug --event BANK_TRADE
    python readData.py game.json --jsonl

`--debug` keeps protocol-oriented output useful while reverse engineering the
Colonist websocket. `--replay` hides transport noise and reconstructs a more
human-readable account of what happened in the game.
"""

from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path
from typing import Any, Iterable

from extractData import load_and_normalize


TOP_LEVEL_IDS = {
    1: ("GAME_START", "starts or joins a game"),
    4: ("GAME_SNAPSHOT", "complete initial game state"),
    28: ("RESOURCE_DISTRIBUTION", "resource cards distributed after a roll"),
    30: ("AVAILABLE_BUILDING_CORNERS", "legal settlement/city locations"),
    31: ("AVAILABLE_BUILDING_EDGES", "legal road locations"),
    33: ("AVAILABLE_ROBBER_TILES", "tiles where the robber may move"),
    43: ("TRADE_REQUEST_OR_RESULT", "trade request or card exchange payload"),
    45: ("GAME_END", "final scores and game statistics"),
    91: ("STATE_DIFF", "incremental change to the game state"),
}

LOG_IDS = {
    4: ("PLACE_*", "place a road or settlement"),
    5: ("BUILD_*", "build a road, settlement, or city"),
    10: ("ROLL", "roll two dice"),
    11: ("MOVE_ROBBER", "move the robber to another tile"),
    14: ("DISCARD_DEVELOPMENT_CARD", "discard or use a development card"),
    16: ("STEAL_RESOURCE", "rob another player"),
    20: ("PLAY_DEVELOPMENT_CARD", "play a development card"),
    44: ("END_TURN", "finish the current player's turn"),
    45: ("WIN_GAME", "player wins the game"),
    47: ("RECEIVE_RESOURCES", "receive resource cards"),
    49: ("ROBBER_BLOCK", "robber blocks resource production"),
    55: ("DISCARD_RESOURCES", "discard resource cards"),
    64: ("PLAYER_CONNECTION_CHANGE", "player disconnects or reconnects"),
    66: ("RECEIVE_ACHIEVEMENT", "receive longest road or largest army"),
    115: ("PLAYER_TRADE", "trade cards with another player"),
    116: ("BANK_TRADE", "trade cards with the bank"),
    118: ("OFFER_TRADE", "offer a trade to another player"),
    146: ("RESOURCE_DISTRIBUTION_BLOCKED", "resource production is blocked"),
}

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
    8: "victory point",
    9: "monopoly",
    10: "road building",
    11: "year of plenty",
}

PIECE_IDS = {
    0: "road",
    2: "settlement",
    3: "city",
}

ACHIEVEMENT_IDS = {
    0: "Longest Road",
    1: "Largest Army",
}


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------


def _names(values: Any, names: dict[int, str]) -> Any:
    if not isinstance(values, list):
        return values
    return [names.get(value, f"unknown({value})") for value in values]


def _payload(record: dict[str, Any]) -> dict[str, Any]:
    value = record.get("payload")
    return value if isinstance(value, dict) else {}


def _walk(value: Any) -> Iterable[tuple[str | None, Any]]:
    """Yield every key/value pair recursively, including list values."""
    if isinstance(value, dict):
        for key, child in value.items():
            yield key, child
            yield from _walk(child)
    elif isinstance(value, list):
        for child in value:
            yield None, child
            yield from _walk(child)


def _find_first(value: Any, key: str) -> Any:
    if isinstance(value, dict):
        if key in value:
            return value[key]
        for child in value.values():
            result = _find_first(child, key)
            if result is not None:
                return result
    elif isinstance(value, list):
        for child in value:
            result = _find_first(child, key)
            if result is not None:
                return result
    return None


def _player_id(record: dict[str, Any]) -> Any:
    if record.get("player") is not None:
        return record["player"]
    payload = _payload(record)
    return payload.get("playerColor", payload.get("owner"))


def _resource_summary(cards: Any) -> str:
    if not isinstance(cards, list) or not cards:
        return "no resources"
    counts = Counter(CARD_IDS.get(card, f"unknown({card})") for card in cards)
    return ", ".join(f"{count} {name.title()}" for name, count in counts.items())


def _format_options(options: list[Any], noun: str) -> str:
    if not options:
        return f"no legal {noun}"
    if len(options) <= 8:
        return f"{len(options)} legal {noun}: " + ", ".join(str(x) for x in options)
    return f"{len(options)} legal {noun}"


# ---------------------------------------------------------------------------
# Debug mode: protocol-oriented output
# ---------------------------------------------------------------------------


def _debug_summary(record: dict[str, Any]) -> str:
    event = record["event"]
    details = []
    if record.get("player") is not None:
        details.append(f"player={record['player']}")
    if record.get("dice"):
        details.append(f"dice={record['dice']} total={record.get('total')}")

    payload = record.get("payload")
    if event == "MOVE_ROBBER" and isinstance(payload, dict):
        tile = payload.get("tileInfo", {})
        details.append(f"tile={tile.get('diceNumber', '?')}")
    if event in {"BANK_TRADE", "PLAYER_TRADE"} and isinstance(payload, dict):
        giving = payload.get("givingCards", payload.get("givenCardEnums"))
        receiving = payload.get("receivingCards", payload.get("receivedCardEnums"))
        details.append(f"give={_names(giving, CARD_IDS)}")
        details.append(f"receive={_names(receiving, CARD_IDS)}")
    if event.startswith("AVAILABLE_") and isinstance(payload, list):
        details.append(f"options={len(payload)}")
    return "  ".join([event, *details])


def print_legend() -> None:
    print("EVENT ID LEGEND")
    print("Top-level websocket type IDs:")
    for raw_type, (name, explanation) in TOP_LEVEL_IDS.items():
        print(f"  type {raw_type:>2}  {name:<32} {explanation}")
    print("Nested gameLogState.text.type IDs (inside type 91):")
    for log_type, (name, explanation) in LOG_IDS.items():
        print(f"  log  {log_type:>3}  {name:<32} {explanation}")
    print("Resource and card IDs:")
    print("  resources:", ", ".join(f"{key}={value}" for key, value in RESOURCE_IDS.items()))
    print("  cards:   ", ", ".join(f"{key}={value}" for key, value in CARD_IDS.items()))
    print("  player numbers are Colonist color IDs, not usernames")
    print("Other IDs are retained as PROTOCOL_TYPE_<id>.\n")


def print_debug(records: list[dict[str, Any]], event: str | None = None) -> None:
    print_legend()
    print("CHRONOLOGICAL PROTOCOL EVENTS")
    visible_index = 0
    for record in records:
        if event is not None and record["event"] != event:
            continue
        visible_index += 1
        log_type = record.get("log_type")
        id_text = f"type={record['raw_type']}"
        if log_type is not None:
            id_text += f", log_type={log_type}"
        print(f"{visible_index:>4}. [{id_text}] {_debug_summary(record)}")


# ---------------------------------------------------------------------------
# Replay mode: semantic, human-readable output
# ---------------------------------------------------------------------------


class ReplayRenderer:
    """Convert normalized protocol records into a readable game replay.

    This intentionally does not print every websocket packet. Availability and
    state-diff packets are remembered as context and used to explain later
    actions.
    """

    def __init__(self, records: list[dict[str, Any]]) -> None:
        self.records = records
        self.player_names = self._extract_player_names(records)
        self.turn_number = 0
        self.turn_open = False
        self.in_setup = True
        self.pending_corners: list[Any] = []
        self.pending_edges: list[Any] = []
        self.pending_robber_tiles: list[Any] = []
        self.last_corner_change: int | None = None
        self.last_edge_change: int | None = None
        self.last_robber_tile: int | None = None
        self.player_resources: dict[Any, list[Any]] = {}
        self.lines: list[str] = []

    @staticmethod
    def _extract_player_names(records: list[dict[str, Any]]) -> dict[Any, str]:
        names: dict[Any, str] = {}
        for record in records:
            if record.get("event") != "GAME_SNAPSHOT":
                continue
            users = _find_first(record, "playerUserStates")
            if not isinstance(users, list):
                continue
            for user in users:
                if not isinstance(user, dict):
                    continue
                color = user.get("selectedColor", user.get("color"))
                username = user.get("username")
                if color is not None and username:
                    names[color] = username
        return names

    def player(self, color: Any) -> str:
        if color is None:
            return "Player"
        return self.player_names.get(color, f"Player {color}")

    def add(self, text: str = "") -> None:
        if text == "" and (not self.lines or self.lines[-1] == ""):
            return
        self.lines.append(text)

    def _start_turn(self, player_color: Any) -> None:
        self.in_setup = False
        self.turn_number += 1
        if self.lines and self.lines[-1] != "":
            self.add()
        self.add(f"TURN {self.turn_number} — {self.player(player_color)}")
        self.turn_open = True

    def _remember_state_diff(self, record: dict[str, Any]) -> None:
        """Extract useful location changes when the normalizer preserved diff data."""
        # Search the whole normalized record because different normalizers keep
        # the original diff under different keys (payload/raw/source/etc.).
        corners = _find_first(record, "tileCornerStates")
        if isinstance(corners, dict):
            for key, value in corners.items():
                if isinstance(value, dict) and ("owner" in value or "buildingType" in value):
                    try:
                        self.last_corner_change = int(key)
                    except (TypeError, ValueError):
                        pass

        edges = _find_first(record, "tileEdgeStates")
        if isinstance(edges, dict):
            for key, value in edges.items():
                if isinstance(value, dict) and "owner" in value:
                    try:
                        self.last_edge_change = int(key)
                    except (TypeError, ValueError):
                        pass

        robber = _find_first(record, "mechanicRobberState")
        if isinstance(robber, dict) and robber.get("locationTileIndex") is not None:
            try:
                self.last_robber_tile = int(robber["locationTileIndex"])
            except (TypeError, ValueError):
                pass

        players = _find_first(record, "playerStates")
        if isinstance(players, dict):
            for color, state in players.items():
                if not isinstance(state, dict):
                    continue
                cards = state.get("resourceCards", {}).get("cards")
                if isinstance(cards, list):
                    self.player_resources[color] = list(cards)

    def _build_cost(self, record: dict[str, Any], color: Any, piece: str) -> str:
        """Describe cards removed by a build state diff, with Catan-cost fallback."""
        players = _find_first(record, "playerStates")
        after = players.get(str(color), players.get(color)) if isinstance(players, dict) else None
        after_cards = after.get("resourceCards", {}).get("cards") if isinstance(after, dict) else None
        before_cards = self.player_resources.get(color, self.player_resources.get(str(color), []))

        if isinstance(after_cards, list) and isinstance(before_cards, list):
            remaining = list(after_cards)
            spent = []
            for card in before_cards:
                if card in remaining:
                    remaining.remove(card)
                else:
                    spent.append(card)
            if spent:
                return _resource_summary(spent)

        fallback = {
            "road": [1, 2],
            "settlement": [1, 2, 3, 4],
            "city": [4, 4, 5, 5, 5],
        }
        return _resource_summary(fallback.get(piece, []))

    def _render_build(self, record: dict[str, Any], setup: bool) -> None:
        payload = _payload(record)
        color = _player_id(record)
        piece_enum = payload.get("pieceEnum")
        piece = PIECE_IDS.get(piece_enum, "piece")
        previous_resources = {
            key: list(value) for key, value in self.player_resources.items()
        }
        self._remember_state_diff(record)
        self.player_resources = previous_resources
        cost = "" if setup else f" using {self._build_cost(record, color, piece)}"

        if piece == "road":
            location = self.last_edge_change
            choice = ""
            if self.pending_edges:
                choice = f" ({_format_options(self.pending_edges, 'road locations')})"
            if location is not None:
                verb = "places a starting road" if setup else "builds a road"
                self.add(f"• {self.player(color)} {verb} on Edge {location}{choice}{cost}.")
            else:
                verb = "places a starting road" if setup else "builds a road"
                self.add(f"• {self.player(color)} {verb}{choice}{cost}.")
            self.pending_edges = []
            self._remember_state_diff(record)
            return

        if piece in {"settlement", "city"}:
            location = self.last_corner_change
            choice = ""
            if self.pending_corners:
                choice = f" ({_format_options(self.pending_corners, 'corner locations')})"
            if setup and piece == "settlement":
                verb = "places a starting settlement"
            elif piece == "city":
                verb = "upgrades to a city"
            else:
                verb = "builds a settlement"
            if location is not None:
                self.add(f"• {self.player(color)} {verb} at Corner {location}{choice}{cost}.")
            else:
                self.add(f"• {self.player(color)} {verb}{choice}{cost}.")
            self.pending_corners = []
            self._remember_state_diff(record)
            return

        self.add(f"• {self.player(color)} places/builds a {piece}{cost}.")
        self._remember_state_diff(record)

    def render(self) -> str:
        self.add("HUMAN-READABLE GAME REPLAY")
        self.add()

        for record in self.records:
            event = record.get("event", "")
            payload_any = record.get("payload")
            payload = _payload(record)
            color = _player_id(record)

            # Keep the previous resource hand available for build-cost
            # calculation; build records update it after they are rendered.
            if event not in {"BUILD_*", "PLACE_*"}:
                self._remember_state_diff(record)

            # Context-only packets: remember, do not print.
            if event == "GAME_SNAPSHOT":
                continue
            if event == "STATE_DIFF":
                self._remember_state_diff(record)
                continue
            if event == "AVAILABLE_BUILDING_CORNERS":
                self.pending_corners = list(payload_any) if isinstance(payload_any, list) else []
                continue
            if event == "AVAILABLE_BUILDING_EDGES":
                self.pending_edges = list(payload_any) if isinstance(payload_any, list) else []
                continue
            if event == "AVAILABLE_ROBBER_TILES":
                self.pending_robber_tiles = list(payload_any) if isinstance(payload_any, list) else []
                continue
            if event in {"RESOURCE_DISTRIBUTION", "TRADE_REQUEST_OR_RESULT"} or record.get("raw_type") == 43:
                # Usually duplicated by a more descriptive game-log event.
                continue

            if event == "GAME_START":
                self.add("GAME START")
                continue

            if event == "ROLL":
                if not self.turn_open:
                    self._start_turn(color)
                dice = record.get("dice")
                total = record.get("total")
                if not dice:
                    first = payload.get("firstDice")
                    second = payload.get("secondDice")
                    if first is not None and second is not None:
                        dice = [first, second]
                        total = first + second
                if isinstance(dice, list) and len(dice) == 2:
                    self.add(f"• {self.player(color)} rolls {dice[0]} + {dice[1]} = {total}.")
                elif total is not None:
                    self.add(f"• {self.player(color)} rolls {total}.")
                else:
                    self.add(f"• {self.player(color)} rolls the dice.")
                continue

            if event == "RECEIVE_RESOURCES":
                cards = payload.get("cardsToBroadcast", payload.get("cards", []))
                self.add(f"• {self.player(color)} receives {_resource_summary(cards)}.")
                continue

            if event.startswith("PLACE_"):
                self._render_build(record, setup=True)
                continue

            if event.startswith("BUILD_"):
                self._render_build(record, setup=False)
                continue

            if event == "BANK_TRADE":
                giving = payload.get("givingCards", payload.get("givenCardEnums", []))
                receiving = payload.get("receivingCards", payload.get("receivedCardEnums", []))
                self.add(
                    f"• {self.player(color)} trades with the bank: "
                    f"gives {_resource_summary(giving)} and receives {_resource_summary(receiving)}."
                )
                continue

            if event == "PLAYER_TRADE":
                giving = payload.get("givingCards", payload.get("givenCardEnums", []))
                receiving = payload.get("receivingCards", payload.get("receivedCardEnums", []))
                other = payload.get("receivingPlayer", payload.get("otherPlayer"))
                target = f" with {self.player(other)}" if other not in (None, 0) else ""
                self.add(
                    f"• {self.player(color)} completes a player trade{target}: "
                    f"gives {_resource_summary(giving)} and receives {_resource_summary(receiving)}."
                )
                continue

            if event == "OFFER_TRADE":
                giving = payload.get("givingCards", payload.get("givenCardEnums", []))
                receiving = payload.get("receivingCards", payload.get("receivedCardEnums", []))
                self.add(
                    f"• {self.player(color)} offers a trade: "
                    f"{_resource_summary(giving)} for {_resource_summary(receiving)}."
                )
                continue

            if event == "MOVE_ROBBER":
                tile_info = payload.get("tileInfo", {})
                number = tile_info.get("diceNumber")
                resource_id = tile_info.get("resourceType")
                resource = RESOURCE_IDS.get(resource_id, "unknown resource")
                tile_index = self.last_robber_tile
                candidate = f" from {len(self.pending_robber_tiles)} legal robber tiles" if self.pending_robber_tiles else ""
                if tile_index is not None:
                    self.add(
                        f"• {self.player(color)} moves the robber to Tile {tile_index} "
                        f"({number} {resource.title()}){candidate}."
                    )
                else:
                    self.add(f"• {self.player(color)} moves the robber to the {number} {resource.title()} hex{candidate}.")
                self.pending_robber_tiles = []
                continue

            if event == "STEAL_RESOURCE":
                victim = payload.get("victimPlayerColor", payload.get("receivingPlayer"))
                victim_text = f" from {self.player(victim)}" if victim is not None else ""
                card = payload.get("card")
                if card is not None:
                    self.add(f"• {self.player(color)} steals 1 {CARD_IDS.get(card, 'resource').title()}{victim_text}.")
                else:
                    self.add(f"• {self.player(color)} steals a resource{victim_text}.")
                continue

            if event == "ROBBER_BLOCK":
                tile_info = payload.get("tileInfo", {})
                number = tile_info.get("diceNumber")
                resource = RESOURCE_IDS.get(tile_info.get("resourceType"), "resource")
                self.add(f"• The robber blocks production on the {number} {resource.title()} hex.")
                continue

            if event == "DISCARD_RESOURCES":
                cards = payload.get("cards", payload.get("cardsToDiscard", []))
                self.add(f"• {self.player(color)} discards {_resource_summary(cards)}.")
                continue

            if event == "PLAY_DEVELOPMENT_CARD":
                card = payload.get("card", payload.get("cardEnum", payload.get("developmentCard")))
                self.add(f"• {self.player(color)} plays {CARD_IDS.get(card, f'development card {card}').title()}.")
                continue

            if event == "DISCARD_DEVELOPMENT_CARD":
                card = payload.get("card", payload.get("cardEnum"))
                self.add(f"• {self.player(color)} uses/discards {CARD_IDS.get(card, 'a development card').title()}.")
                continue

            if event == "RECEIVE_ACHIEVEMENT":
                achievement = payload.get("achievementEnum")
                self.add(f"• {self.player(color)} gains {ACHIEVEMENT_IDS.get(achievement, 'an achievement')}.")
                continue

            if event == "RESOURCE_DISTRIBUTION_BLOCKED":
                self.add("• Resource production is blocked by the robber.")
                continue

            if event == "PLAYER_CONNECTION_CHANGE":
                # Connection chatter is not strategically meaningful in replay mode.
                continue

            if event == "END_TURN":
                if self.turn_open:
                    self.add(f"• {self.player(color)} ends the turn.")
                    self.turn_open = False
                continue

            if event == "WIN_GAME":
                self.add()
                self.add(f"WINNER — {self.player(color)} wins the game.")
                continue

            if event == "GAME_END":
                end_state = _find_first(record, "endGameState")
                if isinstance(end_state, dict):
                    turns = end_state.get("totalTurnCount")
                    duration_ms = end_state.get("gameDurationInMS")
                    bits = []
                    if turns is not None:
                        bits.append(f"{turns} turns")
                    if isinstance(duration_ms, (int, float)):
                        bits.append(f"{duration_ms / 1000:.1f} seconds")
                    if bits:
                        self.add(f"Game complete — {', '.join(bits)}.")
                continue

            # Unknown protocol events are intentionally omitted from replay mode.

        return "\n".join(self.lines).rstrip() + "\n"


def print_replay(records: list[dict[str, Any]]) -> None:
    print(ReplayRenderer(records).render(), end="")


def resolve_input(path: Path) -> Path:
    """Find history files passed from either the repo or catan-clanker directory."""
    if path.exists():
        return path
    game_history_path = Path("gameHistory") / path
    if game_history_path.exists():
        return game_history_path
    return path


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path, help="Recorded Colonist JSON file")

    mode = parser.add_mutually_exclusive_group()
    mode.add_argument(
        "--debug",
        action="store_true",
        help="Show protocol IDs and normalized websocket events",
    )
    mode.add_argument(
        "--replay",
        action="store_true",
        help="Show a human-readable semantic game replay (default)",
    )
    mode.add_argument(
        "--jsonl",
        action="store_true",
        help="Print one complete normalized record per line",
    )

    parser.add_argument(
        "--event",
        help="In --debug/--jsonl mode, only show one normalized event type",
    )

    args = parser.parse_args()
    records = load_and_normalize(resolve_input(args.input))

    if args.jsonl:
        for record in records:
            if args.event is None or record["event"] == args.event:
                print(json.dumps(record, separators=(",", ":")))
    elif args.debug:
        print_debug(records, args.event)
    else:
        # Replay is the default because it is the useful human-facing view.
        print_replay(records)


if __name__ == "__main__":
    main()
