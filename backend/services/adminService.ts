import pool from '../db/db.js';
import crypto from 'crypto';

type AdminSessionRow = {
    token: string;
    username: string;
    expires_at: Date;
};

export class AdminService {
    private static getDedupedGamesCte() {
        return `WITH game_rollup AS (
            SELECT
                g.id,
                g.guild_id,
                g.game_timestamp,
                to_timestamp(round(extract(epoch FROM g.game_timestamp) / 10) * 10) AS game_bucket,
                COUNT(ps.id)::int AS players,
                SUM(CASE WHEN ps.is_bot THEN 1 ELSE 0 END)::int AS bots,
                MAX(CASE WHEN ps.is_winner THEN ps.player_name ELSE NULL END) AS winner,
                md5(
                    COALESCE(
                        string_agg(
                            ps.player_name || ':' || ps.vp || ':' || ps.is_bot,
                            '|' ORDER BY ps.player_name, ps.vp
                        ),
                        ''
                    )
                ) AS roster_hash
            FROM games g
            LEFT JOIN player_stats ps ON ps.game_id = g.id
            GROUP BY g.id, g.guild_id, g.game_timestamp
        ), latest_games AS (
            SELECT DISTINCT ON (guild_id, game_bucket, roster_hash)
                id,
                guild_id,
                game_timestamp,
                players,
                bots,
                winner
            FROM game_rollup
            ORDER BY guild_id, game_bucket, roster_hash, game_timestamp DESC, id DESC
        )`;
    }
    static async hasAdminUsers() {
        const res = await pool.query('SELECT COUNT(*)::int AS count FROM admin_users');
        return res.rows[0].count > 0;
    }

    static async validateCredentials(username: string, password: string) {
        const res = await pool.query(
            `SELECT id
             FROM admin_users
             WHERE username = $1 AND password_hash = crypt($2, password_hash)`,
            [username, password]
        );
        if (res.rowCount == null){
            console.error("issue with validating admin user");
            return false;
        }
        return res.rowCount > 0;
    }

    static async recordLogin(username: string) {
        await pool.query('UPDATE admin_users SET last_login = NOW() WHERE username = $1', [username]);
    }

    static async cleanupExpiredSessions() {
        await pool.query('DELETE FROM admin_sessions WHERE expires_at <= NOW()');
    }

    static async createSession(username: string, ttlMs: number) {
        const token = crypto.randomUUID();
        const expiresAt = new Date(Date.now() + ttlMs);
        await pool.query(
            `INSERT INTO admin_sessions (token, username, expires_at)
             VALUES ($1, $2, $3)`,
            [token, username, expiresAt]
        );
        return { token, expiresAt };
    }

    static async deleteSession(token: string) {
        await pool.query('DELETE FROM admin_sessions WHERE token = $1', [token]);
    }

    static async getValidSession(token: string) {
        await this.cleanupExpiredSessions();
        const res = await pool.query<AdminSessionRow>(
            `SELECT token, username, expires_at
             FROM admin_sessions
             WHERE token = $1`,
            [token]
        );

        if (res.rowCount === 0) return null;

        const row = res.rows[0];
        if (new Date(row.expires_at).getTime() <= Date.now()) {
            await this.deleteSession(token);
            return null;
        }

        return {
            token: row.token,
            username: row.username,
            expiresAt: row.expires_at
        };
    }

    static async getOverviewCounts() {
        const [userCountRes, gameCountRes, botCountRes, serverCountRes] = await Promise.all([
            pool.query('SELECT COUNT(*)::int AS count FROM users'),
            pool.query(
                `${this.getDedupedGamesCte()}
                SELECT COUNT(*)::int AS count FROM latest_games`
            ),
            pool.query('SELECT COUNT(*)::int AS count FROM player_stats WHERE is_bot = true'),
            pool.query("SELECT COUNT(DISTINCT guild_id)::int AS count FROM games WHERE guild_id IS NOT NULL AND guild_id <> 'GLOBAL'")
        ]);

        return {
            userCount: userCountRes.rows[0].count,
            gameCount: gameCountRes.rows[0].count,
            botCount: botCountRes.rows[0].count,
            serverCount: serverCountRes.rows[0].count
        };
    }

