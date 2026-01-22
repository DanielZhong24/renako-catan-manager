// backend/src/services/gameService.ts
import pool from '../db/db.js';

export const GameService = {
  async createGameWithPlayers(userId: string, data: any) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      const gameRes = await client.query(
        `INSERT INTO games (user_id, lobby_id, game_timestamp, dice_stats, res_card_stats, dev_card_stats)
         VALUES ($1, $2, $3, $4, $5, $6) 
         ON CONFLICT (lobby_id) 
         DO UPDATE SET 
            dice_stats = EXCLUDED.dice_stats,
            res_card_stats = EXCLUDED.res_card_stats,
            dev_card_stats = EXCLUDED.dev_card_stats
         RETURNING id`,
        [userId, data.lobbyId, data.timestamp, data.dice_stats, data.res_card_stats, data.dev_card_stats]
      );

      const gameId = gameRes.rows[0].id;

      // Clean out old stats if this is a re-upload
      await client.query('DELETE FROM player_stats WHERE game_id = $1', [gameId]);
    console.log("Raw Data Received:", JSON.stringify(data, null, 2));
    console.log("Overview Length:", data.overview?.length);
      for (const player of data.overview) {
        const pActivity = data.activity_stats?.find((s: any) => s.name === player.name) || {};
        const pResources = data.resource_stats?.find((s: any) => s.name === player.name) || {};

        // UPDATED: Added is_me ($6)
        await client.query(
          `INSERT INTO player_stats (game_id, player_name, vp, is_bot, is_winner, is_me, activity_stats, resource_stats)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            gameId, 
            player.name, 
            player.vp, 
            player.isBot, 
            player.isWinner, 
            player.isMe, // This is the boolean from the extension
            JSON.stringify(pActivity), 
            JSON.stringify(pResources)
          ]
        );
      }

      await client.query('COMMIT');
      return gameId;
    } catch (e) {
      await client.query('ROLLBACK');
      console.error("[Database Error] Player stats failed to save:", e); // Log the specific error
      throw e;
    } finally {
      client.release();
    }
  }
};