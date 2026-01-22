import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import { BotContext } from './BotContext.js';

export interface IBotCommand {
    data: SlashCommandBuilder | Omit<SlashCommandBuilder, "addSubcommand" | "addSubcommandGroup">;
    execute(interaction: ChatInputCommandInteraction, context: BotContext): Promise<void>;
}