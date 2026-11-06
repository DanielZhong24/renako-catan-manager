import json
from pathlib import Path

import torch
from torch import nn

MODEL_PATH = Path(__file__).resolve().parents[2] / "models" / "teacher_policy_v1.pt"


class PolicyNetwork(nn.Module):
    def __init__(self, input_size: int, action_count: int):
        super().__init__()
        self.network = nn.Sequential(
            nn.Linear(input_size, 256),
            nn.ReLU(),
            nn.Dropout(),
            nn.Linear(256, 128),
            nn.ReLU(),
            nn.Linear(128, action_count),
        )

    def forward(self, features):
        return self.network(features)


checkpoint = torch.load(
    MODEL_PATH,
    map_location="cpu",
    weights_only=False,
)
model = PolicyNetwork(
    input_size=checkpoint["input_size"],
    action_count=checkpoint["num_possible_actions"],
)
model.load_state_dict(checkpoint["model_state_dict"])
model.eval()
ACTION_VOCABULARY = checkpoint["action_vocabulary"]
ACTION_BY_INDEX = {
    index: json.loads(action)
    for action, index in ACTION_VOCABULARY.items()
}

def predict_action(features, legal_actions, game, actor_color=None):
    color = actor_color or game.state.current_color().value
    # Vocabulary keys are compact JSON (no spaces), e.g. ["RED","END_TURN",null]
    known = [
        (a, ACTION_VOCABULARY[json.dumps([color, a["type"], a["parameter"]], separators=(",", ":"))])
        for a in legal_actions
        if json.dumps([color, a["type"], a["parameter"]], separators=(",", ":")) in ACTION_VOCABULARY
    ]
    if not known:
        return legal_actions[0]
    with torch.no_grad():
        logits = model(torch.tensor([features], dtype=torch.float32))[0]
    # argmax over masked logits yields a vocabulary index, not a position in
    # legal_actions, so the winning action must be resolved by its vocab index.
    best = max(known, key=lambda pair: logits[pair[1]])
    print("SELECTED_ACTION:", best[0], flush=True)
    return best[0]