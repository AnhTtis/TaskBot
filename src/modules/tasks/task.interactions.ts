import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type ModalSubmitInteraction,
  type RepliableInteraction,
  type TextChannel,
} from 'discord.js';

import { getDeadlineInputHint, parseDeadlineInput } from '../../lib/task-datetime.js';
import { logger } from '../../lib/logger.js';
import { findGuildConfigByGuildId } from '../guild-config/guild-config.repository.js';
import { refreshDashboardSummary } from '../guild-config/guild-config.service.js';
import {
  archiveTaskThread,
  createTaskThread,
  reopenTaskThread,
} from '../threads/thread.service.js';
import {
  formatTaskTeamMentions,
  hasTaskMember,
  hasTaskTeam,
  taskNeedsMoreMembers,
} from './task.members.js';
import { sendTaskFeedMessage } from './task.feed.js';
import {
  canClaimRequiredRole,
  canManageTaskProgress,
  canReviewTask,
  getManagerRoleIds,
  getReviewerRoleIds,
  hasManagementAccess,
  isAdminOverride,
} from './task.policy.js';
import { buildTaskCardComponents, buildTaskCardEmbed } from './task.renderer.js';
import {
  addTaskMember,
  claimTask,
  clearTaskMembers,
  countActiveTasksForAssignee,
  createTask,
  createTaskAttachment,
  createTaskEvent,
  createTaskStatusHistory,
  findLatestTaskForGuild,
  findTaskByIdWithMembers,
  listTasksByStatus,
  listTasksForGuildWithMembers,
  removeTaskAttachment,
  transitionTaskWithMembers,
  updateTaskWithMembers,
} from './task.repository.js';
import { syncTaskDashboard } from './task.sync.js';

type TaskInteraction = ButtonInteraction | ModalSubmitInteraction;
type ResolvedTask = NonNullable<Awaited<ReturnType<typeof findTaskByIdWithMembers>>>;

function isTextChannel(channel: unknown): channel is TextChannel {
  return (
    typeof channel === 'object' &&
    channel !== null &&
    (channel as { type?: number }).type === ChannelType.GuildText
  );
}

function formatRoleMentions(roleIds: readonly string[], fallback: string): string {
  return roleIds.length > 0
    ? roleIds.map((roleId) => `<@&${roleId}>`).join(', ')
    : fallback;
}

function normalizeOptionalText(value: string | null): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : null;
}

function parseNextTaskSequence(taskCode: string | null): number {
  if (!taskCode) {
    return 1;
  }

  const match = /^TASK-(\d+)$/.exec(taskCode);
  return match?.[1] ? Number.parseInt(match[1], 10) + 1 : 1;
}

function formatTaskCode(sequence: number): string {
  return `TASK-${sequence.toString().padStart(3, '0')}`;
}

function parseRequiredRoleInput(value: string): 'ADMIN' | 'TECHNICIAN' | 'RESEARCHER' | null {
  switch (value.trim().toUpperCase()) {
    case 'ADMIN':
      return 'ADMIN';
    case 'TECHNICIAN':
      return 'TECHNICIAN';
    case 'RESEARCHER':
      return 'RESEARCHER';
    default:
      return null;
  }
}

function parsePriorityInput(value: string): 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT' | null {
  switch (value.trim().toUpperCase()) {
    case 'LOW':
      return 'LOW';
    case 'MEDIUM':
      return 'MEDIUM';
    case 'HIGH':
      return 'HIGH';
    case 'URGENT':
      return 'URGENT';
    default:
      return null;
  }
}

