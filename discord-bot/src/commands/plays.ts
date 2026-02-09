import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import { IBotCommand } from '../core/types.js';
import { BotContext } from '../core/BotContext.js';
import { ApiError } from '../core/ApiClient.js';
import { createRenakoGeneralErrorEmbed } from '../utils/embedGenerator.js';

export class PlayCommand implements IBotCommand {
    data = new SlashCommandBuilder()
        .setName('play')
        .setDescription('Start a game!');

    async execute(interaction: ChatInputCommandInteraction, { api }: BotContext): Promise<void> {
        const uploaderId = interaction.user.id;
        const guildId = interaction.guildId;
        const channelId = interaction.channelId;

        if (!guildId) {
            await interaction.reply({ 
                content: "You can only use this in a server, silly! 🌸", 
                flags: [MessageFlags.Ephemeral] 
            });
            return;
        }

        try {
            // 1. Create a pending session in the DB via your API
            const session = await api.createPendingSession(uploaderId, guildId, channelId, interaction.user.id);
            // 2. Defensive Check: Handle the null case (API returned 404)
            if (!session) {
                await interaction.reply({ 
                    content: "Ugh, I couldn't create a session. Is the backend server running? 😭", 
                    flags: [MessageFlags.Ephemeral] 
                });
                return;
            }

            const embed = new EmbedBuilder()
                .setTitle('🎲 Catan Cartel: Match Starting!')
                .setDescription(
                    `I've set up a gaming session for **${interaction.guild?.name}**!\n\n` +
                    `1. Use the button below to open Colonist.io.\n` +
                    `2. Create a private room and play.\n` +
                    `3. Play as many games as you want!\n\n` +
                    `*This session lasts 60 minutes. All games will be recorded to this server automatically!*`
                )
                .setFooter({ text: `Session ID: ${session.id}` })
                .setColor('#FFB6C1');

            const row = new ActionRowBuilder<ButtonBuilder>()
                .addComponents(
                    new ButtonBuilder()
                        .setLabel('Open Colonist.io')
                        .setURL('https://colonist.io/')
                        .setStyle(ButtonStyle.Link),
                );

            await interaction.reply({ embeds: [embed], components: [row] });
        } catch (error) {
            if (error instanceof ApiError && (error.kind === 'rate_limit' || error.kind === 'upstream')) {
                await interaction.reply({ embeds: [createRenakoGeneralErrorEmbed()], flags: [MessageFlags.Ephemeral] });
                return;
            }
            console.error('Play Command Error:', error);
            await interaction.reply({ 
                content: "My social battery is too low to start a game right now (API Error).", 
                flags: [MessageFlags.Ephemeral] 
            });
        }
    }
}