    static async listUsers() {
        const res = await pool.query(
            `SELECT discord_id, username, avatar_url, api_key, created_at
             FROM users
             ORDER BY created_at DESC
             LIMIT 200`
        );
        return res.rows;
    }

    static async createUser(discordId: string, username: string | null, avatarUrl: string | null, catanUsername: string | null) {
        await pool.query(
            `INSERT INTO users (discord_id, username, avatar_url, catan_username)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (discord_id) DO NOTHING`,
            [discordId, username, avatarUrl, catanUsername]
        );
    }

    static async createIdentity(discordId: string, catanName: string) {
        await pool.query(
            `INSERT INTO catan_identities (discord_id, catan_name)
             VALUES ($1, $2)
             ON CONFLICT (catan_name) DO NOTHING`,
            [discordId, catanName]
        );
    }

    static async getUserByDiscordId(discordId: string) {
        const res = await pool.query(
            `SELECT discord_id, username, avatar_url, api_key, created_at, catan_username
             FROM users WHERE discord_id = $1`,
            [discordId]
        );
        return res.rows[0] || null;
    }

    static async getIdentitiesByDiscordId(discordId: string) {
        const res = await pool.query(
            `SELECT catan_name, created_at
             FROM catan_identities
             WHERE discord_id = $1
             ORDER BY created_at DESC`,
            [discordId]
        );
        return res.rows;
    }

    static async updateUser(discordId: string, username: string | null, avatarUrl: string | null, catanUsername: string | null) {
        await pool.query(
            `UPDATE users
             SET username = $1, avatar_url = $2, catan_username = $3
             WHERE discord_id = $4`,
            [username, avatarUrl, catanUsername, discordId]
        );
    }

    static async deleteUser(discordId: string) {
        await pool.query('DELETE FROM users WHERE discord_id = $1', [discordId]);
    }

    static async listGames() {
        const res = await pool.query(
            `${this.getDedupedGamesCte()}
            SELECT id,
                   guild_id,
                   game_timestamp,
                   players,
                   bots,
                   winner
            FROM latest_games
            ORDER BY game_timestamp DESC
            LIMIT 200`
        );
        return res.rows;
    }

    static async getGameById(gameId: string) {
        const res = await pool.query(
            `SELECT id, guild_id, game_timestamp, lobby_id
             FROM games WHERE id = $1`,
            [gameId]
        );
        return res.rows[0] || null;
    }

    static async getPlayersByGameId(gameId: string) {
        const res = await pool.query(
            `SELECT player_name, vp, is_bot, is_winner, is_me
             FROM player_stats
             WHERE game_id = $1
             ORDER BY vp DESC`,
            [gameId]
        );
        return res.rows;
    }

    static async getAnalyticsSeries() {
        const res = await pool.query(
            `SELECT date_trunc('day', g.game_timestamp) AS day,
                    SUM(CASE WHEN ps.is_bot THEN 1 ELSE 0 END)::int AS bots,
                    SUM(CASE WHEN ps.is_bot THEN 0 ELSE 1 END)::int AS humans
             FROM games g
             JOIN player_stats ps ON ps.game_id = g.id
             GROUP BY day
             ORDER BY day ASC`
        );
        return res.rows;
    }

    static async getTopPlayers() {
        const res = await pool.query(
            `SELECT player_name, COUNT(*)::int AS appearances
             FROM player_stats
             GROUP BY player_name
             ORDER BY appearances DESC
             LIMIT 10`
        );
        return res.rows;
    }

    static async listServers() {
        const res = await pool.query(
            `SELECT guild_id,
                    COUNT(*)::int AS games,
                    MAX(game_timestamp) AS last_seen
             FROM games
             WHERE guild_id IS NOT NULL AND guild_id <> 'GLOBAL'
             GROUP BY guild_id
             ORDER BY games DESC`
        );
        return res.rows;
    }
}