function parsePositiveIntegerInput(value: string): number | null {
  const parsed = Number.parseInt(value.trim(), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseAttachmentIdInput(value: string): number | null {
  const match = /^#?(\d+)$/.exec(value.trim());
  if (!match) {
    return null;
  }

  const parsed = Number.parseInt(match[1]!, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function formatAttachmentLabel(options: {
  readonly id: number;
  readonly fileName?: string | null;
  readonly label?: string | null;
  readonly url: string;
}): string {
  const fileName = options.fileName?.trim();
  const label = options.label?.trim();
  if (fileName && label) {
    return `${fileName} — ${label}`;
  }

  return fileName || label || options.url || `Attachment #${options.id}`;
}

async function sendInteractionMessage(
  interaction: RepliableInteraction,
  content: string,
): Promise<void> {
  if (interaction.deferred) {
    await interaction.editReply({ content });
    return;
  }

  if (interaction.replied) {
    await interaction.followUp({
      content,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.reply({
    content,
    flags: MessageFlags.Ephemeral,
  });
}

async function deferEphemeral(interaction: RepliableInteraction): Promise<void> {
  if (interaction.deferred || interaction.replied) {
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
}

async function editTaskCard(options: {
  readonly task: ResolvedTask;
  readonly dashboardChannel: TextChannel;
  readonly timezone: string;
}): Promise<void> {
  if (!options.task.taskMessageId) {
    return;
  }

  const taskCardMessage = await options.dashboardChannel.messages
    .fetch(options.task.taskMessageId)
    .catch(() => null);

  if (!taskCardMessage) {
    return;
  }

  await taskCardMessage.edit({
    embeds: [buildTaskCardEmbed(options.task, { timezone: options.timezone })],
    components: buildTaskCardComponents(options.task),
  });
}

async function resolveTaskContext(interaction: TaskInteraction, taskId: number): Promise<{
  guild: NonNullable<TaskInteraction['guild']>;
  guildConfig: NonNullable<Awaited<ReturnType<typeof findGuildConfigByGuildId>>>;
  task: ResolvedTask;
  dashboardChannel: TextChannel;
} | null> {
  if (!interaction.inGuild()) {
    await sendInteractionMessage(interaction, 'Task actions are only available inside a server.');
    return null;
  }

  if (!Number.isInteger(taskId) || taskId <= 0) {
    await sendInteractionMessage(interaction, 'This task action is invalid.');
    return null;
  }

  const guild = interaction.guild;
  if (!guild) {
    await sendInteractionMessage(interaction, 'Guild context is unavailable for this interaction.');
    return null;
  }

  const guildConfig = await findGuildConfigByGuildId(guild.id);
  if (!guildConfig) {
    await sendInteractionMessage(interaction, 'TaskBot is not configured yet. Run /setup first.');
    return null;
  }

  const task = await findTaskByIdWithMembers(taskId);
  if (!task || task.guildId !== guild.id) {
    await sendInteractionMessage(interaction, 'That task could not be found.');
    return null;
  }

  const dashboardChannel = guild.channels.cache.get(guildConfig.dashboardChannelId)
    ?? await guild.channels.fetch(guildConfig.dashboardChannelId).catch(() => null);
  if (!isTextChannel(dashboardChannel)) {
    await sendInteractionMessage(
      interaction,
      'The configured dashboard channel is unavailable or is not a text channel.',
    );
    return null;
  }

  return {
    guild,
    guildConfig,
    task,
    dashboardChannel,
  };
}

async function finalizeTaskInteraction(options: {
  readonly interaction: RepliableInteraction;
  readonly guildId: string;
  readonly guildName: string;
  readonly refreshedByUserId: string;
  readonly dashboardChannel: TextChannel;
  readonly guildConfig: NonNullable<Awaited<ReturnType<typeof findGuildConfigByGuildId>>>;
  readonly task: ResolvedTask;
}): Promise<void> {
  await editTaskCard({
    task: options.task,
    dashboardChannel: options.dashboardChannel,
    timezone: options.guildConfig.defaultTimezone,
  });

  await refreshDashboardSummary({
    guildId: options.guildId,
    guildName: options.guildName,
    refreshedByUserId: options.refreshedByUserId,
    dashboardChannel: options.dashboardChannel,
    guildConfig: options.guildConfig,
  });
}

async function showTaskPanelReply(options: {
  readonly interaction: RepliableInteraction;
  readonly taskId: number;
  readonly mode?: TaskPanelMode;
  readonly notice?: string;
}): Promise<void> {
  const context = await resolveTaskContext(options.interaction as TaskInteraction, options.taskId);
  if (!context) {
    return;
  }

  const payload = buildTaskPanelPayload({
    task: context.task,
    guildConfig: context.guildConfig,
    interaction: options.interaction as TaskInteraction,
    mode: options.mode ?? 'overview',
  });

  await options.interaction.editReply({
    content: options.notice ?? null,
    ...payload,
  });
}

function buildBlockModal(taskId: number): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(`task:block-modal:${taskId}`)
    .setTitle('Block task')
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('reason')
          .setLabel('Why is this task blocked?')
          .setStyle(TextInputStyle.Paragraph)
          .setMinLength(5)
          .setMaxLength(1000)
          .setRequired(true),
      ),
    );
}

export async function handleTaskButtonInteraction(
  interaction: ButtonInteraction,
): Promise<void> {
  const [namespace, action, taskIdPart] = interaction.customId.split(':');

  if (namespace === 'dashboard') {
    await handleDashboardButtonInteraction(interaction, action);
    return;
  }

  if (namespace !== 'task' || !action || !taskIdPart) {
    await interaction.reply({
      content: `Unsupported task action: ${interaction.customId}`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const taskId = Number.parseInt(taskIdPart, 10);

  switch (action) {
    case 'claim':
      await handleClaimTaskInteraction(interaction, taskId);
      return;
    case 'join':
      await handleJoinTaskInteraction(interaction, taskId);
      return;
    case 'actions':
      await handleTaskActionsPanelInteraction(interaction, taskId);
      return;
    case 'edit-hub':
      await handleTaskEditHubInteraction(interaction, taskId);
      return;
    case 'attachments':
      await handleTaskAttachmentsPanelInteraction(interaction, taskId);
      return;
    case 'add-file':
      await handleTaskAddFileGuideInteraction(interaction, taskId);
      return;
    case 'back-actions':
      await handleTaskActionsPanelInteraction(interaction, taskId);
      return;
    case 'back-edit':
      await handleTaskEditHubInteraction(interaction, taskId);
      return;
    case 'back-attachments':
      await handleTaskAttachmentsPanelInteraction(interaction, taskId);
      return;
    case 'block':
      await handleBlockTaskPrompt(interaction, taskId);
      return;
    case 'unblock':
      await handleUnblockTaskInteraction(interaction, taskId);
      return;
    case 'review':
      await handleRequestReviewInteraction(interaction, taskId);
      return;
    case 'approve':
      await handleApproveTaskInteraction(interaction, taskId);
      return;
    case 'return':
      await handleReturnTaskInteraction(interaction, taskId);
      return;
    case 'reopen':
      await handleReopenTaskInteraction(interaction, taskId);
      return;
    case 'edit':
      await handleEditTaskPrompt(interaction, taskId);
      return;
    case 'set-deadline':
      await handleSetDeadlinePrompt(interaction, taskId);
      return;
    case 'clear-deadline':
      await handleClearDeadlineInteraction(interaction, taskId);
      return;
    case 'add-link':
      await handleAddLinkPrompt(interaction, taskId);
      return;
    case 'remove-attachment':
      await handleRemoveAttachmentPrompt(interaction, taskId);
      return;
    case 'repair':
      await handleRepairTaskInteraction(interaction, taskId);
      return;
    default:
      await interaction.reply({
        content: `Task action ${action} is not implemented yet.`,
        flags: MessageFlags.Ephemeral,
      });
    }
}

export async function handleTaskModalSubmitInteraction(
  interaction: ModalSubmitInteraction,
): Promise<void> {
  const [namespace, action, taskIdPart] = interaction.customId.split(':');

  if (namespace !== 'task' || !action) {
    await interaction.reply({
      content: `Unsupported task modal: ${interaction.customId}`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  switch (action) {
    case 'block-modal':
      if (!taskIdPart) {
        break;
      }
      await handleBlockTaskSubmit(interaction, Number.parseInt(taskIdPart, 10));
      return;
    case 'create-modal':
      await handleCreateTaskModalSubmit(interaction);
      return;
    case 'edit-modal':
      if (!taskIdPart) {
        break;
      }
      await handleEditTaskModalSubmit(interaction, Number.parseInt(taskIdPart, 10));
      return;
    case 'deadline-modal':
      if (!taskIdPart) {
        break;
      }
      await handleSetDeadlineModalSubmit(interaction, Number.parseInt(taskIdPart, 10));
      return;
    case 'add-link-modal':
      if (!taskIdPart) {
        break;
      }
      await handleAddLinkModalSubmit(interaction, Number.parseInt(taskIdPart, 10));
      return;
    case 'remove-attachment-modal':
      if (!taskIdPart) {
        break;
      }
      await handleRemoveAttachmentModalSubmit(interaction, Number.parseInt(taskIdPart, 10));
      return;
  }

  await interaction.reply({
    content: `Unsupported task modal: ${interaction.customId}`,
    flags: MessageFlags.Ephemeral,
  });
}

async function handleClaimTaskInteraction(
  interaction: ButtonInteraction,
  taskId: number,
): Promise<void> {
  await deferEphemeral(interaction);

  const context = await resolveTaskContext(interaction, taskId);
  if (!context) {
    return;
  }

  const { guild, guildConfig, task, dashboardChannel } = context;

  if (task.status !== 'BACKLOG' || task.assigneeDiscordUserId || hasTaskTeam(task)) {
    await interaction.editReply({
      content: 'This task is no longer available to claim.',
    });
    return;
  }

  const adminOverride = isAdminOverride({
    member: interaction.member,
    memberPermissions: interaction.memberPermissions,
    adminRoleId: guildConfig.adminRoleId,
    secondaryManagerRoleId: guildConfig.secondaryManagerRoleId,
  });
  const allowedToClaim = canClaimRequiredRole({
    requiredRole: task.requiredRole,
    member: interaction.member,
    memberPermissions: interaction.memberPermissions,
    adminRoleId: guildConfig.adminRoleId,
    secondaryManagerRoleId: guildConfig.secondaryManagerRoleId,
  });

  if (!allowedToClaim) {
    await interaction.editReply({
      content: `You do not have the required role to claim ${task.taskCode}.`,
    });
    return;
  }

  const activeTaskCount = await countActiveTasksForAssignee(guild.id, interaction.user.id);
  if (!adminOverride && activeTaskCount >= guildConfig.maxActiveTasksPerUser) {
    await interaction.editReply({
      content: `You already have ${activeTaskCount} active tasks, which meets the configured limit of ${guildConfig.maxActiveTasksPerUser}.`,
    });
    return;
  }

  const claimedTask = await claimTask(task.id, interaction.user.id);
  if (!claimedTask) {
    await interaction.editReply({
      content: 'This task was claimed by someone else before your request completed.',
    });
    return;
  }

  await createTaskStatusHistory({
    taskId: claimedTask.id,
    actorDiscordUserId: interaction.user.id,
    fromStatus: task.status,
    toStatus: claimedTask.status,
    reason: 'Task claimed',
  });

  let updatedTask = claimedTask;
  let threadChannelId = updatedTask.threadChannelId;
  let threadCreationFailed = false;

  try {
    if (updatedTask.threadChannelId) {
      const reopenedThread = await reopenTaskThread(guild, updatedTask.threadChannelId);
      threadChannelId = reopenedThread?.id ?? updatedTask.threadChannelId;
    } else {
      const createdThread = await createTaskThread({
        task: updatedTask,
        dashboardChannel,
        autoArchiveMinutes: guildConfig.defaultThreadAutoArchiveMinutes,
        timezone: guildConfig.defaultTimezone,
      });
      threadChannelId = createdThread.id;
    }

    if (threadChannelId && threadChannelId !== updatedTask.threadChannelId) {
      updatedTask = await updateTaskWithMembers(updatedTask.id, {
        threadChannelId,
      });
    }
  } catch (error) {
    threadCreationFailed = true;
    logger.error('Task thread creation failed after claim', {
      guildId: guild.id,
      taskId: claimedTask.id,
      error,
    });
    await sendTaskFeedMessage({
      guild,
      content: [
        `⚠️ Workspace repair needed for **${claimedTask.taskCode}**.`,
        `Team: ${formatTaskTeamMentions(claimedTask)}`,
        'The task is in progress, but the workspace thread could not be created automatically.',
        'Use the Manager Console / Repair Dashboard button after fixing the channel/thread permissions.',
      ].join('\n'),
    });
  }

  await finalizeTaskInteraction({
    interaction,
    guildId: guild.id,
    guildName: guild.name,
    refreshedByUserId: interaction.user.id,
    dashboardChannel,
    guildConfig,
    task: updatedTask,
  });

  logger.info('Task claimed', {
    guildId: guild.id,
    taskId: updatedTask.id,
    taskCode: updatedTask.taskCode,
    assigneeDiscordUserId: interaction.user.id,
    threadChannelId,
    threadCreationFailed,
  });

  await showTaskPanelReply({
    interaction,
    taskId: updatedTask.id,
    mode: 'overview',
    notice: threadCreationFailed
      ? `You claimed **${updatedTask.taskCode}** and started the task team, but the workspace thread could not be created automatically.`
      : `You claimed **${updatedTask.taskCode}**. Workspace thread: ${threadChannelId ? `<#${threadChannelId}>` : 'Unavailable'}`,
  });
}

async function handleJoinTaskInteraction(
  interaction: ButtonInteraction,
  taskId: number,
): Promise<void> {
  await deferEphemeral(interaction);

  const context = await resolveTaskContext(interaction, taskId);
  if (!context) {
    return;
  }

  const { guild, guildConfig, task, dashboardChannel } = context;

  if (!['IN_PROGRESS', 'BLOCKED'].includes(task.status)) {
    await interaction.editReply({
      content: `${task.taskCode} cannot be joined in its current state.`,
    });
    return;
  }

  if (!taskNeedsMoreMembers(task)) {
    await interaction.editReply({
      content: `${task.taskCode} already has enough team members.`,
    });
    return;
  }

  if (hasTaskMember(task, interaction.user.id)) {
    await interaction.editReply({
      content: `You are already on the team for ${task.taskCode}.`,
    });
    return;
  }

  const adminOverride = isAdminOverride({
    member: interaction.member,
    memberPermissions: interaction.memberPermissions,
    adminRoleId: guildConfig.adminRoleId,
    secondaryManagerRoleId: guildConfig.secondaryManagerRoleId,
  });
  const allowedToJoin = canClaimRequiredRole({
    requiredRole: task.requiredRole,
    member: interaction.member,
    memberPermissions: interaction.memberPermissions,
    adminRoleId: guildConfig.adminRoleId,
    secondaryManagerRoleId: guildConfig.secondaryManagerRoleId,
  });

  if (!allowedToJoin) {
    await interaction.editReply({
      content: `You do not have the required role to join ${task.taskCode}.`,
    });
    return;
  }

  const activeTaskCount = await countActiveTasksForAssignee(guild.id, interaction.user.id);
  if (!adminOverride && activeTaskCount >= guildConfig.maxActiveTasksPerUser) {
    await interaction.editReply({
      content: `You already have ${activeTaskCount} active tasks, which meets the configured limit of ${guildConfig.maxActiveTasksPerUser}.`,
    });
    return;
  }

  const joinResult = await addTaskMember(task.id, interaction.user.id);
  if (joinResult.status === 'missing') {
    await interaction.editReply({
      content: `${task.taskCode} could not be updated because it no longer exists.`,
    });
    return;
  }

  if (joinResult.status === 'not_joinable') {
    await interaction.editReply({
      content: `${joinResult.task.taskCode} cannot be joined in its current state.`,
    });
    return;
  }

  if (joinResult.status === 'already_member') {
    await interaction.editReply({
      content: `You are already on the team for ${joinResult.task.taskCode}.`,
    });
    return;
  }

  if (joinResult.status === 'full') {
    await interaction.editReply({
      content: `${joinResult.task.taskCode} already has enough team members.`,
    });
    return;
  }

  const updatedTask = joinResult.task;

  await finalizeTaskInteraction({
    interaction,
    guildId: guild.id,
    guildName: guild.name,
    refreshedByUserId: interaction.user.id,
    dashboardChannel,
    guildConfig,
    task: updatedTask,
  });

  await showTaskPanelReply({
    interaction,
    taskId: updatedTask.id,
    mode: 'overview',
    notice: `You joined the team for **${updatedTask.taskCode}**.`,
  });
}

async function handleBlockTaskPrompt(
  interaction: ButtonInteraction,
  taskId: number,
): Promise<void> {
  if (!interaction.inGuild()) {
    await interaction.reply({
      content: 'Task actions are only available inside a server.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (!Number.isInteger(taskId) || taskId <= 0) {
    await interaction.reply({
      content: 'This task action is invalid.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.showModal(buildBlockModal(taskId));
}

async function handleBlockTaskSubmit(
  interaction: ModalSubmitInteraction,
  taskId: number,
): Promise<void> {
  await deferEphemeral(interaction);

  const context = await resolveTaskContext(interaction, taskId);
  if (!context) {
    return;
  }

  const { guild, guildConfig, task, dashboardChannel } = context;

  if (task.status !== 'IN_PROGRESS') {
    await interaction.editReply({
      content: `${task.taskCode} is not currently in progress.`,
    });
    return;
  }

  if (!canManageTaskProgress({
      member: interaction.member,
      memberPermissions: interaction.memberPermissions,
      adminRoleId: guildConfig.adminRoleId,
      secondaryManagerRoleId: guildConfig.secondaryManagerRoleId,
      task,
      userId: interaction.user.id,
    })) {
    await interaction.editReply({
      content: 'Only a configured manager role or task team member can block this task.'
    });
    return;
  }

  const reason = interaction.fields.getTextInputValue('reason').trim();
  if (reason.length < 5) {
    await interaction.editReply({
      content: 'Please provide a more specific blocked reason.',
    });
    return;
  }

  const updatedTask = await transitionTaskWithMembers(task.id, ['IN_PROGRESS'], {
    status: 'BLOCKED',
    blockedReason: reason,
    reviewRequestedAt: null,
    completedAt: null,
  });

  if (!updatedTask) {
    await interaction.editReply({
      content: `${task.taskCode} changed before the blocked update could be applied.`,
    });
    return;
  }

  await createTaskStatusHistory({
    taskId: updatedTask.id,
    actorDiscordUserId: interaction.user.id,
    fromStatus: task.status,
    toStatus: updatedTask.status,
    reason,
  });

  await finalizeTaskInteraction({
    interaction,
    guildId: guild.id,
    guildName: guild.name,
    refreshedByUserId: interaction.user.id,
    dashboardChannel,
    guildConfig,
    task: updatedTask,
  });

  await showTaskPanelReply({
    interaction,
    taskId: updatedTask.id,
    mode: 'overview',
    notice: `Marked **${updatedTask.taskCode}** as Blocked.`,
  });
}

async function handleUnblockTaskInteraction(
  interaction: ButtonInteraction,
  taskId: number,
): Promise<void> {
  await deferEphemeral(interaction);

  const context = await resolveTaskContext(interaction, taskId);
  if (!context) {
    return;
  }

  const { guild, guildConfig, task, dashboardChannel } = context;

  if (task.status !== 'BLOCKED') {
    await interaction.editReply({
      content: `${task.taskCode} is not currently blocked.`,
    });
    return;
  }

  if (!canManageTaskProgress({
      member: interaction.member,
      memberPermissions: interaction.memberPermissions,
      adminRoleId: guildConfig.adminRoleId,
      secondaryManagerRoleId: guildConfig.secondaryManagerRoleId,
      task,
      userId: interaction.user.id,
    })) {
    await interaction.editReply({
      content: 'Only a configured manager role or task team member can unblock this task.'
    });
    return;
  }

  const updatedTask = await transitionTaskWithMembers(task.id, ['BLOCKED'], {
    status: 'IN_PROGRESS',
    blockedReason: null,
    completedAt: null,
  });

  if (!updatedTask) {
    await interaction.editReply({
      content: `${task.taskCode} changed before the unblock update could be applied.`,
    });
    return;
  }

  if (updatedTask.threadChannelId) {
    await reopenTaskThread(guild, updatedTask.threadChannelId).catch(() => null);
  }

  await createTaskStatusHistory({
    taskId: updatedTask.id,
    actorDiscordUserId: interaction.user.id,
    fromStatus: task.status,
    toStatus: updatedTask.status,
    reason: 'Task unblocked',
  });

  await finalizeTaskInteraction({
    interaction,
    guildId: guild.id,
    guildName: guild.name,
    refreshedByUserId: interaction.user.id,
    dashboardChannel,
    guildConfig,
    task: updatedTask,
  });

  await showTaskPanelReply({
    interaction,
    taskId: updatedTask.id,
    mode: 'overview',
    notice: `Moved **${updatedTask.taskCode}** back to In Progress.`,
  });
}

async function handleRequestReviewInteraction(
  interaction: ButtonInteraction,
  taskId: number,
): Promise<void> {
  await deferEphemeral(interaction);

  const context = await resolveTaskContext(interaction, taskId);
  if (!context) {
    return;
  }

  const { guild, guildConfig, task, dashboardChannel } = context;

  if (task.status !== 'IN_PROGRESS') {
    await interaction.editReply({
      content: `${task.taskCode} must be In Progress before requesting review.`,
    });
    return;
  }

  if (!canManageTaskProgress({
      member: interaction.member,
      memberPermissions: interaction.memberPermissions,
      adminRoleId: guildConfig.adminRoleId,
      secondaryManagerRoleId: guildConfig.secondaryManagerRoleId,
      task,
      userId: interaction.user.id,
    })) {
    await interaction.editReply({
      content: 'Only a configured manager role or task team member can request review for this task.'
    });
    return;
  }

  const updatedTask = await transitionTaskWithMembers(task.id, ['IN_PROGRESS'], {
    status: 'REVIEW',
    reviewRequestedAt: new Date(),
    blockedReason: null,
    completedAt: null,
  });

  if (!updatedTask) {
    await interaction.editReply({
      content: `${task.taskCode} changed before review could be requested.`,
    });
    return;
  }

  await createTaskStatusHistory({
    taskId: updatedTask.id,
    actorDiscordUserId: interaction.user.id,
    fromStatus: task.status,
    toStatus: updatedTask.status,
    reason: 'Review requested',
  });

  await finalizeTaskInteraction({
    interaction,
    guildId: guild.id,
    guildName: guild.name,
    refreshedByUserId: interaction.user.id,
    dashboardChannel,
    guildConfig,
    task: updatedTask,
  });

  const reviewerLine = ` Reviewers: ${formatRoleMentions(
    getReviewerRoleIds(guildConfig),
    formatRoleMentions(getManagerRoleIds(guildConfig), 'Managers only'),
  )}`;

  await showTaskPanelReply({
    interaction,
    taskId: updatedTask.id,
    mode: 'overview',
    notice: `Moved **${updatedTask.taskCode}** to Review.${reviewerLine}`,
  });
}

async function handleApproveTaskInteraction(
  interaction: ButtonInteraction,
  taskId: number,
): Promise<void> {
  await deferEphemeral(interaction);

  const context = await resolveTaskContext(interaction, taskId);
  if (!context) {
    return;
  }

  const { guild, guildConfig, task, dashboardChannel } = context;

  if (task.status !== 'REVIEW') {
    await interaction.editReply({
      content: `${task.taskCode} is not waiting for review.`,
    });
    return;
  }

  if (!canReviewTask({
      member: interaction.member,
      memberPermissions: interaction.memberPermissions,
      adminRoleId: guildConfig.adminRoleId,
      secondaryManagerRoleId: guildConfig.secondaryManagerRoleId,
      reviewerRoleId: guildConfig.reviewerRoleId,
      secondaryReviewerRoleId: guildConfig.secondaryReviewerRoleId,
    })) {
    await interaction.editReply({
      content: 'Only configured manager or reviewer roles can approve this task.'
    });
    return;
  }

  const updatedTask = await transitionTaskWithMembers(task.id, ['REVIEW'], {
    status: 'DONE',
    completedAt: new Date(),
    blockedReason: null,
  });

  if (!updatedTask) {
    await interaction.editReply({
      content: `${task.taskCode} changed before approval could be applied.`,
    });
    return;
  }

  if (updatedTask.threadChannelId) {
    await archiveTaskThread(guild, updatedTask.threadChannelId).catch(() => null);
  }

  await createTaskStatusHistory({
    taskId: updatedTask.id,
    actorDiscordUserId: interaction.user.id,
    fromStatus: task.status,
    toStatus: updatedTask.status,
    reason: 'Task approved',
  });

  await finalizeTaskInteraction({
    interaction,
    guildId: guild.id,
    guildName: guild.name,
    refreshedByUserId: interaction.user.id,
    dashboardChannel,
    guildConfig,
    task: updatedTask,
  });

  await showTaskPanelReply({
    interaction,
    taskId: updatedTask.id,
    mode: 'overview',
    notice: `Approved **${updatedTask.taskCode}** and marked it Done.`,
  });
}

async function handleReturnTaskInteraction(
  interaction: ButtonInteraction,
  taskId: number,
): Promise<void> {
  await deferEphemeral(interaction);

  const context = await resolveTaskContext(interaction, taskId);
  if (!context) {
    return;
  }

  const { guild, guildConfig, task, dashboardChannel } = context;

  if (task.status !== 'REVIEW') {
    await interaction.editReply({
      content: `${task.taskCode} is not waiting for review.`,
    });
    return;
  }

  if (!canReviewTask({
      member: interaction.member,
      memberPermissions: interaction.memberPermissions,
      adminRoleId: guildConfig.adminRoleId,
      secondaryManagerRoleId: guildConfig.secondaryManagerRoleId,
      reviewerRoleId: guildConfig.reviewerRoleId,
      secondaryReviewerRoleId: guildConfig.secondaryReviewerRoleId,
    })) {
    await interaction.editReply({
      content: 'Only configured manager or reviewer roles can return this task for changes.'
    });
    return;
  }

  const updatedTask = await transitionTaskWithMembers(task.id, ['REVIEW'], {
    status: 'IN_PROGRESS',
    reviewRequestedAt: null,
    completedAt: null,
  });

  if (!updatedTask) {
    await interaction.editReply({
      content: `${task.taskCode} changed before it could be returned to In Progress.`,
    });
    return;
  }

  if (updatedTask.threadChannelId) {
    await reopenTaskThread(guild, updatedTask.threadChannelId).catch(() => null);
  }

  await createTaskStatusHistory({
    taskId: updatedTask.id,
    actorDiscordUserId: interaction.user.id,
    fromStatus: task.status,
    toStatus: updatedTask.status,
    reason: 'Returned to in progress',
  });

  await finalizeTaskInteraction({
    interaction,
    guildId: guild.id,
    guildName: guild.name,
    refreshedByUserId: interaction.user.id,
    dashboardChannel,
    guildConfig,
    task: updatedTask,
  });

  await showTaskPanelReply({
    interaction,
    taskId: updatedTask.id,
    mode: 'overview',
    notice: `Returned **${updatedTask.taskCode}** to In Progress.`,
  });
}

async function handleReopenTaskInteraction(
  interaction: ButtonInteraction,
  taskId: number,
): Promise<void> {
  await deferEphemeral(interaction);

  const context = await resolveTaskContext(interaction, taskId);
  if (!context) {
    return;
  }

  const { guild, guildConfig, task, dashboardChannel } = context;

  if (task.status !== 'DONE') {
    await interaction.editReply({
      content: `${task.taskCode} is not currently done.`,
    });
    return;
  }

  if (!canReviewTask({
      member: interaction.member,
      memberPermissions: interaction.memberPermissions,
      adminRoleId: guildConfig.adminRoleId,
      secondaryManagerRoleId: guildConfig.secondaryManagerRoleId,
      reviewerRoleId: guildConfig.reviewerRoleId,
      secondaryReviewerRoleId: guildConfig.secondaryReviewerRoleId,
    })) {
    await interaction.editReply({
      content: 'Only configured manager or reviewer roles can reopen this task.'
    });
    return;
  }

  const reopenedTask = await transitionTaskWithMembers(task.id, ['DONE'], {
    status: 'BACKLOG',
    assigneeDiscordUserId: null,
    reviewRequestedAt: null,
    completedAt: null,
    blockedReason: null,
  });

  if (!reopenedTask) {
    await interaction.editReply({
      content: `${task.taskCode} changed before it could be reopened.`,
    });
    return;
  }

  await clearTaskMembers(reopenedTask.id);
  const updatedTask = await findTaskByIdWithMembers(reopenedTask.id);
  if (!updatedTask) {
    await interaction.editReply({
      content: `${task.taskCode} disappeared while it was being reopened.`,
    });
    return;
  }

  if (updatedTask.threadChannelId) {
    await reopenTaskThread(guild, updatedTask.threadChannelId).catch(() => null);
  }

  await createTaskStatusHistory({
    taskId: updatedTask.id,
    actorDiscordUserId: interaction.user.id,
    fromStatus: task.status,
    toStatus: updatedTask.status,
    reason: 'Task reopened',
  });

  await finalizeTaskInteraction({
    interaction,
    guildId: guild.id,
    guildName: guild.name,
    refreshedByUserId: interaction.user.id,
    dashboardChannel,
    guildConfig,
    task: updatedTask,
  });

  await showTaskPanelReply({
    interaction,
    taskId: updatedTask.id,
    mode: 'overview',
    notice: `Reopened **${updatedTask.taskCode}** and moved it back to Backlog.`,
  });
}

function hasManagementAccessForInteraction(
  interaction: TaskInteraction | ButtonInteraction,
  guildConfig: NonNullable<Awaited<ReturnType<typeof findGuildConfigByGuildId>>>,
): boolean {
  return hasManagementAccess({
    member: interaction.member,
    memberPermissions: interaction.memberPermissions,
    adminRoleId: guildConfig.adminRoleId,
    secondaryManagerRoleId: guildConfig.secondaryManagerRoleId,
  });
}

function canReviewFromInteraction(
  interaction: TaskInteraction | ButtonInteraction,
  guildConfig: NonNullable<Awaited<ReturnType<typeof findGuildConfigByGuildId>>>,
): boolean {
  return canReviewTask({
    member: interaction.member,
    memberPermissions: interaction.memberPermissions,
    adminRoleId: guildConfig.adminRoleId,
    secondaryManagerRoleId: guildConfig.secondaryManagerRoleId,
    reviewerRoleId: guildConfig.reviewerRoleId,
    secondaryReviewerRoleId: guildConfig.secondaryReviewerRoleId,
  });
}

type TaskPanelMode = 'overview' | 'edit-hub' | 'attachments' | 'add-file-guide';

type TaskActionPanelOptions = {
  readonly task: ResolvedTask;
  readonly guildConfig: NonNullable<Awaited<ReturnType<typeof findGuildConfigByGuildId>>>;
  readonly interaction: TaskInteraction;
};

function getTaskActionAccess(options: TaskActionPanelOptions) {
  const { task, guildConfig, interaction } = options;
  const canClaim = canClaimRequiredRole({
    requiredRole: task.requiredRole,
    member: interaction.member,
    memberPermissions: interaction.memberPermissions,
    adminRoleId: guildConfig.adminRoleId,
    secondaryManagerRoleId: guildConfig.secondaryManagerRoleId,
  });
  const canManageProgress = canManageTaskProgress({
    member: interaction.member,
    memberPermissions: interaction.memberPermissions,
    adminRoleId: guildConfig.adminRoleId,
    secondaryManagerRoleId: guildConfig.secondaryManagerRoleId,
    task,
    userId: interaction.user.id,
  });

  return {
    manager: hasManagementAccessForInteraction(interaction, guildConfig),
    reviewer: canReviewFromInteraction(interaction, guildConfig),
    canClaim,
    canManageProgress,
  };
}

function buildTaskOverviewPanelEmbed(options: TaskActionPanelOptions): EmbedBuilder {
  const { task, guildConfig } = options;
  const access = getTaskActionAccess(options);
  const attachmentLines = task.attachments.length > 0
    ? task.attachments.slice(0, 8).map((attachment) => `#${attachment.id} • ${formatAttachmentLabel(attachment)}`)
    : ['No attachments yet.'];

  const phaseLine = (() => {
    switch (task.status) {
      case 'BACKLOG':
        return access.manager
          ? 'This task is still in backlog. Managers can tune it before someone claims it.'
          : 'This task is still in backlog and can be claimed if you have the required role.';
      case 'IN_PROGRESS':
        return 'This task is active. Progress controls update as the state changes.';
      case 'BLOCKED':
        return 'This task is blocked. Unblock it before work continues.';
      case 'REVIEW':
        return 'This task is waiting for review actions.';
      case 'DONE':
        return 'This task is completed. Review roles can reopen it if needed.';
    }
  })();

  return new EmbedBuilder()
    .setTitle(`🧰 ${task.taskCode} • ${task.title}`)
    .setColor(0x5865f2)
    .setDescription([
      `Status: **${task.status}**`,
      phaseLine,
      '',
      `Your access: ${[
        access.canClaim ? 'claim/join' : null,
        access.canManageProgress ? 'progress actions' : null,
        access.reviewer ? 'review actions' : null,
        access.manager ? 'manager edit tools' : null,
      ].filter(Boolean).join(', ') || 'view only'}`,
      '',
      'The buttons below are private to you and should refresh as the task changes.',
    ].join('\n'))
    .addFields(
      {
        name: 'Attachments',
        value: attachmentLines.join('\n'),
        inline: false,
      },
      {
        name: 'Review roles',
        value: formatRoleMentions(
          getReviewerRoleIds(guildConfig),
          formatRoleMentions(getManagerRoleIds(guildConfig), 'Managers only'),
        ),
        inline: false,
      },
    )
    .setFooter({
      text: 'Task buttons are shown according to task state and your permissions.',
    })
    .setTimestamp(task.updatedAt);
}

function buildTaskOverviewPanelComponents(options: TaskActionPanelOptions): Array<ActionRowBuilder<ButtonBuilder>> {
  const { task, interaction } = options;
  const access = getTaskActionAccess(options);
  const rows: Array<ActionRowBuilder<ButtonBuilder>> = [];
  const workflowRow = new ActionRowBuilder<ButtonBuilder>();

  if (task.status === 'BACKLOG' && !task.assigneeDiscordUserId && !hasTaskTeam(task) && access.canClaim) {
    workflowRow.addComponents(
      new ButtonBuilder()
        .setCustomId(`task:claim:${task.id}`)
        .setLabel('Claim')
        .setEmoji('✋')
        .setStyle(ButtonStyle.Primary),
    );
  }

  if ((task.status === 'IN_PROGRESS' || task.status === 'BLOCKED') && taskNeedsMoreMembers(task) && !hasTaskMember(task, interaction.user.id) && access.canClaim) {
    workflowRow.addComponents(
      new ButtonBuilder()
        .setCustomId(`task:join:${task.id}`)
        .setLabel('Join Task')
        .setEmoji('🤝')
        .setStyle(ButtonStyle.Secondary),
    );
  }

  if (task.status === 'IN_PROGRESS' && access.canManageProgress) {
    workflowRow.addComponents(
      new ButtonBuilder()
        .setCustomId(`task:block:${task.id}`)
        .setLabel('Block')
        .setEmoji('⛔')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`task:review:${task.id}`)
        .setLabel('Done / Review')
        .setEmoji('✅')
        .setStyle(ButtonStyle.Success),
    );
  }

  if (task.status === 'BLOCKED' && access.canManageProgress) {
    workflowRow.addComponents(
      new ButtonBuilder()
        .setCustomId(`task:unblock:${task.id}`)
        .setLabel('Unblock')
        .setEmoji('▶️')
        .setStyle(ButtonStyle.Primary),
    );
  }

  if (task.status === 'REVIEW' && access.reviewer) {
    workflowRow.addComponents(
      new ButtonBuilder()
        .setCustomId(`task:approve:${task.id}`)
        .setLabel('Approve')
        .setEmoji('✅')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`task:return:${task.id}`)
        .setLabel('Request Changes')
        .setEmoji('↩️')
        .setStyle(ButtonStyle.Secondary),
    );
  }

  if (task.status === 'DONE' && access.reviewer) {
    workflowRow.addComponents(
      new ButtonBuilder()
        .setCustomId(`task:reopen:${task.id}`)
        .setLabel('Reopen')
        .setEmoji('♻️')
        .setStyle(ButtonStyle.Secondary),
    );
  }

  if (workflowRow.components.length > 0) {
    rows.push(workflowRow);
  }

  if (access.manager) {
    const managerRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`task:edit-hub:${task.id}`)
        .setLabel('Update Task')
        .setStyle(ButtonStyle.Secondary),
    );
    rows.push(managerRow);
  }

  return rows;
}

function buildTaskEditHubEmbed(options: TaskActionPanelOptions): EmbedBuilder {
  const { task } = options;

  return new EmbedBuilder()
    .setTitle(`Update Task • ${task.taskCode}`)
    .setColor(0x5865f2)
    .setDescription([
      'Manager-only update hub.',
      task.status === 'BACKLOG'
        ? 'Use this before claim to tune the task cleanly.'
        : 'Use this to maintain the task while the workflow continues.',
      '',
      'Everything here should refresh the task card and dashboard as soon as you save.',
    ].join('\n'))
    .setTimestamp(task.updatedAt);
}

function buildTaskEditHubComponents(options: TaskActionPanelOptions): Array<ActionRowBuilder<ButtonBuilder>> {
  const { task } = options;

  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`task:edit:${task.id}`)
        .setLabel('Update Details')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`task:${task.deadlineAt ? 'clear-deadline' : 'set-deadline'}:${task.id}`)
        .setLabel(task.deadlineAt ? 'Clear Deadline' : 'Update Deadline')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`task:attachments:${task.id}`)
        .setLabel('Attachments')
        .setEmoji('📎')
        .setStyle(ButtonStyle.Secondary),
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`task:repair:${task.id}`)
        .setLabel('Repair Task')
        .setEmoji('🛠️')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`task:back-actions:${task.id}`)
        .setLabel('Back')
        .setEmoji('↩️')
        .setStyle(ButtonStyle.Secondary),
    ),
  ];
}

function buildTaskAttachmentsPanelEmbed(options: TaskActionPanelOptions): EmbedBuilder {
  const { task } = options;
  const attachmentLines = task.attachments.length > 0
    ? task.attachments.slice(0, 12).map((attachment) => `#${attachment.id} • ${formatAttachmentLabel(attachment)}`)
    : ['No attachments yet.'];

  return new EmbedBuilder()
    .setTitle(`📎 Attachments • ${task.taskCode}`)
    .setColor(0x5865f2)
    .setDescription([
      'Choose how to manage attachments for this task.',
      'URL attachments can be entered directly here.',
      'File uploads keep the original filename that Discord provides — no intentional accent stripping or renaming.',
    ].join('\n'))
    .addFields({
      name: 'Current attachments',
      value: attachmentLines.join('\n'),
      inline: false,
    })
    .setTimestamp(task.updatedAt);
}

function buildTaskAttachmentsPanelComponents(options: TaskActionPanelOptions): Array<ActionRowBuilder<ButtonBuilder>> {
  const { task } = options;

  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`task:add-link:${task.id}`)
        .setLabel('Add URL')
        .setEmoji('🔗')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`task:add-file:${task.id}`)
        .setLabel('Add File')
        .setEmoji('📤')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`task:remove-attachment:${task.id}`)
        .setLabel('Remove Attachment')
        .setEmoji('🗑️')
        .setStyle(ButtonStyle.Secondary),
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`task:back-edit:${task.id}`)
        .setLabel('Back')
        .setEmoji('↩️')
        .setStyle(ButtonStyle.Secondary),
    ),
  ];
}

