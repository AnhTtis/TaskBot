import type { GuildConfig } from '@prisma/client';
import type { Guild, TextChannel } from 'discord.js';

import { refreshDashboardSummary } from '../guild-config/guild-config.service.js';
import { syncTaskCardMessage } from './task.sync.js';
import type { TaskWithMembers } from './task.types.js';

export async function refreshTaskPresentation(options: {
  readonly guild: Guild;
  readonly guildConfig: GuildConfig;
  readonly dashboardChannel: TextChannel;
  readonly refreshedByUserId: string;
  readonly task: TaskWithMembers;
}): Promise<TaskWithMembers> {
  const syncedTask = await syncTaskCardMessage({
    task: options.task,
    guild: options.guild,
    guildConfig: options.guildConfig,
  });

  await refreshDashboardSummary({
    guildId: options.guild.id,
    guildName: options.guild.name,
    refreshedByUserId: options.refreshedByUserId,
    dashboardChannel: options.dashboardChannel,
    guildConfig: options.guildConfig,
  });

  return syncedTask.task;
}
