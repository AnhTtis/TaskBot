import {
  ChannelType,
  MessageFlags,
  type ChatInputCommandInteraction,
  type TextChannel,
} from 'discord.js';
import type { RequiredRole, TaskPriority } from '@prisma/client';

import { logger } from '../../lib/logger.js';
import { findGuildConfigByGuildId } from '../guild-config/guild-config.repository.js';
import { refreshDashboardSummary } from '../guild-config/guild-config.service.js';
import {
  buildTaskCardComponents,
  buildTaskCardEmbed,
} from './task.renderer.js';
import { hasManagementAccess } from './task.policy.js';
import {
  createTask,
  createTaskStatusHistory,
  findLatestTaskForGuild,
  updateTaskWithMembers,
} from './task.repository.js';
import { syncTaskDashboard } from './task.sync.js';

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

export async function handleTaskCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const subcommand = interaction.options.getSubcommand();

  switch (subcommand) {
    case 'create':
      await handleTaskCreateCommand(interaction);
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
  if (!interaction.inGuild()) {
    await interaction.reply({
      content: 'The /task create command can only be used inside a server.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const guild = interaction.guild;
  if (!guild) {
    await interaction.reply({
      content: 'Guild context is unavailable for this command.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const guildConfig = await findGuildConfigByGuildId(interaction.guildId);
  if (!guildConfig) {
    await interaction.reply({
      content: 'TaskBot is not configured yet. Run /setup first.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (!hasManagementAccess({
      member: interaction.member,
      memberPermissions: interaction.memberPermissions,
      adminRoleId: guildConfig.adminRoleId,
    })) {
    await interaction.reply({
      content: 'Only server managers, the configured admin role, or Technician can create tasks.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const dashboardChannel = await guild.channels.fetch(guildConfig.dashboardChannelId);
  if (!isTextChannel(dashboardChannel)) {
    await interaction.reply({
      content: 'The configured dashboard channel is unavailable or is not a text channel.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const latestTask = await findLatestTaskForGuild(interaction.guildId);
  const taskCode = formatTaskCode(parseNextTaskSequence(latestTask?.taskCode ?? null));
  const priority = getPriorityValue(interaction.options.getString('priority', false));
  const deadlineInput = interaction.options.getString('deadline', false);
  const deadlineAt = deadlineInput ? new Date(deadlineInput) : null;
  const targetMemberCount = interaction.options.getInteger('team_size', false) ?? 1;

  if (deadlineInput && Number.isNaN(deadlineAt?.getTime())) {
    await interaction.editReply({
      content: 'Deadline must be a valid ISO-8601 date string, for example 2026-07-31T18:00:00+07:00.',
    });
    return;
  }

  const task = await createTask({
    guildId: interaction.guildId,
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
    embeds: [buildTaskCardEmbed(task)],
    components: buildTaskCardComponents(task),
  });

  const persistedTask = await updateTaskWithMembers(task.id, {
    taskMessageChannelId: dashboardChannel.id,
    taskMessageId: taskCardMessage.id,
  });

  await refreshDashboardSummary({
    guildId: interaction.guildId,
    guildName: guild.name,
    refreshedByUserId: interaction.user.id,
    dashboardChannel,
    guildConfig,
  });

  logger.info('Task created', {
    guildId: interaction.guildId,
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

async function handleTaskSyncDashboardCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (!interaction.inGuild()) {
    await interaction.reply({
      content: 'The /task sync-dashboard command can only be used inside a server.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const guild = interaction.guild;
  if (!guild) {
    await interaction.reply({
      content: 'Guild context is unavailable for this command.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const guildConfig = await findGuildConfigByGuildId(interaction.guildId);
  if (!guildConfig) {
    await interaction.reply({
      content: 'TaskBot is not configured yet. Run /setup first.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (!hasManagementAccess({
      member: interaction.member,
      memberPermissions: interaction.memberPermissions,
      adminRoleId: guildConfig.adminRoleId,
    })) {
    await interaction.reply({
      content: 'Only server managers, the configured admin role, or Technician can repair the dashboard.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const dashboardChannel = await guild.channels.fetch(guildConfig.dashboardChannelId);
  if (!isTextChannel(dashboardChannel)) {
    await interaction.reply({
      content: 'The configured dashboard channel is unavailable or is not a text channel.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

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
      lines.push('', `Warnings (${result.warnings.length}):`, ...result.warnings.slice(0, 10));
    }

    await interaction.editReply({
      content: lines.join('\n'),
    });
  } catch (error) {
    logger.error('Task dashboard sync failed', {
      guildId: interaction.guildId,
      error,
    });

    const message = error instanceof Error ? error.message : 'Dashboard sync failed unexpectedly.';
    await interaction.editReply({
      content: message,
    });
  }
}
