// bot/src/index.ts
import { Client, GatewayIntentBits } from 'discord.js';
import * as dotenv from 'dotenv';
import { CommandHandler } from './core/CommandHandler.js';
import { ApiClient } from './core/ApiClient.js';

dotenv.config();
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const api = new ApiClient(process.env.API_BASE_URL || "http://api:3000");
const handler = new CommandHandler();

(async () => {
    // 1. Load your commands into memory
    const commands = await handler.load();

    // 2. This function provides the 'interaction' variable
    client.on('interactionCreate', async (interaction) => {
        
        // 3. Ensure it's a slash command
        if (!interaction.isChatInputCommand()) return;

        // 4. FIND the command. This defines the 'command' variable
        const command = commands.get(interaction.commandName);

        if (!command) return;

        try {
            // 5. Now 'command', 'interaction', and 'api' are all visible!
            await command.execute(interaction, { api });
        } catch (error) {
            console.error(error);
            await interaction.reply({ content: 'Error!', ephemeral: true });
        }
    });

    client.login(process.env.DISCORD_TOKEN);
})();