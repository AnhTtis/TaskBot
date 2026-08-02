import { ChannelType, type Guild, type PublicThreadChannel, type TextChannel } from 'discord.js';
import type { GuildConfig } from '@prisma/client';

import { logger } from '../../lib/logger.js';
import { updateGuildConfig } from '../guild-config/guild-config.repository.js';
import { createTaskThread } from '../threads/thread.service.js';
import { hasTaskTeam } from './task.members.js';
import {
  getManagerRoleIds,
  getReviewerRoleIds,
} from './task.policy.js';
import {
  buildDashboardSummaryComponents,
  buildDashboardSummaryEmbed,
  buildTaskCardComponents,
  buildTaskCardEmbed,
} from './task.renderer.js';
import { sendTaskFeedMessage } from './task.feed.js';
import {
  findTaskByCodeWithMembers,
  listTasksForDashboardSummary,
  listTasksForGuildWithMembers,
  updateTaskWithMembers,
} from './task.repository.js';
import type { TaskWithMembers } from './task.types.js';

type SyncDashboardInput = {
  readonly guild: Guild;
  readonly guildConfig: GuildConfig;
  readonly dashboardChannel: TextChannel;
  readonly refreshedByUserId: string;
  readonly taskCode: string | null;
};

type SyncDashboardResult = {
  readonly summaryRecreated: boolean;
  readonly tasksProcessed: number;
  readonly taskCardsUpdated: number;
  readonly taskCardsRecreated: number;
  readonly threadsRecreated: number;
  readonly threadsReopened: number;
  readonly threadsArchived: number;
  readonly missingThreadsCleared: number;
  readonly warnings: string[];
};

function isPublicThreadChannel(channel: unknown): channel is PublicThreadChannel<boolean> {
  return (
    typeof channel === 'object' &&
    channel !== null &&
    (channel as { type?: number }).type === ChannelType.PublicThread
  );
}

function requiresActiveWorkspace(task: TaskWithMembers): boolean {
  return (
    hasTaskTeam(task) &&
    (task.status === 'IN_PROGRESS' || task.status === 'BLOCKED' || task.status === 'REVIEW')
  );
}

async function syncSummaryMessage(options: {
  readonly guild: Guild;
  readonly guildConfig: GuildConfig;
  readonly dashboardChannel: TextChannel;
  readonly refreshedByUserId: string;
}): Promise<{ recreated: boolean }> {
  const tasks = await listTasksForDashboardSummary(options.guild.id);
  const embed = buildDashboardSummaryEmbed({
    guildName: options.guild.name,
    refreshedByUserId: options.refreshedByUserId,
    managerRoleIds: getManagerRoleIds(options.guildConfig),
    reviewerRoleIds: getReviewerRoleIds(options.guildConfig),
    feedChannelId: options.guildConfig.feedChannelId,
    archiveChannelId: options.guildConfig.archiveChannelId,
    maxActiveTasksPerUser: options.guildConfig.maxActiveTasksPerUser,
    defaultThreadAutoArchiveMinutes: options.guildConfig.defaultThreadAutoArchiveMinutes,
    defaultTimezone: options.guildConfig.defaultTimezone,
    defaultDateInputMode: options.guildConfig.defaultDateInputMode,
    tasks,
  });

  const existingSummaryMessage = options.guildConfig.dashboardSummaryMessageId
    ? await options.dashboardChannel.messages
        .fetch(options.guildConfig.dashboardSummaryMessageId)
        .catch(() => null)
    : null;

  if (existingSummaryMessage) {
    await existingSummaryMessage.edit({
      embeds: [embed],
      components: buildDashboardSummaryComponents(),
    });
    return { recreated: false };
  }

  const createdSummaryMessage = await options.dashboardChannel.send({
    embeds: [embed],
    components: buildDashboardSummaryComponents(),
  });
  await updateGuildConfig(options.guild.id, {
    dashboardSummaryMessageId: createdSummaryMessage.id,
  });

  return { recreated: true };
}

async function syncTaskCardMessage(options: {
  readonly task: TaskWithMembers;
  readonly dashboardChannel: TextChannel;
  readonly timezone: string;
}): Promise<{ task: TaskWithMembers; recreated: boolean }> {
  const existingTaskMessage = options.task.taskMessageId
    ? await options.dashboardChannel.messages.fetch(options.task.taskMessageId).catch(() => null)
    : null;

  if (existingTaskMessage) {
    await existingTaskMessage.edit({
      embeds: [buildTaskCardEmbed(options.task, { timezone: options.timezone })],
      components: buildTaskCardComponents(options.task),
    });

    if (options.task.taskMessageChannelId !== options.dashboardChannel.id) {
      const updatedTask = await updateTaskWithMembers(options.task.id, {
        taskMessageChannelId: options.dashboardChannel.id,
      });
      return { task: updatedTask, recreated: false };
    }

    return {
      task: options.task,
      recreated: false,
    };
  }

  const createdTaskMessage = await options.dashboardChannel.send({
    embeds: [buildTaskCardEmbed(options.task, { timezone: options.timezone })],
    components: buildTaskCardComponents(options.task),
  });

  const updatedTask = await updateTaskWithMembers(options.task.id, {
    taskMessageChannelId: options.dashboardChannel.id,
    taskMessageId: createdTaskMessage.id,
  });

  return {
    task: updatedTask,
    recreated: true,
  };
}

