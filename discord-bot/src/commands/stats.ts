// bot/src/commands/stats.ts
import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { IBotCommand } from '../core/types.js';
import { BotContext } from '../core/BotContext.js';

export class StatsCommand implements IBotCommand {
    data = new SlashCommandBuilder()
        .setName('stats')
        .setDescription('View your lifetime Catan stats');

    async execute(interaction: ChatInputCommandInteraction, { pool }: BotContext): Promise<void> {
        await interaction.deferReply();
        try {
            const result = await pool.query(
                'SELECT * FROM user_stats_view WHERE discord_id = $1',
                [interaction.user.id]
            );

            if (result.rows.length === 0) {
                await interaction.editReply("No games recorded! Link your extension and play a game first.");
                return; // Exits the function without returning the Message object
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
                );

            await interaction.editReply({ embeds: [embed] });
        } catch (error) {
            console.error(error);
            await interaction.editReply("Error fetching stats.");
        }
    }
}