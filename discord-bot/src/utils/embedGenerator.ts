import { EmbedBuilder } from 'discord.js';
import type { MatchTitles } from '../core/types.js'; // Ensure this path matches your project structure

export const createMatchSummaryEmbed = (summary: MatchTitles) => {
    // Determine color based on Luck Index (Yellow for high luck, Blue for average/low)
    const embedColor = summary.luckIndex > 15 ? 0xf1c40f : 0x3498db;

    return new EmbedBuilder()
        .setTitle(`🎲 Catan Match Recorded: ${summary.winnerName} Wins!`)
        .setColor(embedColor)
        .setDescription(`A total of **${summary.totalRolls}** rolls were made this game.`)
        .addFields(
            { 
                name: '🏆 Podium', 
                value: `**${summary.winnerName}** secured the win with **${summary.winnerVp}** Victory Points!`,
                inline: false 
            },
            { 
                name: '🥷 The Thief', 
                value: `**${summary.theThief}**\n*Stole the most resources via the robber.*`, 
                inline: true 
            },
            { 
                name: '🚫 The Embargo', 
                value: `**${summary.theEmbargoed}**\n*Proposed the most trades that were rejected.*`, 
                inline: true 
            },
            { 
                name: '🐢 The Turtle', 
                value: `**${summary.theTurtle}**\n*Stockpiled the most Development Cards.*`, 
                inline: true 
            },
            { 
                name: '💀 The Villain', 
                value: `**${summary.theVillain}**\n*Lost the most resources to being blocked/robbed.*`, 
                inline: true 
            },
            { 
                name: '🎲 Luck Index', 
                value: `**${summary.luckIndex}%**\n*(Percentage of 6s and 8s rolled)*`, 
                inline: true 
            }
        )
        .setFooter({ 
            text: 'Catan Cartel Analytics • Data processed via ThinkPad T42', 
            iconURL: 'https://i.imgur.com/89S0C3z.png' // Optional: Replace with your own bot icon
        })
        .setTimestamp();
};

export const createRenakoGeneralErrorEmbed = () => {
    return new EmbedBuilder()
        .setTitle('Amaori Renako')
        .setDescription(
            "H-hey! You're going too fast, and the servers are getting dizzy...\n" +
            'Please slow down and try again a little later. (｡•́︿•̀｡)'
        )
        .setColor('#FF8FB1')
        .setFooter({ text: 'Cooldown in effect • Renako is regaining her composure' })
        .setTimestamp();
};