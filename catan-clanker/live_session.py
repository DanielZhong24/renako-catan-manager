from colonist_encoder import (
    ColonistWebsocketEncoder,
)
from catanatron.models.actions import inner_maritime_trade_possibilities, generate_playable_actions
from catanatron.models.enums import RESOURCES
from catanatron.state_functions import player_num_resource_cards
from policy import predict_action
from BoardTranslator import (
    BoardTranslator, 
    build_game_from_observation, 
    encode_catanatron_game
)

# Card IDs that make a development card affordable (wheat, sheep, ore).
DEV_CARD_COST_IDS = {4, 3, 5}
ROAD_COST_IDS = {1, 2}
SETTLEMENT_COST_IDS = {1, 2, 3, 4}
CITY_COST_COUNTS = {3: 3, 5: 2}
CARD_ID_TO_RESOURCE = {
    1: "WOOD",
    2: "BRICK",
    3: "SHEEP",
    4: "WHEAT",
    5: "ORE",
}
BANK_RESOURCE_TO_MODEL = {
    "lumber": "WOOD",
    "brick": "BRICK",
    "wool": "SHEEP",
    "grain": "WHEAT",
    "ore": "ORE",
}
BOT_COLOR_TO_NAME = {
    1: "RED",
    2: "BLUE",
    3: "WHITE",
    4: "ORANGE",
}

RESOURCE_TO_CARD_ID = {
    name: card_id
    for card_id, name in CARD_ID_TO_RESOURCE.items()
}