async function syncTaskWorkspace(options: {
  readonly task: TaskWithMembers;
  readonly guild: Guild;
  readonly dashboardChannel: TextChannel;
  readonly autoArchiveMinutes: number;
  readonly timezone: string;
}): Promise<{
  task: TaskWithMembers;
  recreated: boolean;
  reopened: boolean;
  archived: boolean;
  cleared: boolean;
}> {
  const needsActiveWorkspace = requiresActiveWorkspace(options.task);
  let task = options.task;

  if (task.threadChannelId) {
    const existingThread = await options.guild.channels.fetch(task.threadChannelId).catch(() => null);

    if (isPublicThreadChannel(existingThread)) {
      if (needsActiveWorkspace && existingThread.archived) {
        await existingThread.setArchived(false, 'Dashboard sync reopened an active task workspace.');
        return { task, recreated: false, reopened: true, archived: false, cleared: false };
      }

      if (task.status === 'DONE' && !existingThread.archived) {
        await existingThread.setArchived(true, 'Dashboard sync archived a completed task workspace.');
        return { task, recreated: false, reopened: false, archived: true, cleared: false };
      }

      return { task, recreated: false, reopened: false, archived: false, cleared: false };
    }

    if (!needsActiveWorkspace) {
      task = await updateTaskWithMembers(task.id, {
        threadChannelId: null,
      });

      return { task, recreated: false, reopened: false, archived: false, cleared: true };
    }
  }

  if (!needsActiveWorkspace) {
    return { task, recreated: false, reopened: false, archived: false, cleared: false };
  }

  const createdThread = await createTaskThread({
    task,
    dashboardChannel: options.dashboardChannel,
    autoArchiveMinutes: options.autoArchiveMinutes,
    timezone: options.timezone,
  });

  task = await updateTaskWithMembers(task.id, {
    threadChannelId: createdThread.id,
  });

  return { task, recreated: true, reopened: false, archived: false, cleared: false };
}

export async function syncTaskDashboard(
  input: SyncDashboardInput,
): Promise<SyncDashboardResult> {
  const summaryResult = await syncSummaryMessage({
    guild: input.guild,
    guildConfig: input.guildConfig,
    dashboardChannel: input.dashboardChannel,
    refreshedByUserId: input.refreshedByUserId,
  });

  const tasks = input.taskCode
    ? await (async (normalizedTaskCode: string) => {
        const task = await findTaskByCodeWithMembers(input.guild.id, normalizedTaskCode);
        if (!task) {
          throw new Error(`Task ${normalizedTaskCode} could not be found.`);
        }

        return [task];
      })(input.taskCode)
    : await listTasksForGuildWithMembers(input.guild.id);

  const warnings: string[] = [];
  let taskCardsUpdated = 0;
  let taskCardsRecreated = 0;
  let threadsRecreated = 0;
  let threadsReopened = 0;
  let threadsArchived = 0;
  let missingThreadsCleared = 0;

  for (const originalTask of tasks) {
    let task = originalTask;

    try {
      const workspaceResult = await syncTaskWorkspace({
        task,
        guild: input.guild,
        dashboardChannel: input.dashboardChannel,
        autoArchiveMinutes: input.guildConfig.defaultThreadAutoArchiveMinutes,
        timezone: input.guildConfig.defaultTimezone,
      });
      task = workspaceResult.task;

      if (workspaceResult.recreated) {
        threadsRecreated += 1;
      }
      if (workspaceResult.reopened) {
        threadsReopened += 1;
      }
      if (workspaceResult.archived) {
        threadsArchived += 1;
      }
      if (workspaceResult.cleared) {
        missingThreadsCleared += 1;
        warnings.push(`${task.taskCode}: missing workspace reference was cleared.`);
      }
    } catch (error) {
      logger.error('Task workspace sync failed', {
        guildId: input.guild.id,
        taskId: task.id,
        taskCode: task.taskCode,
        error,
      });
      warnings.push(`${task.taskCode}: workspace repair failed.`);
    }

    try {
      const cardResult = await syncTaskCardMessage({
        task,
        dashboardChannel: input.dashboardChannel,
        timezone: input.guildConfig.defaultTimezone,
      });
      task = cardResult.task;
      taskCardsUpdated += 1;
      if (cardResult.recreated) {
        taskCardsRecreated += 1;
      }
    } catch (error) {
      logger.error('Task card sync failed', {
        guildId: input.guild.id,
        taskId: task.id,
        taskCode: task.taskCode,
        error,
      });
      warnings.push(`${task.taskCode}: task card sync failed.`);
      continue;
    }
  }

  const feedLines = [
    `🛠️ Dashboard sync run by <@${input.refreshedByUserId}>.`,
    `Summary recreated: ${summaryResult.recreated ? 'yes' : 'no'}`,
    `Tasks processed: ${taskCardsUpdated}`,
    `Task cards recreated: ${taskCardsRecreated}`,
    `Threads recreated: ${threadsRecreated}`,
    `Threads reopened: ${threadsReopened}`,
    `Threads archived: ${threadsArchived}`,
  ];

  if (missingThreadsCleared > 0) {
    feedLines.push(`Missing thread references cleared: ${missingThreadsCleared}`);
  }

  if (warnings.length > 0) {
    feedLines.push('', `Warnings (${warnings.length}):`, ...warnings.slice(0, 10));
  }

  await sendTaskFeedMessage({
    guild: input.guild,
    content: feedLines.join('\n'),
  });

  return {
    summaryRecreated: summaryResult.recreated,
    tasksProcessed: taskCardsUpdated,
    taskCardsUpdated,
    taskCardsRecreated,
    threadsRecreated,
    threadsReopened,
    threadsArchived,
    missingThreadsCleared,
    warnings,
  };
}
