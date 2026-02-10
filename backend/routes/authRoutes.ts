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

  console.log('🔐 OAuth callback received - code:', code?.substring(0, 10) + '...', 'state:', state, 'saved:', savedState);

  // Security Check
  if (!state || state !== savedState) {
    return c.text("Security Mismatch: State does not match.", 400);
  }

  try {
    // 1. Exchange Code for Token
    console.log('📡 Exchanging code for token...');
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

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error('❌ Token exchange failed:', tokenResponse.status, errorText);
      throw new Error('Failed to get token: ' + errorText);
    }
    const tokenData = await tokenResponse.json();
    console.log('✅ Got access token');

    // 2. Get Discord Profile
    console.log('👤 Fetching Discord profile...');
    const userRes = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    
    if (!userRes.ok) {
      const errorText = await userRes.text();
      console.error('❌ User profile fetch failed:', userRes.status, errorText);
      throw new Error('Failed to fetch user profile: ' + errorText);
    }
    const discordUser = await userRes.json();
    console.log('✅ Got Discord user:', discordUser.username);

    // 3. Upsert to DB
    console.log('💾 Upserting user to database...');
    const user = await UserService.upsertUser(
      discordUser.id, 
      discordUser.username, 
      discordUser.avatar
    );
    console.log('✅ User saved to DB:', user.discord_id);
    const extension_id = process.env.EXTENSION_ID || '';
    console.log("id:",extension_id);
    return c.html(SuccessPage(user.username,user.avatar_url,user.discord_id,user.api_key,extension_id));
  } catch (error) {
    console.error("❌ Auth Error:", error);
    return c.json({ error: "Authentication failed", details: error instanceof Error ? error.message : String(error) }, 500);
  }
});

export default authRoutes;