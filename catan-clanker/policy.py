import json
from pathlib import Path

import torch
from torch import nn

MODEL_PATH = Path(__file__).resolve().parents[1] / "models" / "teacher_policy_v1.pt"


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

def predict_action(features, legal_actions, game):
    if not legal_actions:
        raise ValueError("No legal actions available")

    with torch.no_grad():
        input_tensor = torch.tensor(
            [features],
            dtype=torch.float32,
        )
        output = model(input_tensor)

    top_values, top_indices = torch.topk(output[0], k=5)
    print("MODEL_OUTPUT_SHAPE:", tuple(output.shape), flush=True)
    print(
        "MODEL_TOP_PREDICTIONS:",
        [
            {
                "index": int(index),
                "score": float(value),
                "action": ACTION_BY_INDEX[int(index)],
            }
            for value, index in zip(top_values, top_indices)
        ],
        flush=True,
    )
    print("LEGAL_ACTIONS:", legal_actions, flush=True)

    # Location/action vocabulary translation is not complete yet. Keep the
    # live service safe by returning a legal action while exposing the model's
    # actual top predictions for verification.
    selected_action = legal_actions[0]
    print("SELECTED_LEGAL_FALLBACK:", selected_action, flush=True)
    return selected_action