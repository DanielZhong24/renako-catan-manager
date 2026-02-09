import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { logger } from 'hono/logger';
import { cors } from 'hono/cors';
import 'dotenv/config';
// Import your modules (Remember the .js extension!)
import authRoutes from '../routes/authRoutes.js';
import discordRoutes from '../routes/discordRoutes.js';
import gameRoutes from '../routes/gameRoutes.js';
import adminRoutes from '../routes/adminRoutes.js';

const app = new Hono();

// Global Middleware
app.use('*', logger());
app.use('*', cors());

// Mounting Routes
// This maps your logic to specific URL "folders"
app.route('/api/auth', authRoutes);       // Handles Login/Callback
app.route('/api/discord', discordRoutes); // Handles Bot Interactions
app.route('/api/games', gameRoutes);       // Handles Scraper Data
app.route('/admin', adminRoutes);          // Admin Dashboard

app.get('/', (c) => c.text('Catan Service is Online YAY!'));

const port = Number(process.env.PORT) || 3000;

serve({
  fetch: app.fetch,
  port,
  hostname: '0.0.0.0'
}, (info) => {
  console.log(`🚀 API running on http://localhost:${info.port}`);
});