function buildTaskAddFileGuideEmbed(options: TaskActionPanelOptions): EmbedBuilder {
  const { task } = options;

  return new EmbedBuilder()
    .setTitle(`📤 Add File • ${task.taskCode}`)
    .setColor(0x5865f2)
    .setDescription([
      'Discord still requires an upload step for files.',
      '',
      `1. Run the fallback command "/task add-attachment" for **${task.taskCode}**.`,
      '2. Upload the file in that command.',
      '3. Optional: add a note/label if needed.',
      '',
      'Limits follow Discord/server upload limits.',
      'The bot stores the original filename exactly as Discord provides it and does not intentionally strip accents or rename it.',
    ].join('\n'))
    .setFooter({
      text: 'After upload, reopen Attachments if you want to verify the saved file entry.',
    })
    .setTimestamp(task.updatedAt);
}

function buildTaskAddFileGuideComponents(options: TaskActionPanelOptions): Array<ActionRowBuilder<ButtonBuilder>> {
  const { task } = options;

  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`task:back-attachments:${task.id}`)
        .setLabel('Back')
        .setEmoji('↩️')
        .setStyle(ButtonStyle.Secondary),
    ),
  ];
}

function buildTaskPanelPayload(options: TaskActionPanelOptions & { readonly mode: TaskPanelMode }) {
  switch (options.mode) {
    case 'edit-hub':
      return {
        embeds: [buildTaskEditHubEmbed(options)],
        components: buildTaskEditHubComponents(options),
      };
    case 'attachments':
      return {
        embeds: [buildTaskAttachmentsPanelEmbed(options)],
        components: buildTaskAttachmentsPanelComponents(options),
      };
    case 'add-file-guide':
      return {
        embeds: [buildTaskAddFileGuideEmbed(options)],
        components: buildTaskAddFileGuideComponents(options),
      };
    case 'overview':
      return {
        embeds: [buildTaskOverviewPanelEmbed(options)],
        components: buildTaskOverviewPanelComponents(options),
      };
  }
}

