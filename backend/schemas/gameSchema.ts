import { z } from 'zod';

/**
 * Schema for individual player statistics within a game.
 * The 'isMe' flag is the critical link for multi-user support.
 */
export const playerOverviewSchema = z.object({
  name: z.string(),
  vp: z.number().int().min(0),
  isBot: z.boolean(),
  isWinner: z.boolean(),
  isMe: z.boolean() // Identifies which player in the list uploaded the game
});

/**
 * Main game ingestion schema.
 * Matches the JSON structure sent by the Chrome Extension.
 */
export const gameSchema = z.object({
  lobbyId: z.string().min(1),
  timestamp: z.string().datetime(), // Validates ISO string format
  overview: z.array(playerOverviewSchema),
  
  // Game-wide statistics stored as JSONB in Postgres
  dice_stats: z.record(z.string(), z.number()),
  res_card_stats: z.record(z.string(), z.number()),
  dev_card_stats: z.record(z.string(), z.number()).optional(),
  
  // Detailed activity/resource logs for deep-dive analytics
  activity_stats: z.array(z.any()),
  resource_stats: z.array(z.any())
});

export type GameIngestData = z.infer<typeof gameSchema>;