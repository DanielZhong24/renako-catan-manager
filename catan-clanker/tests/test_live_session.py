import json
import unittest
from pathlib import Path

from live_session import LiveGameSession


class LiveSessionDecisionTests(unittest.TestCase):
    def test_forced_actions_never_reach_policy(self):
        records = json.loads(
            Path("gameHistory/renako-262972742.json").read_text(encoding="utf-8")
        )
        session = LiveGameSession(game_id="262972742", bot_color=1)

        decisions = []
        for record in records:
            result = session.process_event(record)
            if result.get("status") == "ACTION":
                decisions.append(result)

        self.assertTrue(decisions, "expected at least one decision")

        roll = [d for d in decisions if d["action"].get("type") == "ROLL"]
        end_turn = [d for d in decisions if d["action"].get("type") == "END_TURN"]
        self.assertTrue(roll, "expected a forced ROLL decision")
        self.assertTrue(end_turn, "expected an END_TURN decision")

        for decision in roll:
            self.assertEqual(decision["via"], "forced")

        # END_TURN is a real decision: it must come from the policy.
        for decision in end_turn:
            self.assertEqual(decision["via"], "policy")

        policy_decisions = [d for d in decisions if d["via"] == "policy"]
        self.assertTrue(policy_decisions, "expected at least one policy decision")
        for decision in policy_decisions:
            self.assertNotEqual(decision["action"].get("type"), "ROLL")

    def test_must_discard_only_on_seven_with_full_hand(self):
        session = LiveGameSession(game_id="test", bot_color=1)
        observation = {
            "players": {
                "1": {
                    "cardDiscardLimit": 7,
                    "resourceCards": {"cards": [1, 1, 2, 3, 3, 4, 5, 5]},
                }
            },
            "dice": {"thrown": True, "first": 3, "second": 4},
            "completed_turns": 1,
        }
        self.assertEqual(session._must_discard(observation), 4)
        observation["dice"]["second"] = 5
        self.assertEqual(session._must_discard(observation), 0)


def _first_observation(predicate):
    from colonist_encoder import ColonistWebsocketEncoder

    for path in sorted(Path("gameHistory").glob("*.json")):
        encoder = ColonistWebsocketEncoder()
        for record in json.loads(path.read_text(encoding="utf-8")):
            try:
                observations = encoder.process(record)
            except ValueError:
                break
            for observation in observations:
                if predicate(observation):
                    return observation
    return None


class BoardTranslatorTests(unittest.TestCase):
    def _translator(self, observation):
        from BoardTranslator import BoardTranslator
        from BoardTranslator import build_game_from_observation

        game = build_game_from_observation(observation)
        return game, BoardTranslator(game.state.board.map, observation)

    def test_corner_and_edge_mappings_cover_the_board_one_to_one(self):
        observation = _first_observation(lambda o: o.get("corners"))
        self.assertIsNotNone(observation)
        _, translator = self._translator(observation)
        self.assertEqual(len(translator.corner_to_node), 54)
        self.assertEqual(len(set(translator.corner_to_node.values())), 54)
        self.assertEqual(len(translator.edge_to_nodes), 72)
        for index, nodes in translator.edge_to_nodes.items():
            self.assertEqual(translator.nodes_to_edge[tuple(sorted(nodes))], index)

    def test_setup_roads_translate_to_a_star_around_the_settlement(self):
        def has_setup_roads(observation):
            roads = [a for a in observation.get("legal_actions") or [] if a["type"] == "BUILD_ROAD"]
            return len(roads) == 3

        observation = _first_observation(has_setup_roads)
        self.assertIsNotNone(observation)
        game, translator = self._translator(observation)
        converted = translator.to_catanatron(observation["legal_actions"], game)
        shared = set.intersection(*(set(a["parameter"]) for a in converted))
        self.assertEqual(len(shared), 1)

    def test_main_turn_settlements_respect_occupied_and_distance_rule(self):
        import copy

        from catanatron.models.board import STATIC_GRAPH

        observation = _first_observation(
            lambda o: o["dice"].get("thrown") and len(o.get("corners") or {}) and any(
                c.get("owner") for c in o["corners"].values()
            )
        )
        self.assertIsNotNone(observation)
        observation = copy.deepcopy(observation)
        observation["players"]["1"]["resourceCards"]["cards"] = [1, 2, 3, 4] * 3
        game, translator = self._translator(observation)
        session = LiveGameSession(game_id="test", bot_color=1)
        actions = session._main_phase_actions(observation, game, translator)
        buildings = game.state.board.buildings
        for action in actions:
            if action["type"] != "BUILD_SETTLEMENT":
                continue
            node = action["parameter"]
            self.assertNotIn(node, buildings)
            self.assertFalse(any(n in buildings for n in STATIC_GRAPH.neighbors(node)))

    def test_translated_actions_round_trip_to_colonist_indices(self):
        observation = _first_observation(
            lambda o: any(a["type"] == "BUILD_SETTLEMENT" for a in o.get("legal_actions") or [])
        )
        self.assertIsNotNone(observation)
        game, translator = self._translator(observation)
        legal = observation["legal_actions"]
        converted = translator.to_catanatron(legal, game)
        self.assertEqual(len(converted), len(legal))
        self.assertEqual(
            [translator.to_colonist(a) for a in converted],
            [{"type": a["type"], "parameter": a["parameter"]} for a in legal],
        )
        for action in converted:
            self.assertEqual(
                translator.colonist_parameter(action["type"], action["parameter"]),
                action["colonist_parameter"],
            )


if __name__ == "__main__":
    unittest.main()
