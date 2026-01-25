import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { IBotCommand } from '../core/types.js';
import { BotContext } from '../core/BotContext.js';

// bot/src/commands/link.ts
export class LinkCommand implements IBotCommand {
    data = new SlashCommandBuilder()
        .setName('link')
        .setDescription('Check your connection status');

    async execute(interaction: ChatInputCommandInteraction, { api }: BotContext): Promise<void> {
        // 1. Defer so the bot doesn't time out while waiting for the API
        await interaction.deferReply({ flags: [64] });

        try {
            // 2. Ask the API: "Do you know this user?"
            const user = await api.checkUser(interaction.user.id);

            if (user) {
                // CASE: User is in the database (Logged in)
                const embed = new EmbedBuilder()
                    .setTitle('✅ Account Connected')
                    .setDescription(`You are logged in as **${user.username}**.`)
                    .addFields({ name: 'Your Extension Key', value: `\`${user.api_key}\`` })
                    .setColor('#2ECC71');
                const button = new ActionRowBuilder<ButtonBuilder>().addComponents(
                    new ButtonBuilder().setLabel("If you still need to connect...").setURL("http://localhost:3000/api/auth/login").setStyle(ButtonStyle.Link)
                );
                await interaction.editReply({ embeds: [embed],components:[button] });
            } else {
                // CASE: User is NOT in the database (Not logged in)
                const embed = new EmbedBuilder()
                    .setTitle('🔗 Not Linked')
                    .setDescription('You haven\'t connected your account yet. Click below to login!')
                    .setColor('#E67E22');

                const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
                    new ButtonBuilder()
                        .setLabel('Login with Discord')
                        .setStyle(ButtonStyle.Link)
                        .setURL("http://localhost:3000/api/auth/login")
                );

                await interaction.editReply({ embeds: [embed], components: [row] });
            }
        } catch (error) {
            await interaction.editReply("⚠️ Unable to reach the portal. Please try again later.");
        }
    }
}