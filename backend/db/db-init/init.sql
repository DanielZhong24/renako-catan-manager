CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    discord_id VARCHAR(255) UNIQUE NOT NULL, 
    username VARCHAR(255),                   
    avatar_url TEXT,                         
    api_key UUID DEFAULT gen_random_uuid() UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS games (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(255) REFERENCES users(discord_id), 
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
    is_me BOOLEAN DEFAULT false, -- The key to multi-user stats
    activity_stats JSONB,
    resource_stats JSONB
);

DROP VIEW IF EXISTS leaderboard_view;
DROP VIEW IF EXISTS user_stats_view;

CREATE VIEW user_stats_view AS
SELECT 
    u.discord_id,
    u.username,
    COUNT(DISTINCT g.id) AS total_games,
    COUNT(DISTINCT CASE WHEN ps.is_winner AND ps.is_me THEN g.id END) AS wins,
    COALESCE(ROUND(AVG(ps.vp) FILTER (WHERE ps.is_me), 1), 0) AS avg_vp,
    CASE 
        WHEN COUNT(DISTINCT g.id) > 0 THEN 
            ROUND((COUNT(DISTINCT CASE WHEN ps.is_winner AND ps.is_me THEN g.id END)::FLOAT / COUNT(DISTINCT g.id)) * 100)
        ELSE 0 
    END AS win_rate
FROM users u
LEFT JOIN games g ON u.discord_id = g.user_id
LEFT JOIN player_stats ps ON g.id = ps.game_id AND ps.is_me = true
GROUP BY u.discord_id, u.username;

CREATE VIEW leaderboard_view AS
SELECT 
    username,
    wins,
    total_games,
    win_rate,
    RANK() OVER (ORDER BY wins DESC, win_rate DESC) as position
FROM user_stats_view
WHERE total_games > 0
LIMIT 10;