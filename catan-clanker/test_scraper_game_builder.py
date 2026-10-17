import json
import unittest
from pathlib import Path

from colonist_encoder import (
    ColonistWebsocketEncoder,
    _normalize_state,
    build_game_from_observation,
    encode_catanatron_game,
)


class ScraperGameBuilderTests(unittest.TestCase):
    def test_build_game_from_observation_matches_catanatron_shape(self):
        records = json.loads(
            Path("gameHistory/historian-257273648.json").read_text(encoding="utf-8")
        )
        snapshot = next(
            item["data"]["payload"] for item in records if item["data"].get("type") == 4
        )
        observation = _normalize_state({}, snapshot, 0)

        game = build_game_from_observation(observation)

        self.assertIsNotNone(game)
        self.assertEqual(len(game.state.board.map.tiles_by_id), 19)
        self.assertIn(game.state.board.robber_coordinate, game.state.board.map.land_tiles)
        encoded = encode_catanatron_game(game, game.state.current_color())
        self.assertEqual(encoded["feature_length"], 1002)

    def test_occupied_snapshot_maps_each_building_and_road(self):
        records = json.loads(
            Path("gameHistory/renako-262972742.json").read_text(encoding="utf-8")
        )
        encoder = ColonistWebsocketEncoder()
        list(encoder.observations(records))

        game = build_game_from_observation(encoder.observation)

        self.assertEqual(len(game.state.board.buildings), 9)
        self.assertEqual(
            len({tuple(sorted(edge)) for edge in game.state.board.roads}),
            12,
        )
        encoded = encode_catanatron_game(game, game.state.current_color())
        self.assertEqual(encoded["feature_length"], 1002)


if __name__ == "__main__":
    unittest.main()
