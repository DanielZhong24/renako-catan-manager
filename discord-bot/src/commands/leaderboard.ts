import {
	SlashCommandBuilder,
	ChatInputCommandInteraction,
	EmbedBuilder,
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	ComponentType
} from 'discord.js';
import { IBotCommand } from '../core/types.js';
import { BotContext } from '../core/BotContext.js';

type LeaderboardEntry = {
	discord_id: string;
	username: string;
	avatar_url: string | null;
	total_games: number;
	wins: number;
	avg_vp: number;
	win_rate: number;
	bayes_win_rate: number;
	rating: number;
	server_rank: number;
};

export class LeaderboardCommand implements IBotCommand {
	data = new SlashCommandBuilder()
		.setName('leaderboard')
		.setDescription('View the server leaderboard (ranking is smarter than it looks)');

	async execute(interaction: ChatInputCommandInteraction, { api }: BotContext): Promise<void> {
		if (!interaction.deferred && !interaction.replied) {
			try {
				await interaction.deferReply();
			} catch {
				try {
					await interaction.reply('Working on it...');
				} catch {
					return;
				}
			}
		}

		if (!interaction.guildId) {
			await interaction.editReply('This command only works inside a server. (DMs don\'t count as a server, sorry!)');
			return;
		}

		try {
			const leaderboard = await api.getLeaderboard(interaction.guildId, 10) as LeaderboardEntry[] | null;

			if (!leaderboard || leaderboard.length === 0) {
				const emptyEmbed = new EmbedBuilder()
					.setTitle('📉 No leaderboard yet!')
					.setDescription(
						"I-I couldn\'t find any tracked games for this server...\n\n" +
						"Try playing a few games with the extension running, then come back!"
					)
					.setColor('#FFB6C1')
					.setFooter({ text: 'Renako is waiting with her clipboard...' })
					.setTimestamp();

				await interaction.editReply({ embeds: [emptyEmbed] });
				return;
			}

			const requester = leaderboard.find((entry) => entry.discord_id === interaction.user.id);
			const requesterRankText = requester ? `Your rank: #${requester.server_rank}` : 'Your rank: outside top 10';

			const pageSize = 3;
			const totalPages = Math.ceil(leaderboard.length / pageSize);
			let currentPage = 0;

			const buildEmbed = (pageIndex: number) => {
				const start = pageIndex * pageSize;
				const pageEntries = leaderboard.slice(start, start + pageSize);
				const leaderboardLines = pageEntries.map((entry, index) => {
					const globalIndex = start + index;
					const podiumEmoji = globalIndex === 0 ? '🥇' : globalIndex === 1 ? '🥈' : globalIndex === 2 ? '🥉' : '';
					const medalPrefix = podiumEmoji ? `${podiumEmoji} ` : '';
					const mention = `<@${entry.discord_id}>`;
					return (
						`${medalPrefix}#${entry.server_rank} ${mention} — ` +
						`${entry.wins}W | ` +
						`${entry.win_rate}% | ` +
						`${entry.avg_vp} VP | ` +
						`${entry.total_games} games`
					);
				}).join('\n');

				return new EmbedBuilder()
					.setTitle(`Server Leaderboard (Page ${pageIndex + 1}/${totalPages})`)
					.setDescription(leaderboardLines)
					.setColor('#FFB6C1')
					.setFooter({ text: requesterRankText, iconURL: interaction.user.displayAvatarURL() })
					.setTimestamp();
			};

			const prevButton = new ButtonBuilder()
				.setCustomId('leaderboard_prev')
				.setLabel('◀')
				.setStyle(ButtonStyle.Secondary)
				.setDisabled(true);

			const nextButton = new ButtonBuilder()
				.setCustomId('leaderboard_next')
				.setLabel('▶')
				.setStyle(ButtonStyle.Secondary)
				.setDisabled(totalPages <= 1);

			const row = new ActionRowBuilder<ButtonBuilder>().addComponents(prevButton, nextButton);

			const message = await interaction.editReply({
				embeds: [buildEmbed(currentPage)],
				components: totalPages > 1 ? [row] : []
			});

			if (totalPages > 1) {
				const collector = message.createMessageComponentCollector({
					componentType: ComponentType.Button,
					time: 60_000
				});

				collector.on('collect', async (buttonInteraction) => {
					if (buttonInteraction.user.id !== interaction.user.id) {
						await buttonInteraction.deferUpdate();
						return;
					}

					if (buttonInteraction.customId === 'leaderboard_prev') {
						currentPage = Math.max(0, currentPage - 1);
					} else if (buttonInteraction.customId === 'leaderboard_next') {
						currentPage = Math.min(totalPages - 1, currentPage + 1);
					}

					prevButton.setDisabled(currentPage === 0);
					nextButton.setDisabled(currentPage === totalPages - 1);
					const updatedRow = new ActionRowBuilder<ButtonBuilder>().addComponents(prevButton, nextButton);

					await buttonInteraction.update({
						embeds: [buildEmbed(currentPage)],
						components: [updatedRow]
					});
				});

				collector.on('end', async () => {
					await interaction.editReply({ components: [] });
				});
			}
		} catch (error) {
			const panicEmbed = new EmbedBuilder()
				.setTitle('💥 Leaderboard meltdown!')
				.setDescription(
					"I-I tried to call the server, but it didn\'t answer...\n\n" +
					"Maybe the API is asleep? Or I\'m just too nervous to ask?"
				)
				.setColor('#FF69B4')
				.setFooter({ text: 'Renako is rebooting her confidence...' })
				.setTimestamp();
            console.log(error);

			await interaction.editReply({ embeds: [panicEmbed] });
		}
	}
}
