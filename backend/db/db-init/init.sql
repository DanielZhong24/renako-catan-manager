CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    discord_id VARCHAR(255) UNIQUE NOT NULL, 
    username VARCHAR(255),                   
    avatar_url TEXT,                         
    api_key UUID DEFAULT gen_random_uuid() UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    catan_username TEXT
);
CREATE TABLE catan_identities (
    id SERIAL PRIMARY KEY,
    discord_id TEXT NOT NULL REFERENCES users(discord_id) ON DELETE CASCADE,
    catan_name TEXT UNIQUE NOT NULL, -- UNIQUE ensures no two people claim the same name
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS games (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(255) REFERENCES users(discord_id), 
    lobby_id VARCHAR(50) NOT NULL,
    guild_id VARCHAR(255),
    game_timestamp TIMESTAMP NOT NULL,
    dice_stats JSONB NOT NULL,
    res_card_stats JSONB,
    dev_card_stats JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (lobby_id, game_timestamp)
);

CREATE TABLE IF NOT EXISTS player_stats (
    id SERIAL PRIMARY KEY,
    game_id INTEGER REFERENCES games(id) ON DELETE CASCADE,
    uploader_id VARCHAR(255) REFERENCES users(discord_id),
    player_name VARCHAR(255) NOT NULL,
    vp INTEGER NOT NULL,
    is_bot BOOLEAN NOT NULL,
    is_winner BOOLEAN NOT NULL,
    is_me BOOLEAN DEFAULT false, -- The key to multi-user stats
    activity_stats JSONB,
    resource_stats JSONB,
    UNIQUE (game_id, uploader_id, player_name)
);

CREATE TABLE IF NOT EXISTS pending_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    uploader_id VARCHAR(255) REFERENCES users(discord_id),
    guild_id VARCHAR(255) NOT NULL,
    channel_id VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS admin_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_login TIMESTAMP
);

CREATE TABLE IF NOT EXISTS admin_sessions (
    token UUID PRIMARY KEY,
    username TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NOT NULL
);
-- Optional: Clean up old pending sessions after 1 hour
DELETE FROM pending_sessions WHERE created_at < NOW() - INTERVAL '1 hour';
-- Step 2: Drop dependent views first
DROP VIEW IF EXISTS leaderboard_view;
DROP VIEW IF EXISTS user_stats_view;
DROP VIEW IF EXISTS history_view;

-- Step 3: Recreate User Stats View with guild_id support
CREATE OR REPLACE VIEW user_stats_view AS
SELECT 
    u.discord_id,
    u.username,
    g.guild_id, 
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
GROUP BY u.discord_id, u.username, g.guild_id;

-- Step 4: Recreate Leaderboard View
CREATE VIEW leaderboard_view AS
SELECT 
    username,
    wins,
    total_games,
    win_rate,
    guild_id,
    RANK() OVER (PARTITION BY guild_id ORDER BY wins DESC, win_rate DESC) as server_position,
    RANK() OVER (ORDER BY wins DESC, win_rate DESC) as global_position
FROM user_stats_view
WHERE total_games > 0;

-- Step 5: Recreate History View
CREATE OR REPLACE VIEW history_view AS
SELECT 
    ps.uploader_id,
    g.id AS game_id,
    g.guild_id,
    g.game_timestamp,
    ps.player_name,
    ps.vp,
    ps.is_winner,
    g.dice_stats->>'total_rolls' as total_rolls
FROM player_stats ps
JOIN games g ON ps.game_id = g.id
WHERE ps.is_me = true
ORDER BY g.game_timestamp DESC;