import {
  ChannelType,
  MessageFlags,
  type Attachment,
  type ChatInputCommandInteraction,
  type Guild,
  type TextChannel,
} from 'discord.js';
import type { GuildConfig, RequiredRole, TaskPriority } from '@prisma/client';

import {
  getDeadlineInputHint,
  parseDeadlineInput,
} from '../../lib/task-datetime.js';
import { logger } from '../../lib/logger.js';
import { findGuildConfigByGuildId } from '../guild-config/guild-config.repository.js';
import { refreshDashboardSummary } from '../guild-config/guild-config.service.js';
import { buildTaskCardComponents, buildTaskCardEmbed } from './task.renderer.js';
import { hasManagementAccess } from './task.policy.js';
import {
  createTask,
  createTaskAttachment,
  createTaskEvent,
  createTaskStatusHistory,
  findLatestTaskForGuild,
  findTaskByCodeWithMembers,
  removeTaskAttachment,
  updateTaskWithMembers,
} from './task.repository.js';
import { syncTaskDashboard } from './task.sync.js';
import type { TaskWithMembers } from './task.types.js';

function isTextChannel(channel: unknown): channel is TextChannel {
  return (
    typeof channel === 'object' &&
    channel !== null &&
    (channel as { type?: number }).type === ChannelType.GuildText
  );
}

function parseNextTaskSequence(taskCode: string | null): number {
  if (!taskCode) {
    return 1;
  }

  const match = /^TASK-(\d+)$/.exec(taskCode);
  const numericPart = match?.[1];

  if (!numericPart) {
    return 1;
  }

  return Number.parseInt(numericPart, 10) + 1;
}

function formatTaskCode(sequence: number): string {
  return `TASK-${sequence.toString().padStart(3, '0')}`;
}

function getRequiredRoleValue(value: string): RequiredRole {
  switch (value) {
    case 'ADMIN':
    case 'TECHNICIAN':
    case 'RESEARCHER':
      return value;
    default:
      throw new Error(`Unsupported required role: ${value}`);
  }
}

function getPriorityValue(value: string | null): TaskPriority | undefined {
  switch (value) {
    case null:
      return undefined;
    case 'LOW':
    case 'MEDIUM':
    case 'HIGH':
    case 'URGENT':
      return value;
    default:
      throw new Error(`Unsupported task priority: ${value}`);
  }
}

function normalizeTaskCodeInput(value: string | null): string | null {
  const trimmed = value?.trim().toUpperCase() ?? null;
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

function normalizeOptionalText(value: string | null): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : null;
}

function getAttachmentUrl(file: Attachment | null, url: string | null): string | null {
  if (file) {
    return file.url;
  }

  return normalizeOptionalText(url);
}

async function getManagerCommandContext(
  interaction: ChatInputCommandInteraction,
  actionDescription: string,
): Promise<{
  guild: Guild;
  guildConfig: GuildConfig;
  dashboardChannel: TextChannel;
} | null> {
  if (!interaction.inGuild()) {
    await interaction.reply({
      content: `The ${actionDescription} command can only be used inside a server.`,
      flags: MessageFlags.Ephemeral,
    });
    return null;
  }

  const guild = interaction.guild;
  if (!guild) {
    await interaction.reply({
      content: 'Guild context is unavailable for this command.',
      flags: MessageFlags.Ephemeral,
    });
    return null;
  }

  const guildConfig = await findGuildConfigByGuildId(interaction.guildId);
  if (!guildConfig) {
    await interaction.reply({
      content: 'TaskBot is not configured yet. Run /setup first.',
      flags: MessageFlags.Ephemeral,
    });
    return null;
  }

  if (!hasManagementAccess({
    member: interaction.member,
    memberPermissions: interaction.memberPermissions,
    adminRoleId: guildConfig.adminRoleId,
    secondaryManagerRoleId: guildConfig.secondaryManagerRoleId,
  })) {
    await interaction.reply({
      content: `Only server managers or configured manager roles can ${actionDescription}.`,
      flags: MessageFlags.Ephemeral,
    });
    return null;
  }

  const dashboardChannel = await guild.channels.fetch(guildConfig.dashboardChannelId);
  if (!isTextChannel(dashboardChannel)) {
    await interaction.reply({
      content: 'The configured dashboard channel is unavailable or is not a text channel.',
      flags: MessageFlags.Ephemeral,
    });
    return null;
  }

  return {
    guild,
    guildConfig,
    dashboardChannel,
  };
}

