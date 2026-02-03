// bot/src/index.ts
import { Client, GatewayIntentBits, Events } from 'discord.js';
import * as dotenv from 'dotenv';
import { serve } from '@hono/node-server'; // Import the Node server helper
import { CommandHandler } from './core/CommandHandler.js';
import { ApiClient } from './core/ApiClient.js';
import { setupInternalRoutes } from './api/internalRoutes.js'; // Import your new routes

dotenv.config();

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const api = new ApiClient(process.env.INTERNAL_API_URL || "http://api:3000");
const handler = new CommandHandler();

(async () => {
    console.log("🌸 Renako is trying to wake up...");
    
    // 1. Load commands into memory
    const commands = await handler.load();
    await handler.register(Array.from(commands.values()));

    client.once(Events.ClientReady, async (c) => {
        console.log(`✅ Ready! Logged in as ${c.user.tag}`);
        
        // --- START HONO INTERNAL LISTENER ---
        // We start the server as soon as the Discord client is ready
        const app = setupInternalRoutes(client);
        
        serve({
            fetch: app.fetch,
            port: 3001
        }, (info) => {
            console.log(`📡 Internal API listening on http://localhost:${info.port}`);
        });
        // ------------------------------------
    });

    client.on(Events.InteractionCreate, async (interaction) => {
        if (!interaction.isChatInputCommand()) return;

        const command = commands.get(interaction.commandName);
        if (!command) return;

        try {
            await command.execute(interaction, { api });
        } catch (error) {
            console.error("Interaction Error:", error);
            if (interaction.deferred || interaction.replied) {
                await interaction.followUp({ content: 'Hawaa! Something went wrong...', ephemeral: true });
            } else {
                await interaction.reply({ content: 'Hawaa! Something went wrong...', ephemeral: true });
            }
        }
    });

    await client.login(process.env.DISCORD_TOKEN);
})();