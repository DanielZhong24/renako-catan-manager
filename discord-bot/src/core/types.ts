import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import { BotContext } from './BotContext.js';

export interface IBotCommand {
    data: SlashCommandBuilder | Omit<SlashCommandBuilder, "addSubcommand" | "addSubcommandGroup">;
    aliases?: string[];
    execute(interaction: ChatInputCommandInteraction, context: BotContext): Promise<void>;
}
export interface MatchTitles {
    winnerName: string;
    winnerVp: number;
    theThief: string;     // Most resources stolen
    theEmbargoed: string; // Most rejected trades
    theTurtle: string;    // Most dev cards bought
    theVillain: string;   // Most income blocked (robber)
    luckIndex: number;    // % of 6s and 8s
    totalRolls: number;
}