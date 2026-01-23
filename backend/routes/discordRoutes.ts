// backend/src/routes/discordRoutes.ts
import { Hono } from 'hono';
import { UserService } from '../services/userService.js';

const discordRoutes = new Hono();

// This endpoint is internal and used by the bot
discordRoutes.get('/stats/:discordId', async (c) => {
    const discordId = c.req.param('discordId');
    const stats = await UserService.getStatsByDiscordId(discordId);
    
    if (!stats) return c.json({ error: 'not_found' }, 404);
    return c.json(stats);
});

// discordRoutes.get('/history/:discordId', async (c) => {
//     const discordId = c.req.param('discordId');
//     // Assuming you add this method to your UserService
//     const history = await UserService.getHistoryByDiscordId(discordId);
//     return c.json(history);
// });
discordRoutes.get('/user/:discordId', async (c) => {
    const discordId = c.req.param('discordId');
    const user = await UserService.getUserById(discordId);
    
    if (!user) {
        return c.json({ error: 'not_linked' }, 404);
    }
    return c.json(user);
});
export default discordRoutes;