import pool from '../db/db.js';
import type { MatchTitles } from '../schemas/gameSchema.js';
import { UserService } from './userService.js'; 
export const GameService = {
  async createGameWithPlayers(userId: string, guildId: string, data: any) {
      const client = await pool.connect();
      
      try {
        await client.query('BEGIN');
        
        // 1. (Keep your existing INSERT INTO games logic here...)
        const gameRes = await client.query(
          `INSERT INTO games (user_id, lobby_id, guild_id, game_timestamp, dice_stats, res_card_stats, dev_card_stats)
          VALUES ($1, $2, $3, $4, $5, $6, $7) 
          ON CONFLICT (lobby_id, game_timestamp) 
          DO UPDATE SET 
              guild_id = EXCLUDED.guild_id,
              dice_stats = EXCLUDED.dice_stats,
              res_card_stats = EXCLUDED.res_card_stats,
              dev_card_stats = EXCLUDED.dev_card_stats
          RETURNING id`,
          [userId, data.lobbyId, guildId, data.timestamp, JSON.stringify(data.dice_stats), JSON.stringify(data.res_card_stats), JSON.stringify(data.dev_card_stats || {})]
        );

        const gameId = gameRes.rows[0].id;
        await client.query('DELETE FROM player_stats WHERE game_id = $1', [gameId]);

        // 2. Loop through players and find their identities
        for (const player of data.overview) {
          const pActivity = data.activity_stats?.find((s: any) => s.name === player.name) || {};
          const pResources = data.resource_stats?.find((s: any) => s.name === player.name) || {};

          // --- 🌸 NEW LOOKUP LOGIC ---
          // Look up if this Catan name belongs to any Discord ID in our new table
          const linkedDiscordId = await UserService.getDiscordIdByCatanName(player.name);

          await client.query(
            `INSERT INTO player_stats (
              game_id, discord_id, uploader_id, player_name, 
              vp, is_bot, is_winner, is_me, 
              activity_stats, resource_stats
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [
              gameId, 
              linkedDiscordId, // The ID from catan_identities (can be null if stranger)
              userId,          // The person who uploaded
              player.name, 
              player.vp, 
              player.isBot, 
              player.isWinner, 
              player.isMe, 
              JSON.stringify(pActivity), 
              JSON.stringify(pResources)
            ]
          );
        }

        await client.query('COMMIT');
        return gameId;
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    },


  async getMatchSummary(gameId: number): Promise<MatchTitles> {
          const query = `
              WITH game_data AS (
                  SELECT id, dice_stats, 
                  (SELECT SUM(value::int) FROM jsonb_each_text(dice_stats)) as total_rolls
                  FROM games WHERE id = $1
              )
              SELECT 
                  gd.total_rolls,
                  -- Basic Winner Info
                  w.player_name as winner_name,
                  w.vp as winner_vp,
                  
                  -- "The Thief": Highest income_rob
                  (SELECT player_name FROM player_stats 
                  WHERE game_id = $1 ORDER BY (resource_stats->>'income_rob')::int DESC LIMIT 1) as the_thief,
                  
                  -- "The Embargo": Most trades proposed that were NOT accepted
                  (SELECT player_name FROM player_stats 
                  WHERE game_id = $1 
                  ORDER BY ((activity_stats->>'trades_proposed')::int - (activity_stats->>'trades_accepted')::int) DESC LIMIT 1) as the_embargoed,

                  -- "The Turtle": Most dev cards bought
                  (SELECT player_name FROM player_stats 
                  WHERE game_id = $1 ORDER BY (activity_stats->>'dev_cards_bought')::int DESC LIMIT 1) as the_turtle,

                  -- "The Villain": Most resource loss due to being robbed/blocked
                  (SELECT player_name FROM player_stats 
                  WHERE game_id = $1 ORDER BY (resource_stats->>'loss_rob')::int DESC LIMIT 1) as the_villain,

                  -- Luck Index: percentage of 6s and 8s rolled
                  ROUND(
                      (((gd.dice_stats->>'6')::float + (gd.dice_stats->>'8')::float) / 
                      NULLIF(gd.total_rolls, 0) * 100)::numeric, 1
                  )::float as luck_index
              FROM game_data gd
              JOIN player_stats w ON w.game_id = gd.id
              WHERE w.is_winner = true
              LIMIT 1;
          `;

          const res = await pool.query(query, [gameId]);
          const row = res.rows[0];

          if (!row) throw new Error("Match not found");

          return {
              winnerName: row.winner_name,
              winnerVp: row.winner_vp,
              theThief: row.the_thief,
              theEmbargoed: row.the_embargoed,
              theTurtle: row.the_turtle,
              theVillain: row.the_villain,
              luckIndex: row.luck_index || 0,
              totalRolls: row.total_rolls || 0
          };
      }
};