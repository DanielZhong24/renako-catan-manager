CREATE TABLE IF NOT EXISTS games (
    id SERIAL PRIMARY KEY,
    lobby_id VARCHAR(50) UNIQUE NOT NULL,
    game_timestamp TIMESTAMP NOT NULL,
    dice_stats JSONB NOT NULL,
    res_card_stats JSONB,
    dev_card_stats JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS player_stats (
    id SERIAL PRIMARY KEY,
    game_id INTEGER REFERENCES games(id) ON DELETE CASCADE,
    player_name VARCHAR(255) NOT NULL,
    vp INTEGER NOT NULL,
    is_bot BOOLEAN NOT NULL,
    is_winner BOOLEAN NOT NULL,
    activity_stats JSONB,
    resource_stats JSONB
);