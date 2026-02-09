import { Hono } from 'hono';
import pool from '../db/db.js';
import crypto from 'crypto';
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

type AdminSession = {
    token: string;
    username: string;
    expiresAt: Date;
};

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

const cleanupExpiredSessions = async () => {
    await pool.query('DELETE FROM admin_sessions WHERE expires_at <= NOW()');
};

const createSession = async (username: string) => {
    const token = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    await pool.query(
        `INSERT INTO admin_sessions (token, username, expires_at)
         VALUES ($1, $2, $3)`,
        [token, username, expiresAt]
    );
    return { token, expiresAt };
};

const getSession = async (c: any) => {
    const cookies = parseCookies(c.req.header('cookie'));
    const token = cookies[SESSION_COOKIE];
    if (!token) return null;

    await cleanupExpiredSessions();
    const res = await pool.query(
        `SELECT token, username, expires_at
         FROM admin_sessions
         WHERE token = $1`,
        [token]
    );

    if (res.rowCount === 0) return null;

    const row = res.rows[0];
    if (new Date(row.expires_at).getTime() <= Date.now()) {
        await pool.query('DELETE FROM admin_sessions WHERE token = $1', [token]);
        return null;
    }

    return {
        token: row.token,
        session: {
            token: row.token,
            username: row.username,
            expiresAt: row.expires_at
        } as AdminSession
    };
};

const requireAdminSession = async (c: any) => {
    const session = await getSession(c);
    if (!session) {
        return c.redirect('/admin/login');
    }

    return null;
};

const hasAdminUsers = async () => {
    const res = await pool.query('SELECT COUNT(*)::int AS count FROM admin_users');
    return res.rows[0].count > 0;
};

const renderConfigError = (c: any) => {
    return c.html(renderNoAdminsPage(), 500);
};

adminRoutes.get('/login', async (c) => {
    if (!(await hasAdminUsers())) {
        return renderConfigError(c);
    }
    return c.html(renderAdminLoginPage());
});

adminRoutes.post('/login', async (c) => {
    if (!(await hasAdminUsers())) {
        return renderConfigError(c);
    }

    const form = await c.req.parseBody();
    const username = String(form.username || '').trim();
    const password = String(form.password || '');

    const authRes = await pool.query(
        `SELECT id
         FROM admin_users
         WHERE username = $1 AND password_hash = crypt($2, password_hash)`,
        [username, password]
    );

    if (authRes.rowCount === 0) {
        return c.html(renderAdminLoginPage('Invalid credentials. Please try again.'), 401);
    }

    await pool.query('UPDATE admin_users SET last_login = NOW() WHERE username = $1', [username]);
    const session = await createSession(username);
    setSessionCookie(c, session.token, Math.floor(SESSION_TTL_MS / 1000));
    return c.redirect('/admin');
});

