// bot/src/index.ts
import { Client, GatewayIntentBits } from 'discord.js';
import pkg from 'pg';
import * as dotenv from 'dotenv';
import { CommandHandler } from './core/CommandHandler.js';

dotenv.config();
const { Pool } = pkg;

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const handler = new CommandHandler();

// Use a top-level async block to load commands before logging in
(async () => {
    const commands = await handler.load();

    client.on('interactionCreate', async (interaction) => {
        if (!interaction.isChatInputCommand()) return;

        const command = commands.get(interaction.commandName);
        if (!command) return;

        try {
            await command.execute(interaction, { pool });
        } catch (error) {
            console.error(error);
            const msg = { content: 'Error executing command!', ephemeral: true };
            interaction.deferred || interaction.replied 
                ? await interaction.followUp(msg) 
                : await interaction.reply(msg);
        }
    });

    client.login(process.env.DISCORD_TOKEN);
})();