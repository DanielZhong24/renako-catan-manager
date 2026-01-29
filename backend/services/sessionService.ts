import pool from '../db/db.js';

export const SessionService = {
    /**
     * Creates a new pending session. Enforces one active session per user.
     */
    async createSession(uploaderId: string, guildId: string,channelId:string) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // 1. Remove stale sessions for this user
            await client.query(
                'DELETE FROM pending_sessions WHERE uploader_id = $1',
                [uploaderId]
            );

            // 2. Insert new session
            const query = `
                INSERT INTO pending_sessions (uploader_id, guild_id, channel_id) 
                VALUES ($1, $2, $3) 
                RETURNING id, created_at;
            `;
            const res = await client.query(query, [uploaderId, guildId,channelId]);

            await client.query('COMMIT');
            return res.rows[0];
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    },

    /**
     * Gets the active session for a user without deleting it.
     * Sessions remain valid for 60 minutes and persist across multiple games.
     */
    async getActiveSession(uploaderId: string) {
        const query = `
            SELECT guild_id, channel_id 
            FROM pending_sessions 
            WHERE uploader_id = $1 
            AND created_at > NOW() - INTERVAL '60 minutes'
        `;
        const res = await pool.query(query, [uploaderId]);
        return res.rows[0] || null;
    }
};