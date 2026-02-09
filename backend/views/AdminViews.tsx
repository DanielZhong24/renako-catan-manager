import { html } from 'hono/html';

type LayoutOptions = {
    title: string;
    showNav: boolean;
    content: string;
};

type AdminOverviewData = {
    userCount: number;
    gameCount: number;
    botCount: number;
    serverCount: number;
};

type AdminUserRow = {
    discord_id: string;
    username: string | null;
    created_at: string;
};

type AdminUserDetail = {
    discord_id: string;
    username: string | null;
    avatar_url: string | null;
    api_key: string | null;
    created_at: string;
    catan_username: string | null;
};

type AdminIdentityRow = {
    catan_name: string;
    created_at: string;
};

type AdminGameRow = {
    id: number;
    guild_id: string | null;
    game_timestamp: string;
    players: number;
    bots: number;
    winner: string | null;
};

type AdminGameDetail = {
    id: number;
    guild_id: string | null;
    game_timestamp: string;
    lobby_id: string;
};

type AdminGamePlayer = {
    player_name: string;
    vp: number;
    is_bot: boolean;
    is_winner: boolean;
    is_me: boolean;
};

type AnalyticsSeriesRow = {
    day: string;
    bots: number;
    humans: number;
};

type AnalyticsTopPlayer = {
    player_name: string;
    appearances: number;
};

type AdminServerRow = {
    guild_id: string;
    games: number;
    last_seen: string;
};

const escapeHtml = (value: unknown) => {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
};

