import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { IBotCommand } from '../core/types.js';
import { BotContext } from '../core/BotContext.js';

export class HelpCommand implements IBotCommand {
	data = new SlashCommandBuilder()
		.setName('help')
		.setDescription('Show available bot commands and abbreviations');
	aliases = ['hp'];

	async execute(interaction: ChatInputCommandInteraction, { commands }: BotContext): Promise<void> {
		await interaction.deferReply({ ephemeral: true });

		// Build a mapping from command instance -> names (to collect aliases)
		const map = new Map<any, string[]>();
		for (const [name, cmd] of commands) {
			if (!map.has(cmd)) map.set(cmd, []);
			map.get(cmd)!.push(name);
		}

		const lines: string[] = [];
		for (const [cmd, names] of map) {
			const json = cmd.data.toJSON();
			const nameList = names.sort().join(', ');
			const desc = json.description || '';
			lines.push(`**${nameList}** — ${desc}`);
		}

		const embed = new EmbedBuilder()
			.setTitle('📚 Available Commands')
			.setDescription(lines.join('\n'))
			.setColor('#FFB6C1')
			.setTimestamp();

		await interaction.editReply({ embeds: [embed] });
	}
}
