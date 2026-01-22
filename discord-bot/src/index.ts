import { Client, GatewayIntentBits, EmbedBuilder } from 'discord.js';
import pkg from 'pg';
const { Pool } = pkg;
import * as dotenv from 'dotenv';

dotenv.config();

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// Connect to the same DB as the backend
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

client.once('ready', () => {
    console.log(`🤖 Bot logged in as ${client.user?.tag}`);
});

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'stats') {
        await interaction.deferReply();

        try {
            const discordId = interaction.user.id;
            
            // Query the view we created in our init.sql
            const result = await pool.query(
                'SELECT * FROM user_stats_view WHERE discord_id = $1',
                [discordId]
            );

            if (result.rows.length === 0) {
                return interaction.editReply("No games recorded! Link your extension and play a game first.");
            }

            const stats = result.rows[0];
            const embed = new EmbedBuilder()
                .setTitle(`📊 Catan Stats: ${stats.username}`)
                .setColor('#E67E22')
                .addFields(
                    { name: 'Games', value: String(stats.total_games), inline: true },
                    { name: 'Wins', value: String(stats.wins), inline: true },
                    { name: 'Win Rate', value: `${stats.win_rate}%`, inline: true },
                    { name: 'Avg VP', value: String(stats.avg_vp), inline: true }
                )
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });
        } catch (error) {
            console.error(error);
            await interaction.editReply("Error fetching stats.");
        }
    }
});

client.login(process.env.DISCORD_TOKEN);