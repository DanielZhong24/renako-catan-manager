import { Hono } from 'hono';
import { UserService } from '../services/userService.js';
import { SessionService } from '../services/sessionService.js';
const discordRoutes = new Hono();

type RateLimitEntry = {
    count: number;
    resetAt: number;
};

const RATE_LIMIT_WINDOW_MS = 60000;
const RATE_LIMIT_MAX = 10;
const rateLimitStore = new Map<string, RateLimitEntry>();
const RATE_LIMIT_DEBUG = true;

const getRateLimitKey = (c: any): string => {
    const headerDiscordId = c.req.header('x-discord-id');
    if (headerDiscordId) return `user:${headerDiscordId}`;

    const path = typeof c.req.path === 'string' ? c.req.path : '';
    const segments = path.split('/').filter(Boolean);
    if (segments.length >= 2) {
        const routeName = segments[0];
        if (routeName === 'stats' || routeName === 'history' || routeName === 'user') {
            return `user:${segments[1]}`;
        }
    }

    const params = c.req.param();
    const paramDiscordId = params?.discordId;
    if (paramDiscordId) return `user:${paramDiscordId}`;

    const queryDiscordId = c.req.query('discordId') || c.req.query('userId');
    if (queryDiscordId) return `user:${queryDiscordId}`;

    const forwardedFor = c.req.header('x-forwarded-for') || c.req.header('x-real-ip');
    if (forwardedFor) return `ip:${forwardedFor.split(',')[0].trim()}`;

    const userAgent = c.req.header('user-agent') || 'unknown';
    return `anon:${userAgent}`;
};

discordRoutes.use('*', async (c, next) => {
    const key = getRateLimitKey(c);

    const now = Date.now();
    const entry = rateLimitStore.get(key);

    if (!entry || entry.resetAt <= now) {
        rateLimitStore.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
        if (RATE_LIMIT_DEBUG) {
            console.log('[rate-limit] init', { key, path: c.req.path, count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
        }
        await next();
        return;
    }

    entry.count += 1;
    if (RATE_LIMIT_DEBUG) {
        console.log('[rate-limit] hit', { key, path: c.req.path, count: entry.count, resetAt: entry.resetAt });
    }
    if (entry.count > RATE_LIMIT_MAX) {
        const retryAfterMs = Math.max(0, entry.resetAt - now);
        c.header('Retry-After', Math.ceil(retryAfterMs / 1000).toString());
        if (RATE_LIMIT_DEBUG) {
            console.log('[rate-limit] blocked', { key, path: c.req.path, retryAfterMs });
        }
        return c.json({ error: 'rate_limited', retryAfterMs }, 429);
    }

    await next();
});

discordRoutes.get('/stats/:discordId', async (c) => {
    const discordId = c.req.param('discordId');
    const stats = await UserService.getStatsByDiscordId(discordId);
    if (!stats) return c.json({ error: 'not_found' }, 404);
    return c.json(stats);
});

discordRoutes.get('/history/:discordId', async (c) => {
    const discordId = c.req.param('discordId');
    const history = await UserService.getHistoryByDiscordId(discordId);
    return c.json(history);
});

discordRoutes.get('/leaderboard/:guildId', async (c) => {
    const guildId = c.req.param('guildId');
    const limitParam = c.req.query('limit');
    const limit = Math.min(Math.max(Number(limitParam) || 10, 1), 50);

    if (!guildId) return c.json({ error: 'guild_required' }, 400);

    const leaderboard = await UserService.getLeaderboardByGuildId(guildId, limit);
    return c.json(leaderboard);
});
discordRoutes.get('/user/:discordId', async (c) => {
    const discordId = c.req.param('discordId');
    const user = await UserService.getUserById(discordId);
    
    if (!user) {
        return c.json({ error: 'not_linked' }, 404);
    }
    return c.json(user);
});

discordRoutes.get('/search', async (c) => {
    const name = c.req.query('name');
    
    if (!name) return c.json({ error: 'name_required' }, 400);

    const stats = await UserService.getStatsByCatanName(name);
    
    if (!stats) return c.json({ error: 'not_found' }, 404);
    
    return c.json(stats);
});
discordRoutes.post('/sessions', async (c) => {
    const { uploaderId, guildId,channelId } = await c.req.json();

    if (!uploaderId || !guildId) {
        return c.json({ error: 'missing_params' }, 400);
    }

    try {
        // Verify the user exists (Foreign Key requirement)
        const user = await UserService.getUserById(uploaderId);
        if (!user) {
            return c.json({ error: 'user_not_found' }, 403);
        }

        const session = await SessionService.createSession(uploaderId, guildId,channelId);
        return c.json(session, 201);
    } catch (error) {
        console.error('Session Error:', error);
        return c.json({ error: 'server_error' }, 500);
    }
});

export default discordRoutes;