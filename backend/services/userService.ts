import pool from '../db/db.js';

export const UserService = {
    async upsertUser(discordId: string, username: string, avatarHash: string | null) {
        let avatarUrl: string;

        if (avatarHash) {
            avatarUrl = `https://cdn.discordapp.com/avatars/${discordId}/${avatarHash}.png`;
        } else {
            const defaultAvatarIndex = (BigInt(discordId) >> 22n) % 6n;
            avatarUrl = `https://cdn.discordapp.com/embed/avatars/${defaultAvatarIndex}.png`;
        }

        const query = `
        INSERT INTO users (discord_id, username, avatar_url)
        VALUES ($1, $2, $3)
        ON CONFLICT (discord_id) 
        DO UPDATE SET 
            username = EXCLUDED.username, 
            avatar_url = EXCLUDED.avatar_url
        RETURNING *;
        `;
        
        const res = await pool.query(query, [discordId, username, avatarUrl]);
        return res.rows[0];
    },

    async getUserByApiKey(apiKey: string) {
        const query = `SELECT discord_id, username FROM users WHERE api_key = $1`;
        const res = await pool.query(query, [apiKey]);
        return res.rows[0];
    },

    async getStatsByDiscordId(discordId: string) {
        const query = `
        SELECT 
            u.username,
            COALESCE(COUNT(ps.id), 0)::int as total_games,
            COALESCE(SUM(CASE WHEN ps.is_winner THEN 1 ELSE 0 END), 0)::int as wins,
            COALESCE(ROUND(AVG(ps.vp)::numeric, 2), 0)::float as avg_vp,
            COALESCE(ROUND(((SUM(CASE WHEN ps.is_winner THEN 1 ELSE 0 END)::float / NULLIF(COUNT(ps.id), 0)) * 100)::numeric, 1), 0)::float as win_rate
        FROM users u
        LEFT JOIN player_stats ps ON u.discord_id = ps.uploader_id 
        WHERE u.discord_id = $1 
            AND ps.is_me = true  -- <--- ADD THIS CRITICAL LINE
        GROUP BY u.username;
        `;
        const res = await pool.query(query, [discordId]);
        return res.rows[0];
    },
    async getUserById(discordId: string) {
        const query = `SELECT discord_id, username, api_key FROM users WHERE discord_id = $1`;
        const res = await pool.query(query, [discordId]);
        return res.rows[0]; 
    },

    async getHistoryByDiscordId(discordId: string) {
        const query = `
            SELECT 
                g.id as game_id,
                g.game_timestamp,
                ps.vp,
                ps.is_winner,
                ps.player_name
            FROM users u
            JOIN player_stats ps ON u.discord_id = ps.uploader_id
            JOIN games g ON ps.game_id = g.id
            WHERE u.discord_id = $1 
            AND ps.is_me = true  -- Only show YOUR results
            ORDER BY g.game_timestamp DESC
            LIMIT 5;
        `;
        const res = await pool.query(query, [discordId]);
        return res.rows;
    },
    async getStatsByCatanName(catanName: string) {
        const query = `
        SELECT 
            player_name as catan_name,
            is_bot,
            COUNT(id)::int as total_games,
            SUM(CASE WHEN is_winner THEN 1 ELSE 0 END)::int as wins,
            COALESCE(ROUND(AVG(vp)::numeric, 2), 0)::float as avg_vp,
            COALESCE(ROUND(((SUM(CASE WHEN is_winner THEN 1 ELSE 0 END)::float / NULLIF(COUNT(id), 0)) * 100)::numeric, 1), 0)::float as win_rate
        FROM player_stats
        WHERE player_name ILIKE $1 
        GROUP BY player_name,is_bot;
        `;
        const res = await pool.query(query, [catanName]);
        return res.rows[0];
    },


};