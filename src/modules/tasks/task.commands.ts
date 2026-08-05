import type {
  Attachment,
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  Guild,
  TextChannel,
} from 'discord.js';
import { MessageFlags } from 'discord.js';

import { findGuildConfigByGuildId } from '../guild-config/guild-config.repository.js';
import { deleteTrackedPrivatePanel, editTrackedPrivateReply } from './task.interactions.js';
import { refreshTaskPresentation } from './task.refresh.js';
import {
  formatAttachmentLabel,
  formatTaskDisplayLabel,
  formatTaskPublicLabel,
  isGuildTextChannel,
  normalizeOptionalText,
  parseTaskReferenceInput,
} from './task.helpers.js';
import { hasManagementAccess } from './task.policy.js';
import { sendTaskFeedMessage } from './task.feed.js';
import {
  createTaskAttachment,
  createTaskEvent,
  findTaskByCodeWithMembers,
  findTaskByIdWithMembers,
  findTaskByNumberWithMembers,
  listTasksForGuildWithMembers,
} from './task.repository.js';
import { buildTaskPanelPayload } from './task.ui.js';

function truncateChoiceLabel(value: string, maxLength = 100): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}

function getAttachmentUrl(file: Attachment | null, url: string | null): string | null {
  if (file) {
    return file.url;
  }

  return normalizeOptionalText(url);
}

async function getManagerCommandContext(
  interaction: ChatInputCommandInteraction,
): Promise<{
  guild: Guild;
  guildConfig: NonNullable<Awaited<ReturnType<typeof findGuildConfigByGuildId>>>;
  dashboardChannel: TextChannel;
} | null> {
  if (!interaction.inGuild() || !interaction.guild) {
    await interaction.reply({
      content: 'This command can only be used inside a server.',
      flags: MessageFlags.Ephemeral,
    });
    return null;
  }

  const guildConfig = await findGuildConfigByGuildId(interaction.guild.id);
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
      content: 'Only configured manager roles can manage task attachments.',
      flags: MessageFlags.Ephemeral,
    });
    return null;
  }

  const dashboardChannel = interaction.guild.channels.cache.get(guildConfig.dashboardChannelId)
    ?? await interaction.guild.channels.fetch(guildConfig.dashboardChannelId).catch(() => null);
  if (!isGuildTextChannel(dashboardChannel)) {
    await interaction.reply({
      content: 'The configured dashboard channel is unavailable or is not a text channel.',
      flags: MessageFlags.Ephemeral,
    });
    return null;
  }

  return {
    guild: interaction.guild,
    guildConfig,
    dashboardChannel,
  };
}

export async function handleTaskAutocompleteInteraction(
  interaction: AutocompleteInteraction,
): Promise<void> {
  if (!interaction.inGuild()) {
    await interaction.respond([]);
    return;
  }

  const focusedOption = interaction.options.getFocused(true);
  if (focusedOption.name !== 'task_code') {
    await interaction.respond([]);
    return;
  }

  const query = String(focusedOption.value ?? '').trim().toLowerCase();
  const tasks = await listTasksForGuildWithMembers(interaction.guildId);
  const suggestions = tasks
    .filter((task) => {
      const publicLabel = formatTaskPublicLabel(task.taskNumber).toLowerCase();
      const paddedNumber = task.taskNumber.toString().padStart(4, '0');
      return query.length === 0
        || publicLabel.includes(query)
        || paddedNumber.includes(query)
        || String(task.taskNumber).includes(query)
        || task.taskCode.toLowerCase().includes(query)
        || task.title.toLowerCase().includes(query);
    })
    .slice(-25)
    .reverse()
    .map((task) => ({
      name: truncateChoiceLabel(formatTaskDisplayLabel(task)),
      value: formatTaskDisplayLabel(task),
    }));

  await interaction.respond(suggestions);
}

export async function handleTaskCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const subcommand = interaction.options.getSubcommand();
  if (subcommand !== 'add-attachment') {
    await interaction.reply({
      content: `Unsupported task subcommand: ${subcommand}`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const context = await getManagerCommandContext(interaction);
  if (!context) {
    return;
  }

  const { guild, guildConfig, dashboardChannel } = context;
  await deleteTrackedPrivatePanel(interaction);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const taskReferenceInput = interaction.options.getString('task_code', true);
  const parsedReference = parseTaskReferenceInput(taskReferenceInput);
  const task = parsedReference.taskNumber
    ? await findTaskByNumberWithMembers(guild.id, parsedReference.taskNumber)
    : parsedReference.legacyTaskCode
      ? await findTaskByCodeWithMembers(guild.id, parsedReference.legacyTaskCode)
      : null;

  if (!task) {
    await interaction.editReply({ content: `Could not find task reference: ${taskReferenceInput}.` });
    return;
  }

  const file = interaction.options.getAttachment('file', false);
  const urlInput = interaction.options.getString('url', false);
  const label = normalizeOptionalText(interaction.options.getString('label', false));
  const url = getAttachmentUrl(file, urlInput);

  if (!url) {
    await interaction.editReply({ content: 'Provide either a file upload or a URL.' });
    return;
  }

  if (file && urlInput) {
    await interaction.editReply({ content: 'Use either a file upload or a URL, not both in the same command.' });
    return;
  }

  const attachment = await createTaskAttachment({
    taskId: task.id,
    label,
    url,
    fileName: file?.name ?? null,
    contentType: file?.contentType ?? null,
    sizeBytes: file?.size ?? null,
    addedByDiscordUserId: interaction.user.id,
  });

  const updatedTask = await findTaskByIdWithMembers(task.id);
  if (!updatedTask) {
    await interaction.editReply({ content: `The attachment was saved, but ${formatTaskPublicLabel(task.taskNumber)} could not be reloaded.` });
    return;
  }

  await createTaskEvent({
    taskId: updatedTask.id,
    actorDiscordUserId: interaction.user.id,
    type: 'ATTACHMENT_ADDED',
    summary: 'Manager added a task attachment.',
    details: `${attachment.id} • ${formatAttachmentLabel(attachment)}`,
  });

  await refreshTaskPresentation({
    guild,
    guildConfig,
    dashboardChannel,
    refreshedByUserId: interaction.user.id,
    task: updatedTask,
  });

  await sendTaskFeedMessage({
    guild,
    content: [
      `📎 Attachment added by <@${interaction.user.id}>.`,
      `Task: **${formatTaskPublicLabel(updatedTask.taskNumber)}**`,
      `Item: ${formatAttachmentLabel(attachment)}`,
    ].join('\n'),
  });

  const payload = buildTaskPanelPayload({
    task: updatedTask,
    guildConfig,
    access: {
      manager: true,
      reviewer: false,
      canClaim: false,
      canManageProgress: true,
      isTaskMember: false,
    },
    mode: 'attachments',
    notice: `Added **${formatAttachmentLabel(attachment)}** to **${formatTaskPublicLabel(updatedTask.taskNumber)}**.`,
  });

  await editTrackedPrivateReply(interaction, {
    content: null,
    ...payload,
  });
}
