import {
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
  type TextChannel,
} from 'discord.js';

import type { GuildConfig } from '@prisma/client';

import { logger } from '../../lib/logger.js';
import { listTasksForDashboardSummary } from '../tasks/task.repository.js';
import { buildDashboardSummaryEmbed } from '../tasks/task.renderer.js';
import {
  findGuildConfigByGuildId,
  upsertGuildConfig,
} from './guild-config.repository.js';

function isGuildTextChannel(channel: unknown): channel is TextChannel {
  return (
    typeof channel === 'object' &&
    channel !== null &&
    (channel as { type?: number }).type === ChannelType.GuildText
  );
}

export async function refreshDashboardSummary(options: {
  readonly guildId: string;
  readonly guildName: string;
  readonly refreshedByUserId: string;
  readonly dashboardChannel: TextChannel;
  readonly guildConfig?: GuildConfig;
}): Promise<void> {
  const guildConfig = options.guildConfig ?? await findGuildConfigByGuildId(options.guildId);

  if (!guildConfig?.dashboardSummaryMessageId) {
    return;
  }

  const summaryMessage = options.dashboardChannel.messages.cache.get(guildConfig.dashboardSummaryMessageId)
    ?? await options.dashboardChannel.messages
      .fetch(guildConfig.dashboardSummaryMessageId)
      .catch(() => null);

  if (!summaryMessage) {
    logger.warn('Dashboard summary refresh skipped because the summary message is unavailable.', {
      guildId: options.guildId,
      summaryMessageId: guildConfig.dashboardSummaryMessageId,
    });
    return;
  }

  const tasks = await listTasksForDashboardSummary(options.guildId);
  const embed = buildDashboardSummaryEmbed({
    guildName: options.guildName,
    refreshedByUserId: options.refreshedByUserId,
    adminRoleId: guildConfig.adminRoleId,
    reviewerRoleId: guildConfig.reviewerRoleId,
    feedChannelId: guildConfig.feedChannelId,
    archiveChannelId: guildConfig.archiveChannelId,
    maxActiveTasksPerUser: guildConfig.maxActiveTasksPerUser,
    defaultThreadAutoArchiveMinutes: guildConfig.defaultThreadAutoArchiveMinutes,
    tasks,
  });

  await summaryMessage.edit({ embeds: [embed] });
}

export async function handleSetupCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (!interaction.inGuild()) {
    await interaction.reply({
      content: 'The /setup command can only be used inside a server.',
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

  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    await interaction.reply({
      content: 'You need the Manage Server permission to run /setup.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const dashboardChannel = interaction.options.getChannel('dashboard_channel', true);
  const feedChannel = interaction.options.getChannel('feed_channel', true);
  const archiveChannel = interaction.options.getChannel('archive_channel', false);
  const adminRole = interaction.options.getRole('admin_role', true);
  const reviewerRole = interaction.options.getRole('reviewer_role', false);
  const maxActiveTasks = interaction.options.getInteger('max_active_tasks', false) ?? 2;
  const defaultThreadAutoArchiveMinutes =
    interaction.options.getInteger('thread_auto_archive_minutes', false) ?? 1440;

  if (!isGuildTextChannel(dashboardChannel) || !isGuildTextChannel(feedChannel)) {
    await interaction.reply({
      content: 'Dashboard and feed channels must both be standard text channels.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (archiveChannel && !isGuildTextChannel(archiveChannel)) {
    await interaction.reply({
      content: 'Archive channel must be a standard text channel when provided.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const tasks = await listTasksForDashboardSummary(interaction.guildId);
  const existingConfig = await findGuildConfigByGuildId(interaction.guildId);
  const embed = buildDashboardSummaryEmbed({
    guildName: guild.name,
    refreshedByUserId: interaction.user.id,
    adminRoleId: adminRole.id,
    reviewerRoleId: reviewerRole?.id ?? null,
    feedChannelId: feedChannel.id,
    archiveChannelId: archiveChannel?.id ?? null,
    maxActiveTasksPerUser: maxActiveTasks,
    defaultThreadAutoArchiveMinutes,
    tasks,
  });

  let summaryMessageId: string | null = null;
  let reusedExistingSummary = false;

  if (
    existingConfig?.dashboardChannelId === dashboardChannel.id &&
    existingConfig.dashboardSummaryMessageId
  ) {
    const existingMessage = await dashboardChannel.messages
      .fetch(existingConfig.dashboardSummaryMessageId)
      .catch(() => null);

    if (existingMessage) {
      await existingMessage.edit({ embeds: [embed] });
      summaryMessageId = existingMessage.id;
      reusedExistingSummary = true;
    }
  }

  if (!summaryMessageId) {
    const newSummaryMessage = await dashboardChannel.send({ embeds: [embed] });
    summaryMessageId = newSummaryMessage.id;
  }

  await upsertGuildConfig(interaction.guildId, {
    dashboardChannelId: dashboardChannel.id,
    dashboardSummaryMessageId: summaryMessageId,
    feedChannelId: feedChannel.id,
    archiveChannelId: archiveChannel?.id ?? null,
    adminRoleId: adminRole.id,
    reviewerRoleId: reviewerRole?.id ?? null,
    maxActiveTasksPerUser: maxActiveTasks,
    defaultThreadAutoArchiveMinutes,
  });

  logger.info('Guild setup completed', {
    guildId: interaction.guildId,
    dashboardChannelId: dashboardChannel.id,
    feedChannelId: feedChannel.id,
    archiveChannelId: archiveChannel?.id ?? null,
    summaryMessageId,
    reusedExistingSummary,
  });

  await interaction.editReply({
    content: [
      `Setup complete for **${guild.name}**.`,
      `Dashboard summary: <#${dashboardChannel.id}>`,
      `Feed channel: <#${feedChannel.id}>`,
      `Archive channel: ${archiveChannel ? `<#${archiveChannel.id}>` : 'Not set'}`,
      `Admin role: <@&${adminRole.id}>`,
      `Reviewer role: ${reviewerRole ? `<@&${reviewerRole.id}>` : 'Not set'}`,
      reusedExistingSummary
        ? 'The existing dashboard summary message was updated.'
        : 'A new dashboard summary message was created.',
    ].join('\n'),
  });
}
