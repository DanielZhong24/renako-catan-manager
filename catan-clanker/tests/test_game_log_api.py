import asyncio
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from clanker import bot_api


async def request(method, path, body=b"", headers=()):
    messages = []
    received = False

    async def receive():
        nonlocal received
        if not received:
            received = True
            return {"type": "http.request", "body": body, "more_body": False}
        return {"type": "http.disconnect"}

    async def send(message):
        messages.append(message)

    scope = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": method,
        "scheme": "http",
        "path": path,
        "raw_path": path.encode(),
        "query_string": b"",
        "headers": list(headers),
        "client": ("127.0.0.1", 12345),
        "server": ("localhost", 8000),
    }
    await bot_api.app(scope, receive, send)
    start = next(message for message in messages if message["type"] == "http.response.start")
    response_body = b"".join(
        message.get("body", b"")
        for message in messages
        if message["type"] == "http.response.body"
    )
    return start["status"], dict(start["headers"]), response_body


class GameLogApiTests(unittest.TestCase):
    def test_saves_multiple_games_as_jsonl_and_rejects_invalid_requests(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "gameHistory" / "games.jsonl"
            with patch.object(bot_api, "LOG_FILE", path):
                for game_id in ("1", "2"):
                    payload = {"gameId": game_id, "events": [{"data": {"type": 45}}]}
                    status, headers, body = asyncio.run(request(
                        "POST",
                        "/api/bot/games/logs",
                        json.dumps(payload).encode(),
                        [(b"content-type", b"application/json"), (b"origin", b"https://colonist.io")],
                    ))
                    self.assertEqual(status, 200)
                    self.assertEqual(headers[b"access-control-allow-origin"], b"https://colonist.io")
                    self.assertEqual(json.loads(body), {"status": "saved"})

                status, _, _ = asyncio.run(request(
                    "POST", "/api/bot/games/logs", b'{"gameId":"3"}',
                    [(b"content-type", b"application/json")],
                ))
                self.assertEqual(status, 422)
                self.assertEqual(
                    [json.loads(line) for line in path.read_text().splitlines()],
                    [
                        {"game_id": "1", "events": [{"data": {"type": 45}}]},
                        {"game_id": "2", "events": [{"data": {"type": 45}}]},
                    ],
                )

    def test_preflight_and_bot_events_remain_separate(self):
        status, headers, _ = asyncio.run(request(
            "OPTIONS",
            "/api/bot/games/logs",
            headers=[
                (b"origin", b"https://colonist.io"),
                (b"access-control-request-method", b"POST"),
                (b"access-control-request-headers", b"content-type"),
            ],
        ))
        self.assertEqual(status, 200)
        self.assertEqual(headers[b"access-control-allow-origin"], b"https://colonist.io")

        with patch.object(bot_api, "sessions", {}), patch.object(bot_api, "LiveGameSession") as session:
            session.return_value.process_event.return_value = {"status": "WAIT"}
            status, _, body = asyncio.run(request(
                "POST", "/api/bot/games/events",
                b'{"game_id":"test","bot_color":1,"event":{"data":{"type":91}}}',
                [(b"content-type", b"application/json")],
            ))
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body), {"status": "WAIT"})
        session.return_value.process_event.assert_called_once_with({"data": {"type": 91}})

    def test_write_failure_is_not_reported_as_success(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "games.jsonl"
            with patch.object(bot_api, "LOG_FILE", path), patch.object(
                Path, "open", side_effect=OSError("disk full")
            ):
                with self.assertRaisesRegex(OSError, "disk full"):
                    bot_api.save_game_log(bot_api.GameLogRequest(gameId="1", events=[]))


if __name__ == "__main__":
    unittest.main()
