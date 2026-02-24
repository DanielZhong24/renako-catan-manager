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

    /**
     * Updated: Now aggregates stats across ALL linked Catan identities
     * and deduplicates matches uploaded by multiple people.
     */
    async getStatsByDiscordId(discordId: string) {
        const query = `
        WITH user_aliases AS (
            SELECT DISTINCT catan_name
            FROM catan_identities
            WHERE discord_id = $1
        ),
        display_names AS (
            SELECT string_agg(DISTINCT catan_name, ', ') as names
            FROM user_aliases
        ),
        deduplicated_matches AS (
            SELECT DISTINCT ON (ps.vp, ps.activity_stats::text, ps.resource_stats::text)
                ps.is_winner,
                ps.vp
            FROM player_stats ps
            WHERE ps.player_name IN (SELECT catan_name FROM user_aliases)
            ORDER BY ps.vp, ps.activity_stats::text, ps.resource_stats::text, ps.is_me DESC
        )
        SELECT 
            (SELECT names FROM display_names) as username,
            COALESCE(COUNT(*), 0)::int as total_games,
            COALESCE(SUM(CASE WHEN is_winner THEN 1 ELSE 0 END), 0)::int as wins,
            COALESCE(ROUND(AVG(vp)::numeric, 2), 0)::float as avg_vp,
            COALESCE(
                ROUND(((SUM(CASE WHEN is_winner THEN 1 ELSE 0 END)::float / NULLIF(COUNT(*), 0)) * 100)::numeric, 1), 
                0
            )::float as win_rate
        FROM deduplicated_matches;
        `;

        const res = await pool.query(query, [discordId]);
        return res.rows[0];
    },

    async getUserById(discordId: string) {
        const query = `SELECT discord_id, username, api_key FROM users WHERE discord_id = $1`;
        const res = await pool.query(query, [discordId]);
        return res.rows[0]; 
    },

    /**
     * Updated: Pulls the last 5 unique games for all linked identities.
     */
    async getHistoryByDiscordId(discordId: string) {
        const query = `
            WITH user_aliases AS (
                SELECT DISTINCT catan_name
                FROM catan_identities 
                WHERE discord_id = $1
            ),
            game_rollup AS (
                SELECT
                    g.id,
                    g.game_timestamp,
                    md5(
                        string_agg(
                            ps.player_name || ':' || ps.vp || ':' || ps.activity_stats::text,
                            '|' ORDER BY ps.player_name
                        )
                    ) AS match_fingerprint
                FROM games g
                LEFT JOIN player_stats ps ON ps.game_id = g.id
                GROUP BY g.id, g.game_timestamp
            ),
            latest_games AS (
                SELECT DISTINCT ON (match_fingerprint)
                    id,
                    game_timestamp,
                    match_fingerprint
                FROM game_rollup
                ORDER BY match_fingerprint, game_timestamp DESC, id DESC
            ),
            ranked AS (
                SELECT
                    lg.id as game_id,
                    lg.game_timestamp,
                    ps.vp,
                    ps.is_winner,
                    ps.player_name,
                    ROW_NUMBER() OVER (
                        PARTITION BY lg.id
                        ORDER BY ps.is_me DESC, ps.id DESC
                    ) as rn
                FROM latest_games lg
                JOIN player_stats ps ON ps.game_id = lg.id
                WHERE ps.player_name IN (SELECT catan_name FROM user_aliases)
            )
            SELECT game_id, game_timestamp, vp, is_winner, player_name
            FROM ranked
            WHERE rn = 1
            ORDER BY game_timestamp DESC
            LIMIT 5;
        `;
        const res = await pool.query(query, [discordId]);
        return res.rows;
    },

    /**
     * Updated: Global/Server leaderboard now accounts for multiple identities per user.
     */
    async getLeaderboardByGuildId(guildId: string, limit: number = 10) {
        const query = `
            WITH user_map AS (
                SELECT discord_id, catan_name
                FROM catan_identities
            ),
            deduplicated_stats AS (
                SELECT DISTINCT ON (ps.player_name, ps.vp, ps.activity_stats::text, ps.resource_stats::text)
                    um.discord_id, ps.is_winner, ps.vp
                FROM player_stats ps
                JOIN games g ON ps.game_id = g.id
                JOIN user_map um ON ps.player_name = um.catan_name
                WHERE g.guild_id = $1
                ORDER BY ps.player_name, ps.vp, ps.activity_stats::text, ps.resource_stats::text, ps.is_me DESC
            ),
            stats AS (
                SELECT
                    u.discord_id, u.username, u.avatar_url,
                    COUNT(*)::int as total_games,
                    SUM(CASE WHEN ds.is_winner THEN 1 ELSE 0 END)::int as wins,
                    COALESCE(ROUND(AVG(ds.vp)::numeric, 2), 0)::float as avg_vp,
                    COALESCE(ROUND(((SUM(CASE WHEN ds.is_winner THEN 1 ELSE 0 END)::float / NULLIF(COUNT(*), 0)) * 100)::numeric, 1), 0)::float as win_rate
                FROM deduplicated_stats ds
                JOIN users u ON ds.discord_id = u.discord_id
                GROUP BY u.discord_id, u.username, u.avatar_url
            ), 
            ranked AS (
                SELECT
                    *,
                    ROUND((((wins + 3)::float / (total_games + 6)) * 100)::numeric, 2) as bayes_win_rate,
                    ROUND((
                        (
                            (((wins + 3)::float / (total_games + 6)) * 100)
                            + (avg_vp * 2)
                            + (LN(total_games + 1) * 5)
                        )::numeric
                    ), 2) as rating
                FROM stats
            )
            SELECT
                discord_id, username, avatar_url, total_games, wins, avg_vp, win_rate, bayes_win_rate, rating,
                ROW_NUMBER() OVER (ORDER BY rating DESC, wins DESC, avg_vp DESC) as server_rank
            FROM ranked
            ORDER BY server_rank LIMIT $2;
        `;

        const res = await pool.query(query, [guildId, limit]);
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
        GROUP BY player_name, is_bot;
        `;
        const res = await pool.query(query, [catanName]);
        return res.rows[0];
    },

    async linkCatanIdentity(discordId: string, catanName: string) {
        const query = `
          INSERT INTO catan_identities (discord_id, catan_name)
          VALUES ($1, $2)
          ON CONFLICT (catan_name) DO UPDATE SET discord_id = EXCLUDED.discord_id;
        `;
        await pool.query(query, [discordId, catanName]);
    },

    async getDiscordIdByCatanName(catanName: string): Promise<string | null> {
        const query = 'SELECT discord_id FROM catan_identities WHERE catan_name = $1';
        const res = await pool.query(query, [catanName]);
        return res.rows[0]?.discord_id || null;
    }
};