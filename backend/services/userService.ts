import pool from '../db/db.js';

export const UserService = {
    // 1. Create or update a user when they login via Discord
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
        RETURNING *; -- This includes api_key!
        `;
        
        const res = await pool.query(query, [discordId, username, avatarUrl]);
        return res.rows[0];
    },

    // NEW: Helper to verify the extension's key
    async getUserByApiKey(apiKey: string) {
        const query = `SELECT discord_id, username FROM users WHERE api_key = $1`;
        const res = await pool.query(query, [apiKey]);
        return res.rows[0]; // Returns undefined if key is invalid
    },

    // 2. Get stats for the Discord Bot (Keep this as is)
    async getStatsByDiscordId(discordId: string) {
        const query = `
          SELECT 
            u.username,
            COUNT(ps.id) as total_games,
            SUM(CASE WHEN ps.is_winner THEN 1 ELSE 0 END) as wins,
            ROUND(AVG(ps.vp), 2) as avg_vp,
            ROUND((SUM(CASE WHEN ps.is_winner THEN 1 ELSE 0 END)::float / NULLIF(COUNT(ps.id), 0)) * 100, 1) as win_rate
          FROM users u
          LEFT JOIN player_stats ps ON u.discord_id = ps.player_name -- Or however your link works
          WHERE u.discord_id = $1
          GROUP BY u.username;
        `;
        const res = await pool.query(query, [discordId]);
        return res.rows[0];
    }
};