function buildCreateTaskModal(): ModalBuilder {
  return new ModalBuilder()
    .setCustomId('task:create-modal')
    .setTitle('Create task')
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId('title').setLabel('Title').setStyle(TextInputStyle.Short).setMaxLength(120).setRequired(true),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId('description').setLabel('Description').setStyle(TextInputStyle.Paragraph).setMaxLength(4000).setRequired(true),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId('required_role').setLabel('Required role (ADMIN / TECHNICIAN / RESEARCHER)').setStyle(TextInputStyle.Short).setRequired(true),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId('priority').setLabel('Priority (LOW / MEDIUM / HIGH / URGENT)').setStyle(TextInputStyle.Short).setRequired(false),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId('team_size').setLabel('Team size').setStyle(TextInputStyle.Short).setValue('1').setRequired(true),
      ),
    );
}

function buildEditTaskModal(task: ResolvedTask): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(`task:edit-modal:${task.id}`)
    .setTitle(`Edit ${task.taskCode}`)
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId('title').setLabel('Title').setStyle(TextInputStyle.Short).setValue(task.title).setMaxLength(120).setRequired(true),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId('description').setLabel('Description').setStyle(TextInputStyle.Paragraph).setValue(task.description).setMaxLength(4000).setRequired(true),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId('required_role').setLabel('Required role').setStyle(TextInputStyle.Short).setValue(task.requiredRole).setRequired(true),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId('priority').setLabel('Priority').setStyle(TextInputStyle.Short).setValue(task.priority).setRequired(true),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId('team_size').setLabel('Team size').setStyle(TextInputStyle.Short).setValue(String(task.targetMemberCount)).setRequired(true),
      ),
    );
}

