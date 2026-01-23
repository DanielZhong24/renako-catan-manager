// bot/src/commands/stats.ts
import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { IBotCommand } from '../core/types.js';
import { BotContext } from '../core/BotContext.js';

export class StatsCommand implements IBotCommand {
    data = new SlashCommandBuilder()
        .setName('stats')
        .setDescription('View your Catan career (if Renako doesn\'t collapse first)');

    async execute(interaction: ChatInputCommandInteraction, { api }: BotContext): Promise<void> {
        await interaction.deferReply();

        try {
            const stats = await api.getStats(interaction.user.id);

            // Handle "User exists in DB but has 0 games"
            // Note: Postgres COUNT returns '0' as a string or 0 as number depending on your pg driver config
            if (!stats || Number(stats.total_games) === 0) {
                const emptyEmbed = new EmbedBuilder()
                    .setTitle('Hawaa?! No games found! 💦')
                    .setDescription(
                        "I checked the database and... there's nothing there! " +
                        "Did you forget to turn on the extension? Or maybe you're just a peaceful person " +
                        "who doesn't like conflict? (I wish I could be like that...)"
                    )
                    .addFields({ 
                        name: 'How to fix this:', 
                        value: '1. Make sure you /link your account.\n2. Play a game with the extension active!\n3. Try not to bully me if it still doesn\'t work!' 
                    })
                    .setColor('#FFB6C1');

                await interaction.editReply({ embeds: [emptyEmbed] });
                return;
            }

            const embed = new EmbedBuilder()
                .setAuthor({ name: 'CatanStats Personal Report (Group B)' })
                .setTitle(`📊 ${interaction.user.username}'s Results... I think?`)
                .setColor('#FFB6C1')
                .setThumbnail(interaction.user.displayAvatarURL())
                .addFields(
                    { name: 'Total Games', value: `\`${stats.total_games}\``, inline: true },
                    { name: 'Wins', value: `\`${stats.wins}\``, inline: true },
                    { name: 'Win Rate', value: `\`${stats.win_rate}%\``, inline: true },
                    { name: 'Avg VP', value: `\`${stats.avg_vp}\``, inline: false }
                )
                .setFooter({ text: 'Status: Socially Exhausted' })
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            // Handle "User not found at all" (404 from your API)
            await interaction.editReply("Ugh, I can't even find your account! Are you sure you've used `/link`? My social battery is too low for ghost accounts! 😭");
        }
    }
}