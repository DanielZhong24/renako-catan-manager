import { Hono } from 'hono';
import { InteractionType, InteractionResponseType, verifyKey } from 'discord-interactions';
import { EmbedBuilder } from 'discord.js';
import { UserService } from '../services/userService.js';

const discordRoutes = new Hono();

discordRoutes.post('/interactions', async (c) => {
  // 1. Security Verification (Mandatory for Discord Webhooks)
  const signature = c.req.header('x-signature-ed25519');
  const timestamp = c.req.header('x-signature-timestamp');
  const body = await c.req.text();

  const isValidRequest = verifyKey(
    body,
    signature!,
    timestamp!,
    process.env.DISCORD_PUBLIC_KEY!
  );

  if (!isValidRequest) {
    return c.text('Invalid request signature', 401);
  }

  const interaction = JSON.parse(body);

  // 2. Handle PING (Discord checking if your server is alive)
  if (interaction.type === InteractionType.PING) {
    return c.json({ type: InteractionResponseType.PONG });
  }

  // 3. Handle Slash Commands
  if (interaction.type === InteractionType.APPLICATION_COMMAND) {
    const { name } = interaction.data;
    const discordId = interaction.member?.user.id || interaction.user.id;

    if (name === 'stats') {
      const stats = await UserService.getStatsByDiscordId(discordId);

      if (!stats) {
        return c.json({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: "❌ You aren't linked yet! Please login here to start tracking: http://localhost:3000/api/auth/login",
            flags: 64 // Ephemeral (only the user sees this)
          }
        });
      }

      // Using discord.js to build a professional looking response
      const embed = new EmbedBuilder()
        .setColor(0x0099FF)
        .setTitle(`Catan Stats for ${interaction.user.username}`)
        .addFields(
          { name: 'Wins', value: `${stats.wins}`, inline: true },
          { name: 'Win Rate', value: `${stats.win_rate}%`, inline: true },
          { name: 'Avg VP', value: `${stats.avg_vp}`, inline: true }
        )
        .setTimestamp();

      return c.json({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          embeds: [embed.toJSON()]
        }
      });
    }
  }

  return c.json({ error: 'Unknown interaction' }, 400);
});

export default discordRoutes;