function buildDeadlineModal(task: ResolvedTask): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(`task:deadline-modal:${task.id}`)
    .setTitle(`Set deadline • ${task.taskCode}`)
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('deadline')
          .setLabel('Deadline (dd/MM/yyyy HH:mm or ISO-8601)')
          .setStyle(TextInputStyle.Short)
          .setRequired(true),
      ),
    );
}

function buildAddLinkModal(task: ResolvedTask): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(`task:add-link-modal:${task.id}`)
    .setTitle(`Add link • ${task.taskCode}`)
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId('url').setLabel('URL').setStyle(TextInputStyle.Short).setRequired(true),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId('label').setLabel('Optional label').setStyle(TextInputStyle.Short).setRequired(false),
      ),
    );
}

function buildRemoveAttachmentModal(task: ResolvedTask): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(`task:remove-attachment-modal:${task.id}`)
    .setTitle(`Remove attachment • ${task.taskCode}`)
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId('attachment_id').setLabel('Attachment ID').setStyle(TextInputStyle.Short).setRequired(true),
      ),
    );
}

async function handleDashboardButtonInteraction(
  interaction: ButtonInteraction,
  action: string | undefined,
): Promise<void> {
  if (!interaction.inGuild() || !interaction.guild) {
    await interaction.reply({ content: 'Dashboard actions are only available inside a server.', flags: MessageFlags.Ephemeral });
    return;
  }

  const guildConfig = await findGuildConfigByGuildId(interaction.guild.id);
  if (!guildConfig) {
    await interaction.reply({ content: 'TaskBot is not configured yet. Run /setup first.', flags: MessageFlags.Ephemeral });
    return;
  }

  switch (action) {
    case 'create-task': {
      if (!hasManagementAccessForInteraction(interaction, guildConfig)) {
        await interaction.reply({ content: 'Only configured manager roles can create tasks.', flags: MessageFlags.Ephemeral });
        return;
      }

      await interaction.showModal(buildCreateTaskModal());
      return;
    }
    case 'manager-console': {
      await deferEphemeral(interaction);
      if (!hasManagementAccessForInteraction(interaction, guildConfig)) {
        await interaction.editReply({ content: 'Only configured manager roles can open the manager console.' });
        return;
      }

      const embed = new EmbedBuilder()
        .setTitle('🛠️ Manager Console')
        .setDescription('Use **Create Task** to add a new task. Use **Repair Dashboard** only when Discord messages/threads are out of sync. File attachment uploads stay on `/task add-attachment`.')
        .setColor(0x5865f2);
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId('dashboard:create-task').setLabel('Create Task').setEmoji('➕').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('dashboard:repair-all').setLabel('Repair Dashboard').setEmoji('🛠️').setStyle(ButtonStyle.Secondary),
      );

      await interaction.editReply({ embeds: [embed], components: [row] });
      return;
    }
    case 'repair-all': {
      await deferEphemeral(interaction);
      if (!hasManagementAccessForInteraction(interaction, guildConfig)) {
        await interaction.editReply({ content: 'Only configured manager roles can repair the dashboard.' });
        return;
      }

      const dashboardChannel = interaction.guild.channels.cache.get(guildConfig.dashboardChannelId)
        ?? await interaction.guild.channels.fetch(guildConfig.dashboardChannelId).catch(() => null);
      if (!isTextChannel(dashboardChannel)) {
        await interaction.editReply({ content: 'The configured dashboard channel is unavailable or is not a text channel.' });
        return;
      }

      const result = await syncTaskDashboard({
        guild: interaction.guild,
        guildConfig,
        dashboardChannel,
        refreshedByUserId: interaction.user.id,
        taskCode: null,
      });

      await interaction.editReply({
        content: [
          `Dashboard sync completed for **${interaction.guild.name}**.`,
          `Summary recreated: ${result.summaryRecreated ? 'Yes' : 'No'}`,
          `Tasks processed: ${result.tasksProcessed}`,
          `Task cards recreated: ${result.taskCardsRecreated}`,
          `Threads recreated: ${result.threadsRecreated}`,
        ].join('\n'),
      });
      return;
    }
    case 'review-queue': {
      await deferEphemeral(interaction);
      if (!canReviewFromInteraction(interaction, guildConfig)) {
        await interaction.editReply({ content: 'Only configured manager or reviewer roles can open the review queue.' });
        return;
      }

      const reviewTasks = await listTasksByStatus(interaction.guild.id, 'REVIEW');
      const embed = new EmbedBuilder()
        .setTitle('👀 Review Queue')
        .setColor(0xfee75c)
        .setDescription(
          reviewTasks.length > 0
            ? reviewTasks.slice(0, 15).map((task) => `- **${task.taskCode}** — ${task.title}`).join('\n')
            : 'There are no tasks waiting for review right now.',
        )
        .setFooter({ text: 'Open a task card and use Task Actions to review a specific task.' });

      await interaction.editReply({ embeds: [embed], components: [] });
      return;
    }
    case 'my-tasks': {
      await deferEphemeral(interaction);
      const tasks = await listTasksForGuildWithMembers(interaction.guild.id);
      const myTasks = tasks.filter((task) =>
        ['IN_PROGRESS', 'BLOCKED', 'REVIEW'].includes(task.status)
        && (task.assigneeDiscordUserId === interaction.user.id || hasTaskMember(task, interaction.user.id))
      );

      const embed = new EmbedBuilder()
        .setTitle('📌 My Tasks')
        .setColor(0x57f287)
        .setDescription(
          myTasks.length > 0
            ? myTasks.slice(0, 15).map((task) => `- **${task.taskCode}** — ${task.title} (${task.status})`).join('\n')
            : 'You do not have any active tasks right now.',
        )
        .setFooter({ text: 'Open a task card and use Task Actions for task-specific controls.' });

      await interaction.editReply({ embeds: [embed], components: [] });
      return;
    }
    default:
      await interaction.reply({ content: `Unsupported dashboard action: ${interaction.customId}`, flags: MessageFlags.Ephemeral });
  }
}