async function refreshTaskPresentation(options: {
  readonly guild: Guild;
  readonly guildConfig: GuildConfig;
  readonly dashboardChannel: TextChannel;
  readonly refreshedByUserId: string;
  readonly task: TaskWithMembers;
}): Promise<void> {
  if (options.task.taskMessageId) {
    const taskMessage = await options.dashboardChannel.messages
      .fetch(options.task.taskMessageId)
      .catch(() => null);

    if (taskMessage) {
      await taskMessage.edit({
        embeds: [buildTaskCardEmbed(options.task, { timezone: options.guildConfig.defaultTimezone })],
        components: buildTaskCardComponents(options.task),
      });
    }
  }

  await refreshDashboardSummary({
    guildId: options.guild.id,
    guildName: options.guild.name,
    refreshedByUserId: options.refreshedByUserId,
    dashboardChannel: options.dashboardChannel,
    guildConfig: options.guildConfig,
  });
}

async function resolveTaskForManagerCommand(options: {
  readonly interaction: ChatInputCommandInteraction;
  readonly guildId: string;
  readonly taskCodeInput: string | null;
}): Promise<{ taskCode: string; task: TaskWithMembers } | null> {
  const taskCode = normalizeTaskCodeInput(options.taskCodeInput);
  if (!taskCode) {
    await options.interaction.editReply({
      content: 'Task code is required.',
    });
    return null;
  }

  const task = await findTaskByCodeWithMembers(options.guildId, taskCode);
  if (!task) {
    await options.interaction.editReply({
      content: `Could not find ${taskCode}.`,
    });
    return null;
  }

  return { taskCode, task };
}

export async function handleTaskCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const subcommand = interaction.options.getSubcommand();

  switch (subcommand) {
    case 'create':
      await handleTaskCreateCommand(interaction);
      return;
    case 'update-meta':
      await handleTaskUpdateMetaCommand(interaction);
      return;
    case 'set-deadline':
      await handleTaskSetDeadlineCommand(interaction);
      return;
    case 'clear-deadline':
      await handleTaskClearDeadlineCommand(interaction);
      return;
    case 'add-attachment':
      await handleTaskAddAttachmentCommand(interaction);
      return;
    case 'remove-attachment':
      await handleTaskRemoveAttachmentCommand(interaction);
      return;
    case 'sync-dashboard':
      await handleTaskSyncDashboardCommand(interaction);
      return;
    default:
      await interaction.reply({
        content: `Unsupported task subcommand: ${subcommand}`,
        flags: MessageFlags.Ephemeral,
      });
  }
}

