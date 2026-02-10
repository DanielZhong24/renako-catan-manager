import { Hono } from 'hono';
import { AdminService } from '../services/adminService.js';
import {
    renderAdminAnalyticsPage,
    renderAdminCreateUserPage,
    renderAdminGameDetailPage,
    renderAdminGamesPage,
    renderAdminLoginPage,
    renderAdminOverviewPage,
    renderAdminServersPage,
    renderAdminUserDetailPage,
    renderAdminUsersPage,
    renderNoAdminsPage
} from '../views/AdminViews.js';

const adminRoutes = new Hono();

const SESSION_COOKIE = 'admin_session';
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const ADMIN_COOKIE_SECURE = process.env.ADMIN_COOKIE_SECURE === 'true';

const parseCookies = (cookieHeader: string | undefined) => {
    if (!cookieHeader) return {} as Record<string, string>;
    return cookieHeader.split(';').reduce((acc, part) => {
        const [rawKey, ...rawValue] = part.trim().split('=');
        if (!rawKey) return acc;
        acc[rawKey] = decodeURIComponent(rawValue.join('=') || '');
        return acc;
    }, {} as Record<string, string>);
};

const setSessionCookie = (c: any, token: string, maxAgeSeconds: number) => {
    const parts = [
        `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
        `Max-Age=${maxAgeSeconds}`,
        'Path=/admin',
        'HttpOnly',
        'SameSite=Lax'
    ];
    if (ADMIN_COOKIE_SECURE) {
        parts.push('Secure');
    }
    c.header('Set-Cookie', parts.join('; '));
};

const clearSessionCookie = (c: any) => {
    const parts = [
        `${SESSION_COOKIE}=`,
        'Max-Age=0',
        'Path=/admin',
        'HttpOnly',
        'SameSite=Lax'
    ];
    if (ADMIN_COOKIE_SECURE) {
        parts.push('Secure');
    }
    c.header('Set-Cookie', parts.join('; '));
};

const getSession = async (c: any) => {
    const cookies = parseCookies(c.req.header('cookie'));
    const token = cookies[SESSION_COOKIE];
    if (!token) return null;
    const session = await AdminService.getValidSession(token);
    if (!session) return null;

    return { token: session.token, session };
};

const requireAdminSession = async (c: any) => {
    const session = await getSession(c);
    if (!session) {
        return c.redirect('/admin/login');
    }

    return null;
};

const renderConfigError = (c: any) => {
    return c.html(renderNoAdminsPage(), 500);
};

adminRoutes.get('/login', async (c) => {
    if (!(await AdminService.hasAdminUsers())) {
        return renderConfigError(c);
    }
    return c.html(renderAdminLoginPage());
});

adminRoutes.post('/login', async (c) => {
    if (!(await AdminService.hasAdminUsers())) {
        return renderConfigError(c);
    }

    const form = await c.req.parseBody();
    const username = String(form.username || '').trim();
    const password = String(form.password || '');

    const isValid = await AdminService.validateCredentials(username, password);
    if (!isValid) {
        return c.html(renderAdminLoginPage('Invalid credentials. Please try again.'), 401);
    }

    await AdminService.recordLogin(username);
    const session = await AdminService.createSession(username, SESSION_TTL_MS);
    setSessionCookie(c, session.token, Math.floor(SESSION_TTL_MS / 1000));
    return c.redirect('/admin');
});

adminRoutes.post('/logout', async (c) => {
    const session = await getSession(c);
    if (session) {
        await AdminService.deleteSession(session.token);
    }
    clearSessionCookie(c);
    return c.redirect('/admin/login');
});

adminRoutes.use('*', async (c, next) => {
    const authResponse = await requireAdminSession(c);
    if (authResponse) return authResponse;
    await next();
});

adminRoutes.get('/', async (c) => {
    const counts = await AdminService.getOverviewCounts();
    return c.html(renderAdminOverviewPage(counts));
});

adminRoutes.get('/users', async (c) => {
    const users = await AdminService.listUsers();
    return c.html(renderAdminUsersPage(users));
});

adminRoutes.get('/users/new', async (c) => {
    return c.html(renderAdminCreateUserPage());
});

adminRoutes.post('/users', async (c) => {
    const form = await c.req.parseBody();
    const discordId = String(form.discord_id || '').trim();
    const username = String(form.username || '').trim() || null;
    const avatarUrl = String(form.avatar_url || '').trim() || null;
    const catanUsername = String(form.catan_username || '').trim() || null;

    if (!discordId) {
        return c.text('Discord ID is required.', 400);
    }

    await AdminService.createUser(discordId, username, avatarUrl, catanUsername);

    return c.redirect(`/admin/users/${encodeURIComponent(discordId)}`);
});

adminRoutes.post('/users/identities', async (c) => {
    const form = await c.req.parseBody();
    const discordId = String(form.discord_id || '').trim();
    const catanName = String(form.catan_name || '').trim();

    if (!discordId || !catanName) {
        return c.text('Discord ID and Catan username are required.', 400);
    }

    await AdminService.createIdentity(discordId, catanName);

    return c.redirect(`/admin/users/${encodeURIComponent(discordId)}`);
});

adminRoutes.get('/users/:discordId', async (c) => {
    const discordId = c.req.param('discordId');
    const user = await AdminService.getUserByDiscordId(discordId);
    if (!user) {
        return c.text('User not found.', 404);
    }
    const identities = await AdminService.getIdentitiesByDiscordId(discordId);
    return c.html(renderAdminUserDetailPage(user, identities));
});

adminRoutes.post('/users/:discordId', async (c) => {
    const discordId = c.req.param('discordId');
    const form = await c.req.parseBody();
    const username = String(form.username || '').trim() || null;
    const avatarUrl = String(form.avatar_url || '').trim() || null;
    const catanUsername = String(form.catan_username || '').trim() || null;

    await AdminService.updateUser(discordId, username, avatarUrl, catanUsername);

    return c.redirect(`/admin/users/${encodeURIComponent(discordId)}`);
});

adminRoutes.post('/users/:discordId/delete', async (c) => {
    const discordId = c.req.param('discordId');
    await AdminService.deleteUser(discordId);
    return c.redirect('/admin/users');
});

adminRoutes.get('/games', async (c) => {
    const games = await AdminService.listGames();
    return c.html(renderAdminGamesPage(games));
});

adminRoutes.get('/games/:gameId', async (c) => {
    const gameId = c.req.param('gameId');
    const game = await AdminService.getGameById(gameId);
    if (!game) {
        return c.text('Game not found.', 404);
    }
    const players = await AdminService.getPlayersByGameId(gameId);
    return c.html(renderAdminGameDetailPage(game, players));
});

adminRoutes.get('/analytics', async (c) => {
    const [seriesRows, topPlayersRows] = await Promise.all([
        AdminService.getAnalyticsSeries(),
        AdminService.getTopPlayers()
    ]);

    const series = seriesRows.map((row: any) => ({
        day: row.day.toISOString().slice(0, 10),
        bots: row.bots,
        humans: row.humans
    }));

    const topPlayers = topPlayersRows.map((row: any) => ({
        player_name: row.player_name,
        appearances: row.appearances
    }));

    return c.html(renderAdminAnalyticsPage(series, topPlayers));
});

adminRoutes.get('/servers', async (c) => {
    const servers = await AdminService.listServers();
    return c.html(renderAdminServersPage(servers));
});

export default adminRoutes;
