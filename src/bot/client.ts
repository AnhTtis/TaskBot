import { Client, Events, GatewayIntentBits, Partials } from 'discord.js';

import { logger } from '../lib/logger.js';

export function createDiscordClient(): Client {
  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
    partials: [Partials.Channel],
  });

  client.once(Events.ClientReady, (readyClient) => {
    logger.info(`Logged in as ${readyClient.user.tag}`);
  });

  client.on(Events.Warn, (message) => {
    logger.warn(message);
  });

  return client;
}
