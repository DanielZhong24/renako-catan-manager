"""Print normalized Colonist history in chronological order or as JSONL."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

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


def _summary(record: dict[str, Any]) -> str:
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


def _names(values: Any, names: dict[int, str]) -> Any:
	if not isinstance(values, list):
		return values
	return [names.get(value, f"unknown({value})") for value in values]


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


def print_timeline(records: list[dict[str, Any]], event: str | None = None) -> None:
	print_legend()
	print("CHRONOLOGICAL GAME EVENTS")
	visible_index = 0
	for record in records:
		if event is not None and record["event"] != event:
			continue
		visible_index += 1
		log_type = record.get("log_type")
		id_text = f"type={record['raw_type']}"
		if log_type is not None:
			id_text += f", log_type={log_type}"
		print(f"{visible_index:>4}. [{id_text}] {_summary(record)}")


def main() -> None:
	parser = argparse.ArgumentParser(description=__doc__)
	parser.add_argument("input", type=Path, help="Recorded Colonist JSON file")
	parser.add_argument("--event", help="Only print one event type in timeline order")
	parser.add_argument(
		"--jsonl",
		action="store_true",
		help="Print one complete normalized record per line",
	)
	args = parser.parse_args()
	records = load_and_normalize(args.input)
	if args.jsonl:
		for record in records:
			if args.event is None or record["event"] == args.event:
				print(json.dumps(record, separators=(",", ":")))
	else:
		print_timeline(records, args.event)


if __name__ == "__main__":
	main()