import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { gameSchema } from '../schemas/gameSchema.js';
import { GameService } from '../services/gameService.js';
import { UserService } from '../services/userService.js'; // Import UserService

const gameRoutes = new Hono();

gameRoutes.post('/ingest', zValidator('json', gameSchema), async (c) => {
  // 1. Validate the API Key first
  const apiKey = c.req.header('x-api-key');
  
  if (!apiKey) {
    return c.json({ success: false, error: 'Missing API Key' }, 401);
  }

  const user = await UserService.getUserByApiKey(apiKey);
  if (!user) {
    return c.json({ success: false, error: 'Invalid API Key' }, 403);
  }

  // 2. Get the validated JSON data from Zod
  const data = c.req.valid('json');

  try {
    // 3. Pass both the user's Discord ID and the game data
    const gameId = await GameService.createGameWithPlayers(user.discord_id, data);
    
    console.log(`[Ingest] Game ${data.lobbyId} saved for ${user.username}`);
    return c.json({ success: true, gameId }, 201);
  } catch (error) {
    console.error('[Ingest Error]:', error);
    return c.json({ success: false, error: 'Failed to ingest game' }, 500);
  }
});

export default gameRoutes;