const adminLayout = ({ title, showNav, content }: LayoutOptions) => {
    return html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&family=Sora:wght@300;400;600;700&display=swap" rel="stylesheet">
<style>
    :root {
        color-scheme: light;
    }
    * {
        box-sizing: border-box;
    }
    body {
        font-family: 'Sora', sans-serif;
        margin: 0;
        color: #f9fafb;
        background: radial-gradient(circle at top, rgba(236, 72, 153, 0.25), transparent 45%),
            radial-gradient(circle at 10% 20%, rgba(244, 114, 182, 0.35), transparent 40%),
            #0b0c12;
        min-height: 100vh;
    }
    header {
        padding: 24px 28px 12px;
        display: ${showNav ? 'block' : 'none'};
    }
    header .title {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
    }
    header h1 {
        margin: 0;
        font-size: 22px;
        letter-spacing: 0.4px;
    }
    .nav {
        display: flex;
        flex-wrap: wrap;
        gap: 14px;
        margin-top: 14px;
    }
    .nav a {
        color: #fbcfe8;
        text-decoration: none;
        font-size: 13px;
        padding: 6px 10px;
        border-radius: 999px;
        background: rgba(236, 72, 153, 0.1);
        border: 1px solid rgba(236, 72, 153, 0.3);
    }
    .nav a:hover {
        background: rgba(236, 72, 153, 0.25);
    }
    .nav form {
        margin-left: auto;
    }
    .nav button {
        background: rgba(15, 23, 42, 0.6);
        color: #fdf2f8;
        border: 1px solid rgba(148, 163, 184, 0.6);
        border-radius: 999px;
        padding: 6px 14px;
        cursor: pointer;
        font-size: 12px;
    }
    main {
        padding: 24px 28px 48px;
    }
    .panel {
        background: rgba(17, 19, 28, 0.9);
        border: 1px solid rgba(236, 72, 153, 0.25);
        border-radius: 18px;
        padding: 18px;
        box-shadow: 0 18px 40px rgba(15, 23, 42, 0.35);
    }
    .grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        gap: 16px;
    }
    .card {
        background: rgba(23, 25, 38, 0.9);
        border-radius: 16px;
        padding: 16px;
        border: 1px solid rgba(236, 72, 153, 0.2);
    }
    .card h3 {
        margin: 0 0 8px;
        font-size: 15px;
        color: #fce7f3;
    }
    .card p {
        margin: 0;
        font-size: 18px;
        color: #f9a8d4;
        font-weight: 600;
    }
    table {
        width: 100%;
        border-collapse: collapse;
        background: rgba(16, 18, 28, 0.95);
        border-radius: 16px;
        overflow: hidden;
        border: 1px solid rgba(236, 72, 153, 0.2);
    }
    th, td {
        text-align: left;
        padding: 10px 12px;
        border-bottom: 1px solid rgba(148, 163, 184, 0.15);
        font-size: 13px;
        color: #fce7f3;
    }
    th {
        background: rgba(236, 72, 153, 0.15);
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.6px;
        font-size: 11px;
    }
    tr:last-child td {
        border-bottom: none;
    }
    form {
        display: grid;
        gap: 12px;
        max-width: 520px;
    }
    label {
        font-size: 12px;
        color: #fbcfe8;
    }
    input, textarea, select {
        padding: 8px 10px;
        border: 1px solid rgba(236, 72, 153, 0.3);
        border-radius: 10px;
        font-size: 13px;
        background: rgba(8, 10, 16, 0.8);
        color: #f9fafb;
    }
    button.primary {
        padding: 10px 16px;
        border: none;
        border-radius: 10px;
        background: linear-gradient(135deg, #ec4899, #f472b6);
        color: #0f172a;
        cursor: pointer;
        font-size: 13px;
        font-weight: 700;
        letter-spacing: 0.3px;
    }
    button.secondary {
        padding: 10px 16px;
        border: 1px solid rgba(148, 163, 184, 0.6);
        border-radius: 10px;
        background: transparent;
        color: #fce7f3;
        cursor: pointer;
        font-size: 12px;
    }
    .actions {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        margin-bottom: 12px;
    }
    .actions a {
        color: #f9a8d4;
        text-decoration: none;
        font-size: 12px;
        padding: 6px 10px;
        border-radius: 999px;
        border: 1px solid rgba(236, 72, 153, 0.3);
    }
    .mono {
        font-family: 'JetBrains Mono', monospace;
        font-size: 11px;
        color: #f9a8d4;
    }
    .muted {
        color: #cbd5f5;
        font-size: 12px;
    }
    .tag {
        display: inline-block;
        padding: 2px 8px;
        border-radius: 999px;
        background: rgba(236, 72, 153, 0.15);
        border: 1px solid rgba(236, 72, 153, 0.3);
        font-size: 11px;
        margin-right: 6px;
        color: #fbcfe8;
    }
</style>
</head>
<body>
<header>
    <div class="title">
        <h1>Renako Admin Console</h1>
        <span class="mono">Status: Online</span>
    </div>
    <nav class="nav">
        <a href="/admin">Overview</a>
        <a href="/admin/users">Users</a>
        <a href="/admin/games">Match History</a>
        <a href="/admin/analytics">Analytics</a>
        <a href="/admin/servers">Servers</a>
        <form method="post" action="/admin/logout">
            <button type="submit">Logout</button>
        </form>
    </nav>
</header>
<main>
${html([content])}
</main>
</body>
</html>`;
};

export const renderAdminLoginPage = (message?: string) => {
    const content = `
    <div class="panel" style="max-width:420px;margin:0 auto;">
        <h2>Admin Login</h2>
        <p class="muted">${escapeHtml(message || 'Welcome back. Please sign in to continue.')}</p>
        <form method="post" action="/admin/login" style="margin-top:16px;">
            <div>
                <label for="username">Username</label>
                <input id="username" name="username" required />
            </div>
            <div>
                <label for="password">Password</label>
                <input id="password" name="password" type="password" required />
            </div>
            <button type="submit" class="primary">Sign In</button>
        </form>
    </div>
    `;
    return adminLayout({ title: 'Admin Login', showNav: false, content });
};

export const renderNoAdminsPage = () => {
    const content = `
    <div class="panel" style="max-width:520px;margin:0 auto;">
        <h2>No admin users found</h2>
        <p class="muted">Create an admin user in Postgres, then try again.</p>
        <pre class="mono" style="background:rgba(15, 23, 42, 0.6);padding:12px;border-radius:10px;overflow:auto;">INSERT INTO admin_users (username, password_hash)
VALUES ('admin', crypt('change-this-password', gen_salt('bf')));</pre>
    </div>
    `;
    return adminLayout({ title: 'Admin Login', showNav: false, content });
};

export const renderAdminOverviewPage = (data: AdminOverviewData) => {
    const content = `
    <div class="grid">
        <div class="card">
            <h3>Total Users</h3>
            <p>${escapeHtml(data.userCount)}</p>
        </div>
        <div class="card">
            <h3>Total Games</h3>
            <p>${escapeHtml(data.gameCount)}</p>
        </div>
        <div class="card">
            <h3>Bot Players Logged</h3>
            <p>${escapeHtml(data.botCount)}</p>
        </div>
        <div class="card">
            <h3>Active Servers</h3>
            <p>${escapeHtml(data.serverCount)}</p>
        </div>
    </div>
    <div class="panel" style="margin-top:16px;">
        <h2>Quick Links</h2>
        <div class="actions">
            <a href="/admin/users">Manage Users</a>
            <a href="/admin/games">Review Matches</a>
            <a href="/admin/analytics">View Analytics</a>
        </div>
    </div>
    `;

    return adminLayout({ title: 'Admin Overview', showNav: true, content });
};

export const renderAdminUsersPage = (users: AdminUserRow[]) => {
    const rows = users.map((user) => {
        return `
        <tr>
            <td class="mono">${escapeHtml(user.discord_id)}</td>
            <td>${escapeHtml(user.username)}</td>
            <td>${escapeHtml(user.created_at)}</td>
            <td>
                <form method="get" action="/admin/users/${encodeURIComponent(user.discord_id)}">
                    <button type="submit" class="secondary">View</button>
                </form>
            </td>
        </tr>`;
    }).join('');

    const content = `
    <div class="actions">
        <a href="/admin/users/new">Create User</a>
    </div>
    <div class="panel" style="margin-bottom:16px;">
        <h2>Add Catan Identity</h2>
        <form method="post" action="/admin/users/identities">
            <div>
                <label for="discord_id">Discord ID</label>
                <input id="discord_id" name="discord_id" required />
            </div>
            <div>
                <label for="catan_name">Catan Username</label>
                <input id="catan_name" name="catan_name" required />
            </div>
            <button type="submit" class="primary">Add Identity</button>
        </form>
    </div>
    <table>
        <thead>
            <tr>
                <th>Discord ID</th>
                <th>Username</th>
                <th>Created</th>
                <th>Actions</th>
            </tr>
        </thead>
        <tbody>
            ${rows || '<tr><td colspan="4" class="muted">No users found.</td></tr>'}
        </tbody>
    </table>
    `;

    return adminLayout({ title: 'Users', showNav: true, content });
};

export const renderAdminCreateUserPage = () => {
    const content = `
    <div class="panel">
        <h2>Create User</h2>
        <form method="post" action="/admin/users">
            <div>
                <label for="discord_id">Discord ID</label>
                <input id="discord_id" name="discord_id" required />
            </div>
            <div>
                <label for="username">Username</label>
                <input id="username" name="username" />
            </div>
            <div>
                <label for="avatar_url">Avatar URL</label>
                <input id="avatar_url" name="avatar_url" />
            </div>
            <div>
                <label for="catan_username">Catan Username (optional)</label>
                <input id="catan_username" name="catan_username" />
            </div>
            <button type="submit" class="primary">Create User</button>
        </form>
    </div>
    `;

    return adminLayout({ title: 'Create User', showNav: true, content });
};

export const renderAdminUserDetailPage = (user: AdminUserDetail, identities: AdminIdentityRow[]) => {
    const identityMarkup = identities.length
        ? identities.map((row) => `<span class="tag">${escapeHtml(row.catan_name)}</span>`).join('')
        : '<span class="muted">None linked</span>';

    const content = `
    <div class="panel">
        <h2>User Details</h2>
        <p><strong>Discord ID:</strong> <span class="mono">${escapeHtml(user.discord_id)}</span></p>
        <p><strong>Username:</strong> ${escapeHtml(user.username)}</p>
        <p><strong>API Key:</strong> <span class="mono">${escapeHtml(user.api_key)}</span></p>
        <p><strong>Created:</strong> ${escapeHtml(user.created_at)}</p>
        <p><strong>Catan Username:</strong> ${escapeHtml(user.catan_username)}</p>
        <p><strong>Identities:</strong> ${identityMarkup}</p>
    </div>
    <div class="panel" style="margin-top:16px;">
        <h2>Edit User</h2>
        <form method="post" action="/admin/users/${encodeURIComponent(user.discord_id)}">
            <div>
                <label for="username">Username</label>
                <input id="username" name="username" value="${escapeHtml(user.username)}" />
            </div>
            <div>
                <label for="avatar_url">Avatar URL</label>
                <input id="avatar_url" name="avatar_url" value="${escapeHtml(user.avatar_url)}" />
            </div>
            <div>
                <label for="catan_username">Catan Username</label>
                <input id="catan_username" name="catan_username" value="${escapeHtml(user.catan_username)}" />
            </div>
            <button type="submit" class="primary">Save Changes</button>
        </form>
        <form method="post" action="/admin/users/${encodeURIComponent(user.discord_id)}/delete" style="margin-top:12px;">
            <button type="submit" class="secondary">Delete User</button>
        </form>
    </div>
    `;

    return adminLayout({ title: 'User Details', showNav: true, content });
};

export const renderAdminGamesPage = (games: AdminGameRow[]) => {
    const rows = games.map((game) => {
        return `
        <tr>
            <td class="mono">${escapeHtml(game.id)}</td>
            <td>${escapeHtml(game.guild_id || 'GLOBAL')}</td>
            <td>${escapeHtml(game.game_timestamp)}</td>
            <td>${escapeHtml(game.players)}</td>
            <td>${escapeHtml(game.bots)}</td>
            <td>${escapeHtml(game.winner || 'Unknown')}</td>
            <td><a href="/admin/games/${encodeURIComponent(game.id)}">View</a></td>
        </tr>`;
    }).join('');

    const content = `
    <table>
        <thead>
            <tr>
                <th>Game ID</th>
                <th>Guild</th>
                <th>Timestamp</th>
                <th>Players</th>
                <th>Bots</th>
                <th>Winner</th>
                <th>Actions</th>
            </tr>
        </thead>
        <tbody>
            ${rows || '<tr><td colspan="7" class="muted">No games found.</td></tr>'}
        </tbody>
    </table>
    `;

    return adminLayout({ title: 'Match History', showNav: true, content });
};

export const renderAdminGameDetailPage = (game: AdminGameDetail, players: AdminGamePlayer[]) => {
    const rows = players.map((player) => {
        return `
        <tr>
            <td>${escapeHtml(player.player_name)}</td>
            <td>${escapeHtml(player.vp)}</td>
            <td>${player.is_bot ? 'Yes' : 'No'}</td>
            <td>${player.is_winner ? 'Yes' : 'No'}</td>
            <td>${player.is_me ? 'Yes' : 'No'}</td>
        </tr>`;
    }).join('');

    const content = `
    <div class="panel">
        <h2>Game ${escapeHtml(game.id)}</h2>
        <p><strong>Guild:</strong> ${escapeHtml(game.guild_id || 'GLOBAL')}</p>
        <p><strong>Lobby:</strong> ${escapeHtml(game.lobby_id)}</p>
        <p><strong>Timestamp:</strong> ${escapeHtml(game.game_timestamp)}</p>
    </div>
    <div class="panel" style="margin-top:16px;">
        <h2>Players</h2>
        <table>
            <thead>
                <tr>
                    <th>Name</th>
                    <th>VP</th>
                    <th>Bot</th>
                    <th>Winner</th>
                    <th>Marked as Me</th>
                </tr>
            </thead>
            <tbody>
                ${rows || '<tr><td colspan="5" class="muted">No players recorded.</td></tr>'}
            </tbody>
        </table>
    </div>
    `;

    return adminLayout({ title: 'Game Details', showNav: true, content });
};

export const renderAdminAnalyticsPage = (series: AnalyticsSeriesRow[], topPlayers: AnalyticsTopPlayer[]) => {
    const labels = series.map((row) => row.day);
    const botSeries = series.map((row) => row.bots);
    const humanSeries = series.map((row) => row.humans);

    const topPlayerLabels = topPlayers.map((row) => row.player_name);
    const topPlayerCounts = topPlayers.map((row) => row.appearances);

    const content = `
    <div class="panel">
        <h2>Player vs Bot Activity</h2>
        <canvas id="playerBotChart" height="120"></canvas>
    </div>
    <div class="panel" style="margin-top:16px;">
        <h2>Top Active Players</h2>
        <canvas id="topPlayersChart" height="120"></canvas>
    </div>
    <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
    <script>
        const playerBotLabels = ${JSON.stringify(labels)};
        const botSeries = ${JSON.stringify(botSeries)};
        const humanSeries = ${JSON.stringify(humanSeries)};

        new Chart(document.getElementById('playerBotChart'), {
            type: 'line',
            data: {
                labels: playerBotLabels,
                datasets: [
                    { label: 'Bot Players', data: botSeries, borderColor: '#f97316', backgroundColor: 'rgba(249,115,22,0.2)', tension: 0.3 },
                    { label: 'Human Players', data: humanSeries, borderColor: '#ec4899', backgroundColor: 'rgba(236,72,153,0.2)', tension: 0.3 }
                ]
            },
            options: { responsive: true, plugins: { legend: { position: 'bottom' } } }
        });

        const topPlayersLabels = ${JSON.stringify(topPlayerLabels)};
        const topPlayersCounts = ${JSON.stringify(topPlayerCounts)};

        new Chart(document.getElementById('topPlayersChart'), {
            type: 'bar',
            data: {
                labels: topPlayersLabels,
                datasets: [
                    { label: 'Games Appeared In', data: topPlayersCounts, backgroundColor: '#f472b6' }
                ]
            },
            options: { responsive: true, plugins: { legend: { position: 'bottom' } } }
        });
    </script>
    `;

    return adminLayout({ title: 'Analytics', showNav: true, content });
};

export const renderAdminServersPage = (servers: AdminServerRow[]) => {
    const rows = servers.map((row) => {
        return `
        <tr>
            <td class="mono">${escapeHtml(row.guild_id)}</td>
            <td>${escapeHtml(row.games)}</td>
            <td>${escapeHtml(row.last_seen)}</td>
        </tr>`;
    }).join('');

    const content = `
    <table>
        <thead>
            <tr>
                <th>Guild ID</th>
                <th>Games Recorded</th>
                <th>Last Seen</th>
            </tr>
        </thead>
        <tbody>
            ${rows || '<tr><td colspan="3" class="muted">No servers found.</td></tr>'}
        </tbody>
    </table>
    `;

    return adminLayout({ title: 'Servers', showNav: true, content });
};
