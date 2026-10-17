"""Normalize Colonist websocket history into analytics-friendly records.

The recorder stores decoded websocket envelopes, while gameplay actions are
usually nested in type 91 state diffs. This module keeps the original event
and payload on every record so protocol mappings can be refined later.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any, Iterable


PIECE_NAMES = {0: "ROAD", 1: "ROAD", 2: "SETTLEMENT", 3: "CITY"}
WEBSOCKET_SCHEMA_VERSION = "colonist_ws_v1"
ACTION_ENCODING_VERSION = "v1"

PROTOCOL_NAMES = {
	28: "RESOURCE_DISTRIBUTION",
	30: "AVAILABLE_BUILDING_CORNERS",
	31: "AVAILABLE_BUILDING_EDGES",
	33: "AVAILABLE_ROBBER_TILES",
}


def _body(envelope: dict[str, Any]) -> dict[str, Any]:
	"""Return the decoded websocket message from either recorder format."""
	message = envelope.get("message", envelope)
	if not isinstance(message, dict):
		return {}
	body = message.get("data", message)
	return body if isinstance(body, dict) else {}


def _record(
	event: str,
	raw_type: Any,
	payload: Any,
	source: dict[str, Any],
	**fields: Any,
) -> dict[str, Any]:
	record = {
		"event": event,
		"websocket_schema_version": WEBSOCKET_SCHEMA_VERSION,
		"action_encoding_version": ACTION_ENCODING_VERSION,
		"raw_type": raw_type,
		"sequence": source.get("sequence"),
		"recorded_at": source.get("recordedAt"),
		"active_game_id": source.get("activeGameId"),
		**fields,
	}
	if payload is not None:
		record["payload"] = payload
	record["raw"] = source
	return record


def _action_from_log(text: dict[str, Any], source: dict[str, Any]) -> dict[str, Any]:
	"""Translate gameLogState.text into one stable action record."""
	log_type = text.get("type")
	common = {"player": text["playerColor"]} if "playerColor" in text else {}

	if log_type == 4:
		return _record(
			f"PLACE_{PIECE_NAMES.get(text.get('pieceEnum'), 'UNKNOWN')}",
			91,
			text,
			source,
			log_type=log_type,
			**common,
		)
	if log_type == 5:
		return _record(
			f"BUILD_{PIECE_NAMES.get(text.get('pieceEnum'), 'UNKNOWN')}",
			91,
			text,
			source,
			log_type=log_type,
			**common,
		)
	if log_type == 10:
		first = text.get("firstDice")
		second = text.get("secondDice")
		return _record(
			"ROLL",
			91,
			text,
			source,
			log_type=log_type,
			dice=[first, second],
			total=first + second if isinstance(first, int) and isinstance(second, int) else None,
			**common,
		)

	names = {
		11: "MOVE_ROBBER",
		14: "DISCARD_DEVELOPMENT_CARD",
		16: "STEAL_RESOURCE",
		20: "PLAY_DEVELOPMENT_CARD",
		44: "END_TURN",
		45: "WIN_GAME",
		47: "RECEIVE_RESOURCES",
		49: "ROBBER_BLOCK",
		55: "DISCARD_RESOURCES",
		64: "PLAYER_CONNECTION_CHANGE",
		66: "RECEIVE_ACHIEVEMENT",
		115: "PLAYER_TRADE",
		116: "BANK_TRADE",
		118: "OFFER_TRADE",
		146: "RESOURCE_DISTRIBUTION_BLOCKED",
	}
	return _record(
		names.get(log_type, f"GAME_LOG_{log_type}"),
		91,
		text,
		source,
		log_type=log_type,
		**common,
	)


def _normalize_message(body: dict[str, Any], source: dict[str, Any]) -> list[dict[str, Any]]:
	raw_type = body.get("type")
	payload = body.get("payload")

	if raw_type is None:
		return []

	if raw_type == 1:
		return [_record("GAME_START", raw_type, payload, source)]
	if raw_type == 4:
		return [_record("GAME_SNAPSHOT", raw_type, payload, source)]
	if raw_type == 45:
		return [_record("GAME_END", raw_type, payload, source)]
	if raw_type == 91:
		records = []
		diff = payload.get("diff", {}) if isinstance(payload, dict) else {}
		for _, entry in sorted(
			(diff.get("gameLogState", {}) or {}).items(),
			key=lambda item: int(item[0]) if str(item[0]).isdigit() else str(item[0]),
		):
			text = entry.get("text") if isinstance(entry, dict) else None
			if isinstance(text, dict):
				records.append(_action_from_log(text, source))
		if not records:
			records.append(_record("STATE_DIFF", raw_type, payload, source))
		return records
	if raw_type == 43 and isinstance(payload, dict):
		event = "BANK_TRADE" if payload.get("receivingPlayer") == 0 else "PLAYER_TRADE"
		return [_record(event, raw_type, payload, source)]

	# Preserve protocol messages whose semantics are not established by the
	# replay code instead of silently dropping them.
	return [_record(PROTOCOL_NAMES.get(raw_type, f"PROTOCOL_TYPE_{raw_type}"), raw_type, payload, source)]


def normalize_history(history: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
	"""Convert recorder envelopes into clean, chronologically ordered records."""
	records = []
	for envelope in history:
		if isinstance(envelope, dict):
			records.extend(_normalize_message(_body(envelope), envelope))
	return records


def load_and_normalize(path: str | Path) -> list[dict[str, Any]]:
	with Path(path).open(encoding="utf-8") as handle:
		return normalize_history(json.load(handle))


def main() -> None:
	parser = argparse.ArgumentParser(description=__doc__)
	parser.add_argument("input", type=Path, help="Recorded Colonist JSON file")
	parser.add_argument("-o", "--output", type=Path, help="Output JSON file")
	args = parser.parse_args()
	output = json.dumps(load_and_normalize(args.input), indent=2)
	if args.output:
		args.output.write_text(output + "\n", encoding="utf-8")
	else:
		print(output)


if __name__ == "__main__":
	main()
