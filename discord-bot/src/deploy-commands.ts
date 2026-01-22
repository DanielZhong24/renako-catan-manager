import { REST, Routes, SlashCommandBuilder } from 'discord.js';
import * as dotenv from 'dotenv';

// Load environment variables from your .env file
dotenv.config();

const commands = [
  new SlashCommandBuilder()
    .setName('stats')
    .setDescription('View your lifetime Catan stats')
    .toJSON(),
  new SlashCommandBuilder()
    .setName('rank')
    .setDescription('Compare your rank against other users')
    .toJSON()
];

// Initialize the REST client
const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN!);

(async () => {
  try {
    console.log('🚀 Started refreshing application (/) commands...');

    // We register to a specific GUILD (Server) for instant updates. 
    // Global registration can take up to an hour to show up.
    await rest.put(
      Routes.applicationGuildCommands(
        process.env.DISCORD_CLIENT_ID!, 
        process.env.GUILD_ID! // Make sure this is in your .env
      ),
      { body: commands },
    );

    console.log('✅ Successfully reloaded application (/) commands!');
  } catch (error) {
    console.error('❌ Error registering commands:', error);
  }
})();