# Domestic player trading remains unsupported. Maritime bank trades are exposed
# when legal so the policy can choose among them.
class LiveGameSession:
    """Turn Colonist websocket events into bot decisions.

    Decision sources:
    - ROLL are forced protocol actions and never reach the model.
    - Availability pushes (30/31/33) and discard/main-phase choices go through
      the policy with the legal-action mask.
    """

    def __init__(self, game_id: str, bot_color: int | None):
        self.game_id = game_id
        self.bot_color = bot_color
        self.encoder = ColonistWebsocketEncoder()
        self.last_action_sequence = None
        self._last_decision_key = None
        # A bot turn is active only between the diff that hands the turn to the
        # bot and the diff that hands it to someone else. Merged dice state is
        # global (opponents' rolls set it), so it cannot mark a bot turn alone.
        self._bot_turn_active = False
        # ROLL may fire only once per turn handoff; a second identical diff
        # must not resend it.
        self._roll_pending = False
        self._discarded_for = None

    def process_event(self, event: dict) -> dict:
        data = event.get("data", {})
        if self.bot_color is None and data.get("type") == 4:
            payload = data.get("payload", {})
            self.bot_color = payload.get("playerColor")

        for observation in self.encoder.process(event):
            decision = self._classify(observation)
            if decision is None:
                continue

            key = self._decision_key(observation, decision)
            if key == self._last_decision_key:
                continue
            self._last_decision_key = key

            if decision["forced"]:
                return self._response(observation, decision["action"], "forced", decision["kind"])

            if decision["kind"] == "discard":
                return self._process_discard(observation, decision)
            
            game = build_game_from_observation(observation)
            translator = BoardTranslator(game.state.board.map, observation)
            actor = next(
                (c for c in game.state.colors if c.value == BOT_COLOR_TO_NAME.get(self.bot_color)),
                None,
            )
            if decision["kind"] == "main":
                decision["legal_actions"] = self._main_phase_actions(
                    observation,
                    game,
                    translator,
                )
            else:
                decision["legal_actions"] = translator.to_catanatron(
                    decision["legal_actions"], game, actor
                )
            if not decision["legal_actions"]:
                continue

            encoded = encode_catanatron_game(
                game,
                game.state.current_color(),
            )
            action = predict_action(
                features=encoded["features"],
                legal_actions=decision["legal_actions"],
                game=game,
                actor_color=BOT_COLOR_TO_NAME.get(self.bot_color),
            )
            return self._response(
                observation,
                translator.to_colonist(action),
                "policy",
                decision["kind"],
                encoded,
            )

        return {
            "status": "WAIT",
            "game_id": self.game_id,
        }

    def _classify(self, observation: dict) -> dict | None:
        if self.bot_color is None:
            return None

        # Availability pushes are policy decisions (placement / robber tiles).
        legal = observation.get("legal_actions") or []
        if legal:
            return {
                "kind": "availability",
                "legal_actions": legal,
                "forced": False,
            }

        need = self._must_discard(observation)

        if need:
            return {
                "kind": "discard",
                "count": need,
                "forced": False,
            }

        dice = observation.get("dice", {})
        last_diff = observation.get("last_diff") or {}

        # Turn handoff tracking: keep activation in sync with the diff stream.
        if last_diff.get("turn_player") is not None:
            self._bot_turn_active = last_diff.get("turn_player") == self.bot_color
            if self._bot_turn_active:
                self._roll_pending = True

        if dice.get("thrown"):
            self._roll_pending = False

        if not dice.get("thrown"):
            # A real turn start announces itself inside the diff; the merged
            # state alone cannot distinguish it from setup placement (where
            # diceThrown is also False). Never roll during setup.
            if (
                last_diff.get("turn_player") == self.bot_color
                and last_diff.get("dice_thrown") is False
                and self._roll_pending
            ):
                self._roll_pending = False
                # Forced protocol step: rolling is the only possible action.
                return {"kind": "roll", "action": {"type": "ROLL"}, "forced": True}
            return None

        if not self._bot_turn_active:
            return None

        # Main phase: the model decides whether to keep playing or end the turn.
        return {
            "kind": "main",
            # "legal_actions": self._main_phase_actions(observation),
            "forced": False,
        }

    def _bot_hand(self, observation: dict) -> list[int]:
        players = observation.get("players", {})
        state = players.get(str(self.bot_color)) or players.get(self.bot_color) or {}
        cards = state.get("resourceCards", {}).get("cards", [])
        return cards if isinstance(cards, list) else []

    def _must_discard(self, observation: dict) -> int:
        players = observation.get("players", {})
        state = players.get(str(self.bot_color)) or players.get(self.bot_color) or {}

        limit = state.get("cardDiscardLimit", 7)

        dice = observation.get("dice", {})
        thrown = dice.get("thrown", False)
        dice1 = dice.get("first")
        dice2 = dice.get("second")

        hand = self._bot_hand(observation)

        if not thrown:
            return 0

        if dice1 is None or dice2 is None:
            return 0

        if dice1 + dice2 != 7:
            return 0

        if len(hand) <= limit:
            return 0

        roll_key = (
            observation.get("completed_turns"),
            dice1,
            dice2,
        )

        if self._discarded_for == roll_key:
            return 0

        return len(hand) // 2

    def _process_discard(self, observation: dict, decision: dict) -> dict:
        need = decision["count"]

        game = build_game_from_observation(observation)

        remaining = list(self._bot_hand(observation))
        picked = []

        actor_color = BOT_COLOR_TO_NAME.get(self.bot_color)

        for _ in range(need):
            distinct_ids = sorted(set(remaining))

            options = [
                {
                    "type": "DISCARD_RESOURCE",
                    "parameter": CARD_ID_TO_RESOURCE[card_id],
                }
                for card_id in distinct_ids
                if card_id in CARD_ID_TO_RESOURCE
            ]

            encoded = encode_catanatron_game(
                game,
                game.state.current_color(),
            )

            choice = predict_action(
                features=encoded["features"],
                legal_actions=options,
                game=game,
                actor_color=actor_color,
            )

            resource_name = choice["parameter"]

            card_id = RESOURCE_TO_CARD_ID[resource_name]

            remaining.remove(card_id)
            picked.append(card_id)

            # update game's resource state here
            self._remove_resource_from_game(
                game,
                actor_color,
                resource_name,
            )

        dice = observation.get("dice", {})

        self._discarded_for = (
            observation.get("completed_turns"),
            dice.get("first"),
            dice.get("second"),
        )

        return self._response(
            observation,
            {
                "type": "DISCARD_RESOURCE",
                "parameter": picked,
            },
            "policy",
            "discard",
            encoded,
        )
    
    def _remove_resource_from_game(self, game, actor_color: str, resource_name: str) -> None:
        color = next((c for c in game.state.colors if c.value == actor_color), None)
        if color is None:
            return
        key = f"P{game.state.colors.index(color)}_{resource_name}_IN_HAND"
        if game.state.player_state.get(key, 0) > 0:
            game.state.player_state[key] -= 1

    def _main_phase_actions(self, observation: dict, game, translator) -> list[dict]:
        color = next(
            (c for c in game.state.colors if c.value == BOT_COLOR_TO_NAME.get(self.bot_color)),
            None,
        )
        actions = [{"type": "END_TURN", "parameter": None}]
        if color is None:
            return actions

        game.state.current_player_index = game.state.colors.index(color)
        game.state.player_state[f"P{game.state.current_player_index}_HAS_ROLLED"] = True

        for action in generate_playable_actions(game.state):
            kind = action.action_type.value
            if kind == "BUY_DEVELOPMENT_CARD":
                actions.insert(0, {"type": kind, "parameter": None})
            elif kind in ("BUILD_SETTLEMENT", "BUILD_CITY", "BUILD_ROAD"):
                value = action.value
                colonist_parameter = translator.colonist_parameter(kind, value)
                if colonist_parameter is None:
                    continue
                actions.insert(
                    0,
                    {
                        "type": kind,
                        "parameter": sorted(value) if kind == "BUILD_ROAD" else value,
                        "colonist_parameter": colonist_parameter,
                    },
                )
        return self._maritime_trade_actions(observation, game) + actions

    def _has_resource_cost(self, hand: list[int], required: dict[int, int]) -> bool:
        counts: dict[int, int] = {}
        for card in hand:
            counts[card] = counts.get(card, 0) + 1
        return all(counts.get(card, 0) >= needed for card, needed in required.items())

    def _maritime_trade_actions(self, observation: dict, game) -> list[dict]:
        
        color = next(
            (c for c in game.state.colors if c.value == BOT_COLOR_TO_NAME.get(self.bot_color)),
            None,
        )
        if color is None:
            return []

        hand_freqdeck = [
            player_num_resource_cards(game.state, color, resource)
            for resource in RESOURCES
        ]
        bank_resources = observation.get("bank", {}).get("resources", {})
        bank_counts = {
            BANK_RESOURCE_TO_MODEL[name]: count
            for name, count in bank_resources.items()
            if name in BANK_RESOURCE_TO_MODEL and isinstance(count, int)
        }
        bank_freqdeck = [bank_counts.get(resource, 0) for resource in RESOURCES]
        ports = game.state.board.get_player_port_resources(color)

        trades = inner_maritime_trade_possibilities(hand_freqdeck, bank_freqdeck, ports)
        return [
            {"type": "MARITIME_TRADE", "parameter": list(trade)}
            for trade in sorted(trades, key=str)
        ]

    def _decision_key(self, observation: dict, decision: dict) -> tuple:
        dice = observation.get("dice", {})
        return (
            decision["kind"],
            observation.get("completed_turns"),
            dice.get("thrown"),
            dice.get("first"),
            dice.get("second"),
            len(decision.get("legal_actions") or []),
            len(self._bot_hand(observation)),
        )

    def _response(
        self,
        observation: dict,
        action: dict,
        via: str,
        kind: str,
        encoded: dict | None = None,
    ) -> dict:
        result = {
            "status": "ACTION",
            "game_id": self.game_id,
            "sequence": observation["source_sequence"],
            "action": action,
            "via": via,
            "decision_kind": kind,
        }
        if encoded is not None:
            result["feature_version"] = encoded["feature_version"]
            result["feature_length"] = encoded["feature_length"]
        return result