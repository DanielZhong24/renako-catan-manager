import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { IBotCommand } from '../core/types.js';
import { BotContext } from '../core/BotContext.js';
import { ApiError } from '../core/ApiClient.js';
import { createRenakoGeneralErrorEmbed } from '../utils/embedGenerator.js';

export class HistoryCommand implements IBotCommand {
    data = new SlashCommandBuilder()
        .setName('history')
        .setDescription('View your recent match diary (Renako style!)');

    async execute(interaction: ChatInputCommandInteraction, { api }: BotContext): Promise<void> {
        await interaction.deferReply();

        try {
            const history = await api.getHistory(interaction.user.id);

            if (!history || history.length === 0) {
                await interaction.editReply("H-hawaa! Your match diary is empty! 📖✨ Maybe we should go play a game so I have something to write about?");
                return;
            }

            const embed = new EmbedBuilder()
                .setTitle(`📔 ${interaction.user.username}'s Recent Match Diary`)
                .setDescription("*\"I-I hope I didn't make too many enemies in these games...\"*")
                .setColor('#FFB6C1');

            const historyList = history.map((game: any) => {
                const date = new Date(game.game_timestamp).toLocaleDateString();
                const icon = game.is_winner ? '🏆' : '💀';
                return `${icon} **${game.is_winner ? 'WIN' : 'LOSS'}** | ${game.vp} VP | *${date}*`;
            }).join('\n');

            embed.addFields({ name: 'Last 5 Games', value: historyList });
            embed.setFooter({ text: 'Status: Overthinking every trade I made.' });

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            if (error instanceof ApiError && (error.kind === 'rate_limit' || error.kind === 'upstream')) {
                await interaction.editReply({ embeds: [createRenakoGeneralErrorEmbed()] });
                return;
            }
            await interaction.editReply("Uuu... the API isn't responding. Is it avoiding me too?! 😭");
        }
    }
}