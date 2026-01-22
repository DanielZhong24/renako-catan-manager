import { Hono } from 'hono';
import { UserService } from '../services/userService.js';
import { setCookie, getCookie } from 'hono/cookie';
import {SuccessPage} from '../views/SucessPage.js';

const authRoutes = new Hono();

authRoutes.get('/login', (c) => {
  console.log("DEBUG - Auth URL:", process.env.DISCORD_AUTH_URL); // Add this
  // Generate a random string to prevent CSRF attacks
  const state = Math.random().toString(36).substring(7);
  setCookie(c, 'auth_state', state, { maxAge: 600, httpOnly: true ,path:'/',sameSite:'Lax' });

  const url = `${process.env.DISCORD_AUTH_URL}&state=${state}`;
  return c.redirect(url);
});

authRoutes.get('/callback', async (c) => {
  const code = c.req.query('code');
  const state = c.req.query('state');
  const savedState = getCookie(c, 'auth_state');

  // Security Check
  if (!state || state !== savedState) {
    return c.text("Security Mismatch: State does not match.", 400);
  }

  try {
    // 1. Exchange Code for Token
    const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      body: new URLSearchParams({
        client_id: process.env.DISCORD_CLIENT_ID!,
        client_secret: process.env.DISCORD_CLIENT_SECRET!,
        grant_type: 'authorization_code',
        code: code!,
        redirect_uri: process.env.REDIRECT_URI!,
      }),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });

    if (!tokenResponse.ok) throw new Error('Failed to get token');
    const tokenData = await tokenResponse.json();

    // 2. Get Discord Profile
    const userRes = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    
    if (!userRes.ok) throw new Error('Failed to fetch user profile');
    const discordUser = await userRes.json();

    // 3. Upsert to DB
    const user = await UserService.upsertUser(
      discordUser.id, 
      discordUser.username, 
      discordUser.avatar
    );

    return c.html(SuccessPage(user.username,user.avatar_url,user.discord_id,user.api_key));
  } catch (error) {
    console.error("Auth Error:", error);
    return c.json({ error: "Authentication failed" }, 500);
  }
});

export default authRoutes;