async function handleTaskActionsPanelInteraction(
  interaction: ButtonInteraction,
  taskId: number,
): Promise<void> {
  await deferEphemeral(interaction);
  await showTaskPanelReply({ interaction, taskId, mode: 'overview' });
}

async function handleTaskEditHubInteraction(
  interaction: ButtonInteraction,
  taskId: number,
): Promise<void> {
  await deferEphemeral(interaction);

  const context = await resolveTaskContext(interaction, taskId);
  if (!context) {
    return;
  }

  if (!hasManagementAccessForInteraction(interaction, context.guildConfig)) {
    await interaction.editReply({ content: 'Only configured manager roles can update this task.' });
    return;
  }

  await showTaskPanelReply({ interaction, taskId, mode: 'edit-hub' });
}

async function handleTaskAttachmentsPanelInteraction(
  interaction: ButtonInteraction,
  taskId: number,
): Promise<void> {
  await deferEphemeral(interaction);

  const context = await resolveTaskContext(interaction, taskId);
  if (!context) {
    return;
  }

  if (!hasManagementAccessForInteraction(interaction, context.guildConfig)) {
    await interaction.editReply({ content: 'Only configured manager roles can manage attachments.' });
    return;
  }

  await showTaskPanelReply({ interaction, taskId, mode: 'attachments' });
}