async function handleTaskCreateCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const context = await getManagerCommandContext(interaction, '/task create');
  if (!context) {
    return;
  }

  const { guild, guildConfig, dashboardChannel } = context;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const latestTask = await findLatestTaskForGuild(guild.id);
  const taskCode = formatTaskCode(parseNextTaskSequence(latestTask?.taskCode ?? null));
  const priority = getPriorityValue(interaction.options.getString('priority', false));
  const deadlineInput = interaction.options.getString('deadline', false);
  const deadlineAt = deadlineInput
    ? parseDeadlineInput(deadlineInput, {
        timezone: guildConfig.defaultTimezone,
        inputMode: guildConfig.defaultDateInputMode,
      })
    : null;
  const targetMemberCount = interaction.options.getInteger('team_size', false) ?? 1;

  if (deadlineInput && !deadlineAt) {
    await interaction.editReply({
      content: `Invalid deadline. ${getDeadlineInputHint(guildConfig.defaultDateInputMode)}`,
    });
    return;
  }

  const task = await createTask({
    guildId: guild.id,
    taskCode,
    title: interaction.options.getString('title', true),
    description: interaction.options.getString('description', true),
    requiredRole: getRequiredRoleValue(interaction.options.getString('required_role', true)),
    ...(priority ? { priority } : {}),
    createdByDiscordUserId: interaction.user.id,
    deadlineAt,
    targetMemberCount,
  });

  await createTaskStatusHistory({
    taskId: task.id,
    actorDiscordUserId: interaction.user.id,
    toStatus: task.status,
    reason: 'Task created',
  });

  const taskCardMessage = await dashboardChannel.send({
    embeds: [buildTaskCardEmbed(task, { timezone: guildConfig.defaultTimezone })],
    components: buildTaskCardComponents(task),
  });

  const persistedTask = await updateTaskWithMembers(task.id, {
    taskMessageChannelId: dashboardChannel.id,
    taskMessageId: taskCardMessage.id,
  });

  await refreshDashboardSummary({
    guildId: guild.id,
    guildName: guild.name,
    refreshedByUserId: interaction.user.id,
    dashboardChannel,
    guildConfig,
  });

  logger.info('Task created', {
    guildId: guild.id,
    taskId: persistedTask.id,
    taskCode: persistedTask.taskCode,
    dashboardChannelId: dashboardChannel.id,
    taskMessageId: taskCardMessage.id,
  });

  await interaction.editReply({
    content: [
      `Created **${persistedTask.taskCode}** in <#${dashboardChannel.id}>.`,
      `Title: ${persistedTask.title}`,
      `Role: ${persistedTask.requiredRole}`,
      `Priority: ${persistedTask.priority}`,
      `Team size: ${persistedTask.targetMemberCount}`,
      `Status: ${persistedTask.status}`,
    ].join('\n'),
  });
}

async function handleTaskUpdateMetaCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const context = await getManagerCommandContext(interaction, 'update task metadata');
  if (!context) {
    return;
  }

  const { guild, guildConfig, dashboardChannel } = context;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const resolvedTask = await resolveTaskForManagerCommand({
    interaction,
    guildId: guild.id,
    taskCodeInput: interaction.options.getString('task_code', true),
  });
  if (!resolvedTask) {
    return;
  }

  const title = normalizeOptionalText(interaction.options.getString('title', false));
  const description = normalizeOptionalText(interaction.options.getString('description', false));
  const requiredRoleRaw = interaction.options.getString('required_role', false);
  const teamSize = interaction.options.getInteger('team_size', false);
  const priority = getPriorityValue(interaction.options.getString('priority', false));

  if (!title && !description && !requiredRoleRaw && teamSize === null && !priority) {
    await interaction.editReply({
      content: 'Provide at least one field to update.',
    });
    return;
  }

  if (teamSize !== null && teamSize < resolvedTask.task.members.length) {
    await interaction.editReply({
      content: `Team size cannot be smaller than the current member count (${resolvedTask.task.members.length}).`,
    });
    return;
  }

  const updatedTask = await updateTaskWithMembers(resolvedTask.task.id, {
    ...(title ? { title } : {}),
    ...(description ? { description } : {}),
    ...(requiredRoleRaw ? { requiredRole: getRequiredRoleValue(requiredRoleRaw) } : {}),
    ...(priority ? { priority } : {}),
    ...(teamSize !== null ? { targetMemberCount: teamSize } : {}),
  });

  await createTaskEvent({
    taskId: updatedTask.id,
    actorDiscordUserId: interaction.user.id,
    type: 'TASK_UPDATED',
    summary: 'Manager updated task metadata.',
    details: [
      title ? `Title: ${title}` : null,
      description ? 'Description updated.' : null,
      requiredRoleRaw ? `Role: ${requiredRoleRaw}` : null,
      priority ? `Priority: ${priority}` : null,
      teamSize !== null ? `Team size: ${teamSize}` : null,
    ].filter(Boolean).join(' | '),
  });

  await refreshTaskPresentation({
    guild,
    guildConfig,
    dashboardChannel,
    refreshedByUserId: interaction.user.id,
    task: updatedTask,
  });

  await interaction.editReply({
    content: `Updated **${updatedTask.taskCode}** metadata successfully.`,
  });
}

async function handleTaskSetDeadlineCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const context = await getManagerCommandContext(interaction, 'set task deadlines');
  if (!context) {
    return;
  }

  const { guild, guildConfig, dashboardChannel } = context;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const resolvedTask = await resolveTaskForManagerCommand({
    interaction,
    guildId: guild.id,
    taskCodeInput: interaction.options.getString('task_code', true),
  });
  if (!resolvedTask) {
    return;
  }

  const deadlineInput = interaction.options.getString('deadline', true);
  const deadlineAt = parseDeadlineInput(deadlineInput, {
    timezone: guildConfig.defaultTimezone,
    inputMode: guildConfig.defaultDateInputMode,
  });

  if (!deadlineAt) {
    await interaction.editReply({
      content: `Invalid deadline. ${getDeadlineInputHint(guildConfig.defaultDateInputMode)}`,
    });
    return;
  }

  const updatedTask = await updateTaskWithMembers(resolvedTask.task.id, {
    deadlineAt,
  });

  await createTaskEvent({
    taskId: updatedTask.id,
    actorDiscordUserId: interaction.user.id,
    type: 'DEADLINE_SET',
    summary: 'Manager set or updated the task deadline.',
    details: deadlineInput,
  });

  await refreshTaskPresentation({
    guild,
    guildConfig,
    dashboardChannel,
    refreshedByUserId: interaction.user.id,
    task: updatedTask,
  });

  await interaction.editReply({
    content: `Updated the deadline for **${updatedTask.taskCode}**.`,
  });
}

async function handleTaskClearDeadlineCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const context = await getManagerCommandContext(interaction, 'clear task deadlines');
  if (!context) {
    return;
  }

  const { guild, guildConfig, dashboardChannel } = context;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const resolvedTask = await resolveTaskForManagerCommand({
    interaction,
    guildId: guild.id,
    taskCodeInput: interaction.options.getString('task_code', true),
  });
  if (!resolvedTask) {
    return;
  }

  if (!resolvedTask.task.deadlineAt) {
    await interaction.editReply({
      content: `**${resolvedTask.taskCode}** does not have a deadline set.`,
    });
    return;
  }

  const updatedTask = await updateTaskWithMembers(resolvedTask.task.id, {
    deadlineAt: null,
  });

  await createTaskEvent({
    taskId: updatedTask.id,
    actorDiscordUserId: interaction.user.id,
    type: 'DEADLINE_CLEARED',
    summary: 'Manager cleared the task deadline.',
  });

  await refreshTaskPresentation({
    guild,
    guildConfig,
    dashboardChannel,
    refreshedByUserId: interaction.user.id,
    task: updatedTask,
  });

  await interaction.editReply({
    content: `Cleared the deadline for **${updatedTask.taskCode}**.`,
  });
}

async function handleTaskAddAttachmentCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const context = await getManagerCommandContext(interaction, 'add task attachments');
  if (!context) {
    return;
  }

  const { guild, guildConfig, dashboardChannel } = context;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const resolvedTask = await resolveTaskForManagerCommand({
    interaction,
    guildId: guild.id,
    taskCodeInput: interaction.options.getString('task_code', true),
  });
  if (!resolvedTask) {
    return;
  }

  const file = interaction.options.getAttachment('file', false);
  const urlInput = interaction.options.getString('url', false);
  const label = normalizeOptionalText(interaction.options.getString('label', false));
  const url = getAttachmentUrl(file, urlInput);

  if (!url) {
    await interaction.editReply({
      content: 'Provide either a file attachment or a URL.',
    });
    return;
  }

  if (file && urlInput) {
    await interaction.editReply({
      content: 'Use either a file attachment or a URL, not both in the same command.',
    });
    return;
  }

  const attachment = await createTaskAttachment({
    taskId: resolvedTask.task.id,
    label,
    url,
    fileName: file?.name ?? null,
    contentType: file?.contentType ?? null,
    sizeBytes: file?.size ?? null,
    addedByDiscordUserId: interaction.user.id,
  });

  const updatedTask = await findTaskByCodeWithMembers(guild.id, resolvedTask.taskCode);
  if (!updatedTask) {
    await interaction.editReply({
      content: `The attachment was saved, but ${resolvedTask.taskCode} could not be reloaded.`,
    });
    return;
  }

  await createTaskEvent({
    taskId: updatedTask.id,
    actorDiscordUserId: interaction.user.id,
    type: 'ATTACHMENT_ADDED',
    summary: 'Manager added a task attachment.',
    details: `${attachment.id} • ${attachment.label ?? attachment.fileName ?? attachment.url}`,
  });

  await refreshTaskPresentation({
    guild,
    guildConfig,
    dashboardChannel,
    refreshedByUserId: interaction.user.id,
    task: updatedTask,
  });

  await interaction.editReply({
    content: `Added attachment #${attachment.id} to **${updatedTask.taskCode}**.`,
  });
}

async function handleTaskRemoveAttachmentCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const context = await getManagerCommandContext(interaction, 'remove task attachments');
  if (!context) {
    return;
  }

  const { guild, guildConfig, dashboardChannel } = context;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const resolvedTask = await resolveTaskForManagerCommand({
    interaction,
    guildId: guild.id,
    taskCodeInput: interaction.options.getString('task_code', true),
  });
  if (!resolvedTask) {
    return;
  }

  const attachmentId = interaction.options.getInteger('attachment_id', true);
  const removedAttachment = await removeTaskAttachment({
    attachmentId,
    taskId: resolvedTask.task.id,
  });

  if (!removedAttachment) {
    await interaction.editReply({
      content: `Could not find attachment #${attachmentId} on **${resolvedTask.taskCode}**.`,
    });
    return;
  }

  const updatedTask = await findTaskByCodeWithMembers(guild.id, resolvedTask.taskCode);
  if (!updatedTask) {
    await interaction.editReply({
      content: `Removed attachment #${attachmentId}, but ${resolvedTask.taskCode} could not be reloaded.`,
    });
    return;
  }

  await createTaskEvent({
    taskId: updatedTask.id,
    actorDiscordUserId: interaction.user.id,
    type: 'ATTACHMENT_REMOVED',
    summary: 'Manager removed a task attachment.',
    details: `${removedAttachment.id} • ${removedAttachment.label ?? removedAttachment.fileName ?? removedAttachment.url}`,
  });

  await refreshTaskPresentation({
    guild,
    guildConfig,
    dashboardChannel,
    refreshedByUserId: interaction.user.id,
    task: updatedTask,
  });

  await interaction.editReply({
    content: `Removed attachment #${removedAttachment.id} from **${updatedTask.taskCode}**.`,
  });
}

async function handleTaskSyncDashboardCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const context = await getManagerCommandContext(interaction, 'repair the dashboard');
  if (!context) {
    return;
  }

  const { guild, guildConfig, dashboardChannel } = context;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const result = await syncTaskDashboard({
      guild,
      guildConfig,
      dashboardChannel,
      refreshedByUserId: interaction.user.id,
      taskCode: normalizeTaskCodeInput(interaction.options.getString('task_code', false)),
    });

    const lines = [
      `Dashboard sync completed for **${guild.name}**.`,
      `Summary recreated: ${result.summaryRecreated ? 'Yes' : 'No'}`,
      `Tasks processed: ${result.tasksProcessed}`,
      `Task cards recreated: ${result.taskCardsRecreated}`,
      `Threads recreated: ${result.threadsRecreated}`,
      `Threads reopened: ${result.threadsReopened}`,
      `Threads archived: ${result.threadsArchived}`,
    ];

    if (result.missingThreadsCleared > 0) {
      lines.push(`Missing thread references cleared: ${result.missingThreadsCleared}`);
    }

    if (result.warnings.length > 0) {
      lines.push('', 'Warnings:', ...result.warnings.map((warning) => `- ${warning}`));
    }

    await interaction.editReply({
      content: lines.join('\n'),
    });
  } catch (error) {
    logger.error('Task dashboard sync failed', error);
    await interaction.editReply({
      content: 'Task dashboard sync failed. Check the bot logs for details.',
    });
  }
}
