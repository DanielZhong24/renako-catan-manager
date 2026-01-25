// bot/src/deploy-commands.ts
import { REST, Routes } from 'discord.js';
import * as dotenv from 'dotenv';
import { CommandHandler } from './core/CommandHandler.js';

dotenv.config();

(async () => {
    const handler = new CommandHandler();
    const commands = await handler.load();
    const commandData = Array.from(commands.values()).map(c => c.data.toJSON());

    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN!);

    try {
        console.log('🚀 Deploying commands to Discord...');
        await rest.put(
            Routes.applicationCommands(process.env.DISCORD_CLIENT_ID!),
            { body: commandData },
        );
        console.log('✅ Deployment complete.');
    } catch (error) {
        console.error('❌ Deployment failed:', error);
    }
})();