async function handleTaskAddFileGuideInteraction(
  interaction: ButtonInteraction,
  taskId: number,
): Promise<void> {
  await deferEphemeral(interaction);

  const context = await resolveTaskContext(interaction, taskId);
  if (!context) {
    return;
  }

  if (!hasManagementAccessForInteraction(interaction, context.guildConfig)) {
    await interaction.editReply({ content: 'Only configured manager roles can add task files.' });
    return;
  }

  await showTaskPanelReply({ interaction, taskId, mode: 'add-file-guide' });
}

async function handleEditTaskPrompt(interaction: ButtonInteraction, taskId: number): Promise<void> {
  const context = await resolveTaskContext(interaction, taskId);
  if (!context) {
    return;
  }

  if (!hasManagementAccessForInteraction(interaction, context.guildConfig)) {
    await interaction.reply({ content: 'Only configured manager roles can edit task details.', flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.showModal(buildEditTaskModal(context.task));
}

async function handleSetDeadlinePrompt(interaction: ButtonInteraction, taskId: number): Promise<void> {
  const context = await resolveTaskContext(interaction, taskId);
  if (!context) {
    return;
  }

  if (!hasManagementAccessForInteraction(interaction, context.guildConfig)) {
    await interaction.reply({ content: 'Only configured manager roles can set task deadlines.', flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.showModal(buildDeadlineModal(context.task));
}

async function handleAddLinkPrompt(interaction: ButtonInteraction, taskId: number): Promise<void> {
  const context = await resolveTaskContext(interaction, taskId);
  if (!context) {
    return;
  }

  if (!hasManagementAccessForInteraction(interaction, context.guildConfig)) {
    await interaction.reply({ content: 'Only configured manager roles can add task links.', flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.showModal(buildAddLinkModal(context.task));
}

async function handleRemoveAttachmentPrompt(interaction: ButtonInteraction, taskId: number): Promise<void> {
  const context = await resolveTaskContext(interaction, taskId);
  if (!context) {
    return;
  }

  if (!hasManagementAccessForInteraction(interaction, context.guildConfig)) {
    await interaction.reply({ content: 'Only configured manager roles can remove attachments.', flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.showModal(buildRemoveAttachmentModal(context.task));
}

async function handleClearDeadlineInteraction(interaction: ButtonInteraction, taskId: number): Promise<void> {
  await deferEphemeral(interaction);
  const context = await resolveTaskContext(interaction, taskId);
  if (!context) {
    return;
  }

  const { guild, guildConfig, task, dashboardChannel } = context;
  if (!hasManagementAccessForInteraction(interaction, guildConfig)) {
    await interaction.editReply({ content: 'Only configured manager roles can clear task deadlines.' });
    return;
  }

  if (!task.deadlineAt) {
    await interaction.editReply({ content: `**${task.taskCode}** does not have a deadline set.` });
    return;
  }

  const updatedTask = await updateTaskWithMembers(task.id, { deadlineAt: null });
  await createTaskEvent({ taskId: updatedTask.id, actorDiscordUserId: interaction.user.id, type: 'DEADLINE_CLEARED', summary: 'Manager cleared the task deadline.' });
  await finalizeTaskInteraction({
    interaction,
    guildId: guild.id,
    guildName: guild.name,
    refreshedByUserId: interaction.user.id,
    dashboardChannel,
    guildConfig,
    task: updatedTask,
  });

  await showTaskPanelReply({
    interaction,
    taskId: updatedTask.id,
    mode: 'edit-hub',
    notice: `Cleared the deadline for **${updatedTask.taskCode}**.`,
  });
}

async function handleRepairTaskInteraction(interaction: ButtonInteraction, taskId: number): Promise<void> {
  await deferEphemeral(interaction);
  const context = await resolveTaskContext(interaction, taskId);
  if (!context) {
    return;
  }

  const { guild, guildConfig, task, dashboardChannel } = context;
  if (!hasManagementAccessForInteraction(interaction, guildConfig)) {
    await interaction.editReply({ content: 'Only configured manager roles can repair task cards.' });
    return;
  }

  const result = await syncTaskDashboard({
    guild,
    guildConfig,
    dashboardChannel,
    refreshedByUserId: interaction.user.id,
    taskCode: task.taskCode,
  });

  await interaction.editReply({
    content: [
      `Repair completed for **${task.taskCode}**.`,
      `Summary recreated: ${result.summaryRecreated ? 'Yes' : 'No'}`,
      `Tasks processed: ${result.tasksProcessed}`,
      `Task cards recreated: ${result.taskCardsRecreated}`,
      `Threads recreated: ${result.threadsRecreated}`,
    ].join('\n'),
  });
}

async function handleCreateTaskModalSubmit(interaction: ModalSubmitInteraction): Promise<void> {
  await deferEphemeral(interaction);
  if (!interaction.inGuild() || !interaction.guild) {
    await interaction.editReply({ content: 'Task creation is only available inside a server.' });
    return;
  }

  const guildConfig = await findGuildConfigByGuildId(interaction.guild.id);
  if (!guildConfig) {
    await interaction.editReply({ content: 'TaskBot is not configured yet. Run /setup first.' });
    return;
  }

  if (!hasManagementAccessForInteraction(interaction, guildConfig)) {
    await interaction.editReply({ content: 'Only configured manager roles can create tasks.' });
    return;
  }

  const dashboardChannel = interaction.guild.channels.cache.get(guildConfig.dashboardChannelId)
    ?? await interaction.guild.channels.fetch(guildConfig.dashboardChannelId).catch(() => null);
  if (!isTextChannel(dashboardChannel)) {
    await interaction.editReply({ content: 'The configured dashboard channel is unavailable or is not a text channel.' });
    return;
  }

  const requiredRole = parseRequiredRoleInput(interaction.fields.getTextInputValue('required_role'));
  if (!requiredRole) {
    await interaction.editReply({ content: 'Required role must be ADMIN, TECHNICIAN, or RESEARCHER.' });
    return;
  }

  const priorityInput = normalizeOptionalText(interaction.fields.getTextInputValue('priority'));
  const priority = priorityInput ? parsePriorityInput(priorityInput) : null;
  if (priorityInput && !priority) {
    await interaction.editReply({ content: 'Priority must be LOW, MEDIUM, HIGH, or URGENT.' });
    return;
  }

  const teamSize = parsePositiveIntegerInput(interaction.fields.getTextInputValue('team_size'));
  if (!teamSize || teamSize > 10) {
    await interaction.editReply({ content: 'Team size must be a number between 1 and 10.' });
    return;
  }

  const latestTask = await findLatestTaskForGuild(interaction.guild.id);
  const task = await createTask({
    guildId: interaction.guild.id,
    taskCode: formatTaskCode(parseNextTaskSequence(latestTask?.taskCode ?? null)),
    title: interaction.fields.getTextInputValue('title').trim(),
    description: interaction.fields.getTextInputValue('description').trim(),
    requiredRole,
    ...(priority ? { priority } : {}),
    createdByDiscordUserId: interaction.user.id,
    targetMemberCount: teamSize,
  });

  await createTaskStatusHistory({ taskId: task.id, actorDiscordUserId: interaction.user.id, toStatus: task.status, reason: 'Task created' });

  const taskCardMessage = await dashboardChannel.send({
    embeds: [buildTaskCardEmbed(task, { timezone: guildConfig.defaultTimezone })],
    components: buildTaskCardComponents(task),
  });

  const persistedTask = await updateTaskWithMembers(task.id, {
    taskMessageChannelId: dashboardChannel.id,
    taskMessageId: taskCardMessage.id,
  });

  await refreshDashboardSummary({
    guildId: interaction.guild.id,
    guildName: interaction.guild.name,
    refreshedByUserId: interaction.user.id,
    dashboardChannel,
    guildConfig,
  });

  await interaction.editReply({ content: `Created **${persistedTask.taskCode}** in <#${dashboardChannel.id}>.` });
}

async function handleEditTaskModalSubmit(interaction: ModalSubmitInteraction, taskId: number): Promise<void> {
  await deferEphemeral(interaction);
  const context = await resolveTaskContext(interaction, taskId);
  if (!context) {
    return;
  }

  const { guild, guildConfig, task, dashboardChannel } = context;
  if (!hasManagementAccessForInteraction(interaction, guildConfig)) {
    await interaction.editReply({ content: 'Only configured manager roles can edit task details.' });
    return;
  }

  const requiredRole = parseRequiredRoleInput(interaction.fields.getTextInputValue('required_role'));
  if (!requiredRole) {
    await interaction.editReply({ content: 'Required role must be ADMIN, TECHNICIAN, or RESEARCHER.' });
    return;
  }

  const priority = parsePriorityInput(interaction.fields.getTextInputValue('priority'));
  if (!priority) {
    await interaction.editReply({ content: 'Priority must be LOW, MEDIUM, HIGH, or URGENT.' });
    return;
  }

  const teamSize = parsePositiveIntegerInput(interaction.fields.getTextInputValue('team_size'));
  if (!teamSize || teamSize > 10) {
    await interaction.editReply({ content: 'Team size must be a number between 1 and 10.' });
    return;
  }

  if (teamSize < task.members.length) {
    await interaction.editReply({ content: `Team size cannot be smaller than the current member count (${task.members.length}).` });
    return;
  }

  const title = interaction.fields.getTextInputValue('title').trim();
  const description = interaction.fields.getTextInputValue('description').trim();

  const updatedTask = await updateTaskWithMembers(task.id, {
    title,
    description,
    requiredRole,
    priority,
    targetMemberCount: teamSize,
  });

  await createTaskEvent({
    taskId: updatedTask.id,
    actorDiscordUserId: interaction.user.id,
    type: 'TASK_UPDATED',
    summary: 'Manager updated task metadata.',
    details: `Title: ${title} | Role: ${requiredRole} | Priority: ${priority} | Team size: ${teamSize}`,
  });

  await finalizeTaskInteraction({
    interaction,
    guildId: guild.id,
    guildName: guild.name,
    refreshedByUserId: interaction.user.id,
    dashboardChannel,
    guildConfig,
    task: updatedTask,
  });

  await showTaskPanelReply({
    interaction,
    taskId: updatedTask.id,
    mode: 'edit-hub',
    notice: `Updated **${updatedTask.taskCode}** metadata successfully.`,
  });
}

async function handleSetDeadlineModalSubmit(interaction: ModalSubmitInteraction, taskId: number): Promise<void> {
  await deferEphemeral(interaction);
  const context = await resolveTaskContext(interaction, taskId);
  if (!context) {
    return;
  }

  const { guild, guildConfig, task, dashboardChannel } = context;
  if (!hasManagementAccessForInteraction(interaction, guildConfig)) {
    await interaction.editReply({ content: 'Only configured manager roles can set task deadlines.' });
    return;
  }

  const deadlineInput = interaction.fields.getTextInputValue('deadline');
  const deadlineAt = parseDeadlineInput(deadlineInput, {
    timezone: guildConfig.defaultTimezone,
    inputMode: guildConfig.defaultDateInputMode,
  });

  if (!deadlineAt) {
    await interaction.editReply({ content: `Invalid deadline. ${getDeadlineInputHint(guildConfig.defaultDateInputMode)}` });
    return;
  }

  const updatedTask = await updateTaskWithMembers(task.id, { deadlineAt });
  await createTaskEvent({ taskId: updatedTask.id, actorDiscordUserId: interaction.user.id, type: 'DEADLINE_SET', summary: 'Manager set or updated the task deadline.', details: deadlineInput });
  await finalizeTaskInteraction({
    interaction,
    guildId: guild.id,
    guildName: guild.name,
    refreshedByUserId: interaction.user.id,
    dashboardChannel,
    guildConfig,
    task: updatedTask,
  });

  await showTaskPanelReply({
    interaction,
    taskId: updatedTask.id,
    mode: 'edit-hub',
    notice: `Updated the deadline for **${updatedTask.taskCode}**.`,
  });
}

async function handleAddLinkModalSubmit(interaction: ModalSubmitInteraction, taskId: number): Promise<void> {
  await deferEphemeral(interaction);
  const context = await resolveTaskContext(interaction, taskId);
  if (!context) {
    return;
  }

  const { guild, guildConfig, task, dashboardChannel } = context;
  if (!hasManagementAccessForInteraction(interaction, guildConfig)) {
    await interaction.editReply({ content: 'Only configured manager roles can add task links.' });
    return;
  }

  const url = interaction.fields.getTextInputValue('url').trim();
  const label = normalizeOptionalText(interaction.fields.getTextInputValue('label'));
  if (!/^https?:\/\//i.test(url)) {
    await interaction.editReply({ content: 'Please provide a valid http/https URL.' });
    return;
  }

  const attachment = await createTaskAttachment({
    taskId: task.id,
    label,
    url,
    addedByDiscordUserId: interaction.user.id,
  });

  const updatedTask = await findTaskByIdWithMembers(task.id);
  if (!updatedTask) {
    await interaction.editReply({ content: `The link was saved, but ${task.taskCode} could not be reloaded.` });
    return;
  }

  await createTaskEvent({ taskId: updatedTask.id, actorDiscordUserId: interaction.user.id, type: 'ATTACHMENT_ADDED', summary: 'Manager added a task attachment.', details: `${attachment.id} • ${formatAttachmentLabel(attachment)}` });
  await finalizeTaskInteraction({
    interaction,
    guildId: guild.id,
    guildName: guild.name,
    refreshedByUserId: interaction.user.id,
    dashboardChannel,
    guildConfig,
    task: updatedTask,
  });

  await showTaskPanelReply({
    interaction,
    taskId: updatedTask.id,
    mode: 'attachments',
    notice: `Added attachment #${attachment.id} (${formatAttachmentLabel(attachment)}) to **${updatedTask.taskCode}**.`,
  });
}

async function handleRemoveAttachmentModalSubmit(interaction: ModalSubmitInteraction, taskId: number): Promise<void> {
  await deferEphemeral(interaction);
  const context = await resolveTaskContext(interaction, taskId);
  if (!context) {
    return;
  }

  const { guild, guildConfig, task, dashboardChannel } = context;
  if (!hasManagementAccessForInteraction(interaction, guildConfig)) {
    await interaction.editReply({ content: 'Only configured manager roles can remove attachments.' });
    return;
  }

  const attachmentId = parseAttachmentIdInput(interaction.fields.getTextInputValue('attachment_id'));
  if (!attachmentId) {
    await interaction.editReply({ content: 'Attachment ID is invalid. Enter a numeric ID like 12 or #12.' });
    return;
  }

  const removedAttachment = await removeTaskAttachment({ attachmentId, taskId: task.id });
  if (!removedAttachment) {
    await interaction.editReply({ content: `Could not find attachment #${attachmentId} on **${task.taskCode}**.` });
    return;
  }

  const updatedTask = await findTaskByIdWithMembers(task.id);
  if (!updatedTask) {
    await interaction.editReply({ content: `Removed attachment #${attachmentId}, but ${task.taskCode} could not be reloaded.` });
    return;
  }

  await createTaskEvent({ taskId: updatedTask.id, actorDiscordUserId: interaction.user.id, type: 'ATTACHMENT_REMOVED', summary: 'Manager removed a task attachment.', details: `${removedAttachment.id} • ${formatAttachmentLabel(removedAttachment)}` });
  await finalizeTaskInteraction({
    interaction,
    guildId: guild.id,
    guildName: guild.name,
    refreshedByUserId: interaction.user.id,
    dashboardChannel,
    guildConfig,
    task: updatedTask,
  });

  await showTaskPanelReply({
    interaction,
    taskId: updatedTask.id,
    mode: 'attachments',
    notice: `Removed attachment #${removedAttachment.id} (${formatAttachmentLabel(removedAttachment)}) from **${updatedTask.taskCode}**.`,
  });
}