adminRoutes.post('/logout', async (c) => {
    const session = await getSession(c);
    if (session) {
        await pool.query('DELETE FROM admin_sessions WHERE token = $1', [session.token]);
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
    const userCountRes = await pool.query('SELECT COUNT(*)::int AS count FROM users');
    const gameCountRes = await pool.query('SELECT COUNT(*)::int AS count FROM games');
    const botCountRes = await pool.query('SELECT COUNT(*)::int AS count FROM player_stats WHERE is_bot = true');
    const serverCountRes = await pool.query("SELECT COUNT(DISTINCT guild_id)::int AS count FROM games WHERE guild_id IS NOT NULL AND guild_id <> 'GLOBAL'");
    return c.html(renderAdminOverviewPage({
        userCount: userCountRes.rows[0].count,
        gameCount: gameCountRes.rows[0].count,
        botCount: botCountRes.rows[0].count,
        serverCount: serverCountRes.rows[0].count
    }));
});

adminRoutes.get('/users', async (c) => {
    const res = await pool.query(
        `SELECT discord_id, username, avatar_url, api_key, created_at
         FROM users
         ORDER BY created_at DESC
         LIMIT 200`
    );

    return c.html(renderAdminUsersPage(res.rows));
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

    await pool.query(
        `INSERT INTO users (discord_id, username, avatar_url, catan_username)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (discord_id) DO NOTHING`,
        [discordId, username, avatarUrl, catanUsername]
    );

    return c.redirect(`/admin/users/${encodeURIComponent(discordId)}`);
});

adminRoutes.post('/users/identities', async (c) => {
    const form = await c.req.parseBody();
    const discordId = String(form.discord_id || '').trim();
    const catanName = String(form.catan_name || '').trim();

    if (!discordId || !catanName) {
        return c.text('Discord ID and Catan username are required.', 400);
    }

    await pool.query(
        `INSERT INTO catan_identities (discord_id, catan_name)
         VALUES ($1, $2)
         ON CONFLICT (catan_name) DO NOTHING`,
        [discordId, catanName]
    );

    return c.redirect(`/admin/users/${encodeURIComponent(discordId)}`);
});

adminRoutes.get('/users/:discordId', async (c) => {
    const discordId = c.req.param('discordId');
    const userRes = await pool.query(
        `SELECT discord_id, username, avatar_url, api_key, created_at, catan_username
         FROM users WHERE discord_id = $1`,
        [discordId]
    );

    if (userRes.rowCount === 0) {
        return c.text('User not found.', 404);
    }

    const identitiesRes = await pool.query(
        `SELECT catan_name, created_at
         FROM catan_identities
         WHERE discord_id = $1
         ORDER BY created_at DESC`,
        [discordId]
    );

    return c.html(renderAdminUserDetailPage(userRes.rows[0], identitiesRes.rows));
});

adminRoutes.post('/users/:discordId', async (c) => {
    const discordId = c.req.param('discordId');
    const form = await c.req.parseBody();
    const username = String(form.username || '').trim() || null;
    const avatarUrl = String(form.avatar_url || '').trim() || null;
    const catanUsername = String(form.catan_username || '').trim() || null;

    await pool.query(
        `UPDATE users
         SET username = $1, avatar_url = $2, catan_username = $3
         WHERE discord_id = $4`,
        [username, avatarUrl, catanUsername, discordId]
    );

    return c.redirect(`/admin/users/${encodeURIComponent(discordId)}`);
});

adminRoutes.post('/users/:discordId/delete', async (c) => {
    const discordId = c.req.param('discordId');
    await pool.query('DELETE FROM users WHERE discord_id = $1', [discordId]);
    return c.redirect('/admin/users');
});

adminRoutes.get('/games', async (c) => {
    const res = await pool.query(
        `SELECT g.id,
                g.guild_id,
                g.game_timestamp,
                COUNT(ps.id)::int AS players,
                SUM(CASE WHEN ps.is_bot THEN 1 ELSE 0 END)::int AS bots,
                MAX(CASE WHEN ps.is_winner THEN ps.player_name ELSE NULL END) AS winner
         FROM games g
         LEFT JOIN player_stats ps ON ps.game_id = g.id
         GROUP BY g.id, g.guild_id, g.game_timestamp
         ORDER BY g.game_timestamp DESC
         LIMIT 200`
    );

    return c.html(renderAdminGamesPage(res.rows));
});

adminRoutes.get('/games/:gameId', async (c) => {
    const gameId = c.req.param('gameId');
    const gameRes = await pool.query(
        `SELECT id, guild_id, game_timestamp, lobby_id
         FROM games WHERE id = $1`,
        [gameId]
    );

    if (gameRes.rowCount === 0) {
        return c.text('Game not found.', 404);
    }

    const playersRes = await pool.query(
        `SELECT player_name, vp, is_bot, is_winner, is_me
         FROM player_stats
         WHERE game_id = $1
         ORDER BY vp DESC`,
        [gameId]
    );

    return c.html(renderAdminGameDetailPage(gameRes.rows[0], playersRes.rows));
});

adminRoutes.get('/analytics', async (c) => {
    const seriesRes = await pool.query(
        `SELECT date_trunc('day', g.game_timestamp) AS day,
                SUM(CASE WHEN ps.is_bot THEN 1 ELSE 0 END)::int AS bots,
                SUM(CASE WHEN ps.is_bot THEN 0 ELSE 1 END)::int AS humans
         FROM games g
         JOIN player_stats ps ON ps.game_id = g.id
         GROUP BY day
         ORDER BY day ASC`
    );

    const topPlayersRes = await pool.query(
        `SELECT player_name, COUNT(*)::int AS appearances
         FROM player_stats
         GROUP BY player_name
         ORDER BY appearances DESC
         LIMIT 10`
    );

    const series = seriesRes.rows.map((row: any) => ({
        day: row.day.toISOString().slice(0, 10),
        bots: row.bots,
        humans: row.humans
    }));

    const topPlayers = topPlayersRes.rows.map((row: any) => ({
        player_name: row.player_name,
        appearances: row.appearances
    }));

    return c.html(renderAdminAnalyticsPage(series, topPlayers));
});

adminRoutes.get('/servers', async (c) => {
    const res = await pool.query(
        `SELECT guild_id,
                COUNT(*)::int AS games,
                MAX(game_timestamp) AS last_seen
         FROM games
         WHERE guild_id IS NOT NULL AND guild_id <> 'GLOBAL'
         GROUP BY guild_id
         ORDER BY games DESC`
    );

    return c.html(renderAdminServersPage(res.rows));
});

export default adminRoutes;
