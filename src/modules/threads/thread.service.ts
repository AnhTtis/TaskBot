import {
  ChannelType,
  ThreadAutoArchiveDuration,
  type Guild,
  type PublicThreadChannel,
  type TextChannel,
} from 'discord.js';
import type { Task } from '@prisma/client';

import { formatDeadlineForDisplay } from '../../lib/task-datetime.js';
import { formatTaskTeamSummary } from '../tasks/task.members.js';
import type { TaskWithMembers } from '../tasks/task.types.js';

type ThreadTask = Task | TaskWithMembers;

function formatThreadStatus(status: Task['status']): string {
  switch (status) {
    case 'BACKLOG':
      return 'Backlog';
    case 'IN_PROGRESS':
      return 'In Progress';
    case 'BLOCKED':
      return 'Blocked';
    case 'REVIEW':
      return 'Review';
    case 'DONE':
      return 'Done';
  }
}

function buildThreadName(task: ThreadTask): string {
  const normalizedTitle = task.title.replace(/\s+/g, ' ').trim() || 'Task';
  return `${task.taskCode} — ${normalizedTitle}`.slice(0, 100);
}

function toThreadAutoArchiveDuration(value: number): ThreadAutoArchiveDuration {
  switch (value) {
    case 60:
      return ThreadAutoArchiveDuration.OneHour;
    case 4320:
      return ThreadAutoArchiveDuration.ThreeDays;
    case 10080:
      return ThreadAutoArchiveDuration.OneWeek;
    case 1440:
    default:
      return ThreadAutoArchiveDuration.OneDay;
  }
}

export async function createTaskThread(options: {
  readonly task: ThreadTask;
  readonly dashboardChannel: TextChannel;
  readonly autoArchiveMinutes: number;
  readonly timezone?: string;
}): Promise<PublicThreadChannel<boolean>> {
  if (!options.task.taskMessageId) {
    throw new Error(`Task ${options.task.id} is missing taskMessageId; cannot create thread.`);
  }

  const taskMessage = await options.dashboardChannel.messages.fetch(options.task.taskMessageId);

  const thread = await taskMessage.startThread({
    name: buildThreadName(options.task),
    autoArchiveDuration: toThreadAutoArchiveDuration(options.autoArchiveMinutes),
    reason: `Workspace for ${options.task.taskCode}`,
  });

  if (thread.type !== ChannelType.PublicThread) {
    throw new Error(`Expected a public thread for task ${options.task.id}.`);
  }

  await thread.send({
    content: [
      `# ${options.task.taskCode} — ${options.task.title}`,
      `Team: ${formatTaskTeamSummary(options.task)}`,
      `Status: ${formatThreadStatus(options.task.status)}`,
      `Priority: ${options.task.priority}`,
      `Deadline: ${formatDeadlineForDisplay(options.task.deadlineAt ?? null, options.timezone ?? 'Asia/Ho_Chi_Minh')}`,
      '',
      options.task.description,
    ].join('\n'),
  });

  return thread;
}

async function fetchPublicThread(
  guild: Guild,
  threadChannelId: string,
): Promise<PublicThreadChannel<boolean> | null> {
  const channel = await guild.channels.fetch(threadChannelId).catch(() => null);

  if (!channel || channel.type !== ChannelType.PublicThread) {
    return null;
  }

  return channel;
}

export async function reopenTaskThread(
  guild: Guild,
  threadChannelId: string,
): Promise<PublicThreadChannel<boolean> | null> {
  const thread = await fetchPublicThread(guild, threadChannelId);
  if (!thread) {
    return null;
  }

  if (thread.archived) {
    await thread.setArchived(false, 'Task reopened or resumed.');
  }

  return thread;
}

export async function archiveTaskThread(
  guild: Guild,
  threadChannelId: string,
): Promise<PublicThreadChannel<boolean> | null> {
  const thread = await fetchPublicThread(guild, threadChannelId);
  if (!thread) {
    return null;
  }

  if (!thread.archived) {
    await thread.setArchived(true, 'Task completed.');
  }

  return thread;
}
