// backend/src/routes/gameRoutes.ts
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { gameSchema } from '../schemas/gameSchema.js';
import { GameService } from '../services/gameService.js';
import { UserService } from '../services/userService.js';
import { SessionService } from '../services/sessionService.js'; // New Import
import type { channel } from 'diagnostics_channel';

const gameRoutes = new Hono();
gameRoutes.post('/ingest', zValidator('json', gameSchema), async (c) => {
  const apiKey = c.req.header('x-api-key');
  
  if (!apiKey) return c.json({ success: false, error: 'Missing API Key' }, 401);

  const user = await UserService.getUserByApiKey(apiKey);
  if (!user) return c.json({ success: false, error: 'Invalid API Key' }, 403);

  // DEBUG 1: Is Zod returning data?
  const data = c.req.valid('json');
  console.log(`[DEBUG ROUTE] Data validated. LobbyID: ${data?.lobbyId}`);

  try {
    // Check for active session without consuming it - allows multiple games per session
    const session = await SessionService.getActiveSession(user.discord_id);
    const finalGuildId = session?.guild_id || 'GLOBAL';
    const targetChannelId = session?.channel_id;
    console.log(`[DEBUG ROUTE] Calling Service with: DiscordID: ${user.discord_id}, GuildID: ${finalGuildId}`);

    // 1. Create the game in the DB
    const gameId = await GameService.createGameWithPlayers(user.discord_id, finalGuildId, data);
    
    // 2. TRIGGER THE SUMMARY (The new part)
    if (gameId && finalGuildId !== 'GLOBAL') {
      // We wrap this in another try/catch so a Bot failure doesn't break the whole Ingest
      try {
        const summary = await GameService.getMatchSummary(gameId);
        
        // Post to the bot using the Docker service name 'bot'
        fetch(`http://discord-bot:3001/announce`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ summary, guildId: finalGuildId, channelId:targetChannelId})
        }).catch(e => console.error("[Bot Notify Async Error]:", e.message));

        console.log(`[DEBUG ROUTE] Summary handshake sent to Bot for Game: ${gameId}`);
      } catch (summaryError: any) {
        console.error('[Summary Logic Error]:', summaryError.message);
      }
    }

    return c.json({ success: true, gameId }, 201);
  } catch (error: any) {
    // DEBUG 3: Catch if the error is coming from the call itself
    console.error('[Ingest Error]:', error.message);
    return c.json({ success: false, error: error.message }, 500);
  }
});
export default gameRoutes;