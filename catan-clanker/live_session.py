from colonist_encoder import (
    ColonistWebsocketEncoder,
    build_game_from_observation,
    encode_catanatron_game,
)
from policy import predict_action
class LiveGameSession:
    def __init__(self, game_id: str, bot_color: int | None):
        self.game_id = game_id
        self.bot_color = bot_color
        self.encoder = ColonistWebsocketEncoder()
        self.last_action_sequence = None

    def process_event(self, event: dict) -> dict:
        data = event.get("data", {})
        if self.bot_color is None and data.get("type") == 4:
            payload = data.get("payload", {})
            self.bot_color = payload.get("playerColor")

        observations = self.encoder.process(event)

        for observation in observations:
            if not self.is_bot_turn(observation):
                continue

            game = build_game_from_observation(observation)

            encoded = encode_catanatron_game(
                game,
                game.state.current_color(),
            )

            action = predict_action(
                features=encoded["features"],
                legal_actions=observation["legal_actions"],
                game=game,
            )

            return {
                "status": "ACTION",
                "game_id": self.game_id,
                "sequence": observation["source_sequence"],
                "action": action,
                "feature_version": encoded["feature_version"],
                "feature_length": encoded["feature_length"],
            }

        return {
            "status": "WAIT",
            "game_id": self.game_id,
        }

    def is_bot_turn(self, observation: dict) -> bool:
        return (
            observation.get("current_player") == self.bot_color
            or self.has_forced_bot_action(observation)
        )

    def has_forced_bot_action(self, observation: dict) -> bool:
        # Add discard/robber handling here later.
        return False