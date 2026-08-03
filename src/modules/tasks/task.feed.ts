import type { Guild } from 'discord.js';

import { logger } from '../../lib/logger.js';
import { findGuildConfigByGuildId } from '../guild-config/guild-config.repository.js';
import { isGuildTextChannel } from './task.helpers.js';

export async function sendTaskFeedMessage(options: {
  readonly guild: Guild;
  readonly content: string;
}): Promise<boolean> {
  const guildConfig = await findGuildConfigByGuildId(options.guild.id);
  if (!guildConfig) {
    return false;
  }

  const feedChannel = await options.guild.channels.fetch(guildConfig.feedChannelId).catch((error) => {
    logger.warn('Task feed channel fetch failed', {
      guildId: options.guild.id,
      feedChannelId: guildConfig.feedChannelId,
      error,
    });
    return null;
  });

  if (!isGuildTextChannel(feedChannel)) {
    logger.warn('Configured task feed channel is unavailable or not a text channel.', {
      guildId: options.guild.id,
      feedChannelId: guildConfig.feedChannelId,
    });
    return false;
  }

  await feedChannel.send({ content: options.content }).catch((error) => {
    logger.warn('Task feed message send failed', {
      guildId: options.guild.id,
      feedChannelId: feedChannel.id,
      error,
    });
    return null;
  });

  return true;
}
