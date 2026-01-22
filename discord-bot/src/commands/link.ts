// bot/src/commands/link.ts
import { 
    SlashCommandBuilder, 
    ChatInputCommandInteraction, 
    EmbedBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle 
} from 'discord.js';
import { IBotCommand } from '../core/types.js';
import { BotContext } from '../core/BotContext.js';

export class LinkCommand implements IBotCommand {
    data = new SlashCommandBuilder()
        .setName('link')
        .setDescription('Connect your Colonist extension via the web portal');

    async execute(interaction: ChatInputCommandInteraction, { pool }: BotContext): Promise<void> {
        await interaction.deferReply({ ephemeral: true });

        const result = await pool.query('SELECT * FROM users WHERE discord_id = $1', [interaction.user.id]);
        const user = result.rows[0];

        const embed = new EmbedBuilder().setColor('#3498DB');
        const row = new ActionRowBuilder<ButtonBuilder>();

        if (!user) {
            embed.setTitle('👋 Welcome to CatanStats!')
                .setDescription('Please log in via our web portal to get started.');
            
            row.addComponents(
                new ButtonBuilder()
                    .setLabel('Login & Setup')
                    .setStyle(ButtonStyle.Link)
                    .setURL(`http://localhost:3000/api/auth/login`)
            );
        } else {
            embed.setTitle('✅ Account Recognized')
                .setDescription('You are already registered. If your extension isn\'t tracking, visit the portal to resync.');

            row.addComponents(
                new ButtonBuilder()
                    .setLabel('Go to Portal')
                    .setStyle(ButtonStyle.Link)
                    .setURL(`http://localhost:3000/api/auth/login`)
            );
        }

        await interaction.editReply({ embeds: [embed], components: [row] });
    }
}