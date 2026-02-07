import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { gameSchema } from '../schemas/gameSchema.js';
import { GameService } from '../services/gameService.js';
import { UserService } from '../services/userService.js';
import { SessionService } from '../services/sessionService.js';

const gameRoutes = new Hono();

gameRoutes.post('/ingest', zValidator('json', gameSchema), async (c) => {
    const apiKey = c.req.header('x-api-key');
    if (!apiKey) return c.json({ success: false, error: 'Missing API Key' }, 401);

    const user = await UserService.getUserByApiKey(apiKey);
    if (!user) return c.json({ success: false, error: 'Invalid API Key' }, 403);

    const data = c.req.valid('json');
    console.log(data);
    try {
        // --- 🌸 1. IDENTITY BRIDGE (Option B) ---
        // Find the player flagged as 'isMe' and link that name to this Discord ID
        const uploaderInGame = data.overview.find((p: any) => p.isMe);
        if (uploaderInGame?.name) {
            await UserService.linkCatanIdentity(user.discord_id, uploaderInGame.name);
        }

        // --- 🛡️ 2. BOT FARMING CHECK ---
        const botCount = data.overview.filter((p: any) => p.isBot).length;
        const totalPlayers = data.overview.length;
        const humanCount = totalPlayers - botCount;

        if (humanCount === 1 && botCount >= 3) {
            return c.json({ success: false, error: 'Bot Farming Detected' }, 400);
        }

        // --- 🔄 3. HERO SYNC LOGIC ---
        const uploaderSession = await SessionService.getActiveSession(user.discord_id);

        let finalGuildId = uploaderSession?.guild_id || 'GLOBAL';
        let targetChannelId = uploaderSession?.channel_id;

        // If uploader is GLOBAL, check if any teammates have an active session
        if (finalGuildId === 'GLOBAL') {
            for (const player of data.overview) {
                if (player.isBot || player.isMe) continue;
                
                // Check if this teammate's Catan name is linked to a Discord ID
                const teammateDiscordId = await UserService.getDiscordIdByCatanName(player.name);
                if (teammateDiscordId) {
                    const teammateSession = await SessionService.getActiveSession(teammateDiscordId);
                    if (teammateSession) {
                        finalGuildId = teammateSession.guild_id;
                        targetChannelId = teammateSession.channel_id;
                        console.log(`[SYNC] Adopting Guild ID ${finalGuildId} from teammate ${player.name}`);
                        break; 
                    }
                }
            }
        }

        // --- 📝 4. CREATE GAME ---
        const gameId = await GameService.createGameWithPlayers(user.discord_id, finalGuildId, data);
        
        // --- 📣 5. BOT ANNOUNCEMENT ---
        // Only announce if in a Guild and the current uploader is the one who ran /play
        if (gameId && finalGuildId !== 'GLOBAL' && uploaderSession) {
            try {
                const summary = await GameService.getMatchSummary(gameId);
                fetch(`http://discord-bot:3001/announce`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ summary, guildId: finalGuildId, channelId: targetChannelId })
                }).catch(e => console.error("[Bot Notify Async Error]:", e.message));
            } catch (summaryError: any) {
                console.error('[Summary Logic Error]:', summaryError.message);
            }
        }

        return c.json({ success: true, gameId }, 201);
    } catch (error: any) {
        console.error('[Ingest Error]:', error.message);
        return c.json({ success: false, error: error.message }, 500);
    }
});

export default gameRoutes;