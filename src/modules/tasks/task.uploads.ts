import type { Guild, Message, TextChannel } from 'discord.js';
import type { GuildConfig } from '@prisma/client';

import { logger } from '../../lib/logger.js';
import { findGuildConfigByGuildId } from '../guild-config/guild-config.repository.js';
import {
  formatAttachmentLabel,
  isGuildTextChannel,
  normalizeOptionalText,
} from './task.helpers.js';
import { refreshTaskPresentation } from './task.refresh.js';
import {
  createTaskAttachment,
  createTaskEvent,
  findTaskByIdWithMembers,
} from './task.repository.js';

const PENDING_UPLOAD_TTL_MS = 10 * 60 * 1000;

type PendingFileUpload = {
  readonly guildId: string;
  readonly userId: string;
  readonly taskId: number;
  readonly allowedChannelIds: readonly string[];
  readonly expiresAt: number;
};

const pendingFileUploads = new Map<string, PendingFileUpload>();

function buildPendingUploadKey(guildId: string, userId: string): string {
  return `${guildId}:${userId}`;
}

async function resolveDashboardChannel(guild: Guild, guildConfig: GuildConfig): Promise<TextChannel | null> {
  const dashboardChannel = guild.channels.cache.get(guildConfig.dashboardChannelId)
    ?? await guild.channels.fetch(guildConfig.dashboardChannelId).catch(() => null);

  return isGuildTextChannel(dashboardChannel) ? dashboardChannel : null;
}

export function armTaskFileUpload(options: {
  readonly guildId: string;
  readonly userId: string;
  readonly taskId: number;
  readonly allowedChannelIds: readonly string[];
}): { expiresAt: number } {
  const expiresAt = Date.now() + PENDING_UPLOAD_TTL_MS;
  pendingFileUploads.set(buildPendingUploadKey(options.guildId, options.userId), {
    guildId: options.guildId,
    userId: options.userId,
    taskId: options.taskId,
    allowedChannelIds: [...options.allowedChannelIds],
    expiresAt,
  });

  return { expiresAt };
}

export function clearTaskFileUpload(guildId: string, userId: string): void {
  pendingFileUploads.delete(buildPendingUploadKey(guildId, userId));
}

export async function handlePendingTaskFileUpload(message: Message): Promise<void> {
  if (message.author.bot || !message.inGuild() || message.attachments.size === 0) {
    return;
  }

  const pendingUpload = pendingFileUploads.get(buildPendingUploadKey(message.guildId, message.author.id));
  if (!pendingUpload) {
    return;
  }

  if (pendingUpload.expiresAt <= Date.now()) {
    clearTaskFileUpload(message.guildId, message.author.id);
    return;
  }

  if (!pendingUpload.allowedChannelIds.includes(message.channelId)) {
    return;
  }

  const guildConfig = await findGuildConfigByGuildId(message.guildId);
  if (!guildConfig) {
    clearTaskFileUpload(message.guildId, message.author.id);
    await message.reply('TaskBot is not configured yet. Run /setup first.');
    return;
  }

  const task = await findTaskByIdWithMembers(pendingUpload.taskId);
  if (!task || task.guildId !== message.guildId) {
    clearTaskFileUpload(message.guildId, message.author.id);
    await message.reply('That task could not be found anymore, so the upload was not saved.');
    return;
  }

  const dashboardChannel = await resolveDashboardChannel(message.guild, guildConfig);
  if (!dashboardChannel) {
    clearTaskFileUpload(message.guildId, message.author.id);
    await message.reply('The configured dashboard channel is unavailable, so the upload was not saved.');
    return;
  }

  const label = normalizeOptionalText(message.content);
  const savedLabels: string[] = [];

  for (const attachment of message.attachments.values()) {
    const savedAttachment = await createTaskAttachment({
      taskId: task.id,
      label,
      url: attachment.url,
      fileName: attachment.name ?? null,
      contentType: attachment.contentType ?? null,
      sizeBytes: attachment.size ?? null,
      addedByDiscordUserId: message.author.id,
    });

    savedLabels.push(`#${savedAttachment.id} ${formatAttachmentLabel(savedAttachment)}`);
  }

  const updatedTask = await findTaskByIdWithMembers(task.id);
  if (!updatedTask) {
    clearTaskFileUpload(message.guildId, message.author.id);
    await message.reply(`The file upload was saved, but ${task.taskCode} could not be reloaded.`);
    return;
  }

  await createTaskEvent({
    taskId: updatedTask.id,
    actorDiscordUserId: message.author.id,
    type: 'ATTACHMENT_ADDED',
    summary: 'Manager added task file attachments.',
    details: savedLabels.join(' | '),
  });

  try {
    await refreshTaskPresentation({
      guild: message.guild,
      guildConfig,
      dashboardChannel,
      refreshedByUserId: message.author.id,
      task: updatedTask,
    });
  } catch (error) {
    logger.error('Task attachment upload refresh failed', {
      guildId: message.guildId,
      taskId: updatedTask.id,
      error,
    });
  }

  clearTaskFileUpload(message.guildId, message.author.id);
  await message.reply(
    `Saved ${message.attachments.size} file attachment${message.attachments.size === 1 ? '' : 's'} to **${updatedTask.taskCode}**.`,
  );
}
