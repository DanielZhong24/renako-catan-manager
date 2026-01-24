import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { IBotCommand } from '../core/types.js';
import { BotContext } from '../core/BotContext.js';

export class QueryByNameCommand implements IBotCommand {
    // We cast to any to avoid the SlashCommandOptionsOnlyBuilder type mismatch error
    data = new SlashCommandBuilder()
        .setName('lookup')
        .setDescription('Search for a player by their Catan username')
        .addStringOption(option => 
            option.setName('name')
                .setDescription('The exact Catan name to search for')
                .setRequired(true)) as any;

    async execute(interaction: ChatInputCommandInteraction, { api }: BotContext): Promise<void> {
        const catanName = interaction.options.getString('name');
        await interaction.deferReply();

        try {
            // Using 'api' to match your BotContext destructuring
            const player = await api.getPlayerByCatanName(catanName!);
            const botStatus = player.is_bot?"(**Bot**)":"";

            if (!player || Number(player.total_games) === 0) {
                const emptyEmbed = new EmbedBuilder()
                    .setTitle('E-Ehhh?! Who is that? 💦')
                    .setDescription(`I searched high and low, but "${catanName}" doesn't seem to exist in my records. Are they a ghost? A figment of my imagination?!`)
                    .setColor('#FFB6C1');

                await interaction.editReply({ embeds: [emptyEmbed] });
                return;
            }

            const embed = new EmbedBuilder()
                .setAuthor({ name: 'CatanStats Player Search' })
                .setTitle(`Found them! It's ${player.catan_name} ${botStatus}`)
                .setColor('#FFB6C1')
                .addFields(
                    { name: 'Total Games', value: `\`${player.total_games}\``, inline: true },
                    { name: 'Wins', value: `\`${player.wins}\``, inline: true },
                    { name: 'Win Rate', value: `\`${player.win_rate}%\``, inline: true },
                    { name: 'Avg VP', value: `\`${player.avg_vp}\``, inline: false }
                )
                .setFooter({ text: 'Status: Investigating strangers is tiring...' })
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            await interaction.editReply("Something went wrong with the search! Maybe the database is as overwhelmed as I am... 😭");
        }
    }
}