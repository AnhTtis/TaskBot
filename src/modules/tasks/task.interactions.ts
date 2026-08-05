import {
  ActionRowBuilder,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type InteractionEditReplyOptions,
  type InteractionReplyOptions,
  type ModalSubmitInteraction,
  type RepliableInteraction,
  type StringSelectMenuInteraction,
  type TextChannel,
} from 'discord.js';

import {
  buildDeadlineFromVietnamPreset,
  formatDeadlineForInput,
  getDeadlineInputHint,
  parseDeadlineInput,
} from '../../lib/task-datetime.js';
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
import {
  addTaskMember,
  claimTask,
  clearTaskMembers,
  countActiveTasksForAssignee,
  createTask,
  createTaskEvent,
  createTaskStatusHistory,
  findTaskByIdWithMembers,
  listTasksByStatus,
  listTasksForGuildWithMembers,
  removeTaskAttachment,
  transitionTaskWithMembers,
  updateTaskAttachment,
  updateTaskWithMembers,
} from './task.repository.js';
import {
  findTaskDeadlinePreset,
  formatAttachmentLabel,
  formatRoleMentions,
  formatTaskPublicLabel,
  isGuildTextChannel,
  normalizeOptionalText,
  parsePositiveIntegerInput,
  parsePriorityInput,
  parseRequiredRoleInput,
} from './task.helpers.js';
import { refreshTaskPresentation } from './task.refresh.js';
import { syncTaskDashboard } from './task.sync.js';
import {
  buildCreateTaskModal,
  buildDeadlineModal,
  buildEditAttachmentModal,
  buildEditTaskModal,
  buildTaskPanelPayload,
  getTaskActionAccess,
  type TaskPanelMode,
} from './task.ui.js';

type TaskInteraction = ButtonInteraction | ModalSubmitInteraction | StringSelectMenuInteraction;
type ResolvedTask = NonNullable<Awaited<ReturnType<typeof findTaskByIdWithMembers>>>;

const lastPrivateTaskPanelByUser = new Map<string, string>();

function buildPrivatePanelKey(interaction: RepliableInteraction): string | null {
  if (!('user' in interaction) || !interaction.inGuild()) {
    return null;
  }

  return `${interaction.guildId}:${interaction.user.id}`;
}

async function deleteTrackedPrivatePanel(interaction: RepliableInteraction): Promise<void> {
  const privatePanelKey = buildPrivatePanelKey(interaction);
  const previousMessageId = privatePanelKey ? lastPrivateTaskPanelByUser.get(privatePanelKey) : null;
  if (!privatePanelKey || !previousMessageId) {
    return;
  }

  await interaction.webhook.deleteMessage(previousMessageId).catch(() => null);
  lastPrivateTaskPanelByUser.delete(privatePanelKey);
}

async function editTrackedPrivateReply(
  interaction: RepliableInteraction,
  payload: InteractionEditReplyOptions,
) {
  const reply = await interaction.editReply(payload);
  const privatePanelKey = buildPrivatePanelKey(interaction);
  if (privatePanelKey) {
    lastPrivateTaskPanelByUser.set(privatePanelKey, reply.id);
  }

  return reply;
}

async function followUpTrackedPrivateReply(
  interaction: RepliableInteraction,
  payload: InteractionReplyOptions,
) {
  const reply = await interaction.followUp(payload);
  const privatePanelKey = buildPrivatePanelKey(interaction);
  if (privatePanelKey) {
    lastPrivateTaskPanelByUser.set(privatePanelKey, reply.id);
  }

  return reply;
}

async function sendInteractionMessage(
  interaction: RepliableInteraction,
  content: string,
): Promise<void> {
  if (interaction.deferred) {
    await editTrackedPrivateReply(interaction, { content });
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

  if (
    interaction.isMessageComponent()
    && interaction.message.flags.has(MessageFlags.Ephemeral)
  ) {
    await interaction.deferUpdate();
    return;
  }

  await deleteTrackedPrivatePanel(interaction);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
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
  if (!isGuildTextChannel(dashboardChannel)) {
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
  await refreshTaskPresentation({
    guild: options.dashboardChannel.guild,
    guildConfig: options.guildConfig,
    dashboardChannel: options.dashboardChannel,
    refreshedByUserId: options.refreshedByUserId,
    task: options.task,
  });
}

async function showTaskPanelReply(options: {
  readonly interaction: RepliableInteraction;
  readonly taskId: number;
  readonly mode?: TaskPanelMode;
  readonly notice?: string;
  readonly closeLabel?: string;
  readonly delivery?: 'edit' | 'follow_up';
}): Promise<void> {
  const context = await resolveTaskContext(options.interaction as TaskInteraction, options.taskId);
  if (!context) {
    return;
  }

  const payload = buildTaskPanelPayload({
    task: context.task,
    guildConfig: context.guildConfig,
    access: getInteractionAccess(
      options.interaction as TaskInteraction,
      context.task,
      context.guildConfig,
    ),
    mode: options.mode ?? 'overview',
    notice: options.notice ?? null,
    closeLabel: options.closeLabel,
  });

  if (options.delivery === 'follow_up') {
    await options.interaction.deleteReply().catch(() => null);
    await followUpTrackedPrivateReply(options.interaction, {
      flags: MessageFlags.Ephemeral,
      ...payload,
    });
    return;
  }

  await editTrackedPrivateReply(options.interaction, {
    content: null,
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
  const [namespace, action, taskIdPart, attachmentIdPart] = interaction.customId.split(':');

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
  const attachmentId = attachmentIdPart ? Number.parseInt(attachmentIdPart, 10) : null;

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
    case 'edit-task':
      await handleTaskEditPanelInteraction(interaction, taskId);
      return;
    case 'attachments':
      await handleTaskAttachmentsPanelInteraction(interaction, taskId);
      return;
    case 'attachment-upload-help':
      await handleAttachmentUploadHelpInteraction(interaction, taskId);
      return;
    case 'attachment-link-help':
      await handleAttachmentLinkHelpInteraction(interaction, taskId);
      return;
    case 'back-actions':
      await handleTaskActionsPanelInteraction(interaction, taskId);
      return;
    case 'back-edit':
      await handleTaskEditPanelInteraction(interaction, taskId);
      return;
    case 'exit':
      await handleTaskExitInteraction(interaction);
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
    case 'edit-details':
      await handleEditTaskPrompt(interaction, taskId);
      return;
    case 'set-deadline':
    case 'deadline-custom':
      await handleSetDeadlinePrompt(interaction, taskId);
      return;
    case 'attachment-edit':
      if (!attachmentId) {
        break;
      }
      await handleEditAttachmentPrompt(interaction, taskId, attachmentId);
      return;
    case 'attachment-delete':
      if (!attachmentId) {
        break;
      }
      await handleDeleteAttachmentInteraction(interaction, taskId, attachmentId);
      return;
    default:
      await interaction.reply({
        content: `Task action ${action} is not implemented yet.`,
        flags: MessageFlags.Ephemeral,
      });
    }
}

export async function handleTaskSelectMenuInteraction(
  interaction: StringSelectMenuInteraction,
): Promise<void> {
  const [namespace, action, taskIdPart] = interaction.customId.split(':');

  if (namespace !== 'task' || !action || !taskIdPart) {
    await interaction.reply({
      content: `Unsupported task selector: ${interaction.customId}`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const taskId = Number.parseInt(taskIdPart, 10);

  switch (action) {
    case 'set-role':
      await handleSetRoleSelectionInteraction(interaction, taskId);
      return;
    case 'set-priority':
      await handleSetPrioritySelectionInteraction(interaction, taskId);
      return;
    case 'set-deadline-preset':
      await handleSetDeadlinePresetInteraction(interaction, taskId);
      return;
    default:
      await interaction.reply({
        content: `Task selector ${action} is not implemented yet.`,
        flags: MessageFlags.Ephemeral,
      });
  }
}

export async function handleTaskModalSubmitInteraction(
  interaction: ModalSubmitInteraction,
): Promise<void> {
  const [namespace, action, taskIdPart, attachmentIdPart] = interaction.customId.split(':');

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
    case 'attachment-edit-modal':
      if (!taskIdPart || !attachmentIdPart) {
        break;
      }
      await handleEditAttachmentModalSubmit(
        interaction,
        Number.parseInt(taskIdPart, 10),
        Number.parseInt(attachmentIdPart, 10),
      );
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
      content: `You do not have the required role to claim ${formatTaskPublicLabel(task.taskNumber)}.`,
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
        `⚠️ Workspace repair needed for **${formatTaskPublicLabel(claimedTask.taskNumber)}**.`,
        `Team: ${formatTaskTeamMentions(claimedTask)}`,
        'The task is in progress, but the workspace thread could not be created automatically.',
        'Use the Reload Dashboard button after fixing the channel/thread permissions.',
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
    taskNumber: updatedTask.taskNumber,
    taskLabel: formatTaskPublicLabel(updatedTask.taskNumber),
    assigneeDiscordUserId: interaction.user.id,
    threadChannelId,
    threadCreationFailed,
  });

  await showTaskPanelReply({
    interaction,
    taskId: updatedTask.id,
    mode: 'overview',
    notice: threadCreationFailed
      ? `You claimed **${formatTaskPublicLabel(updatedTask.taskNumber)}** and started the task team, but the workspace thread could not be created automatically.`
      : `You claimed **${formatTaskPublicLabel(updatedTask.taskNumber)}**. Workspace thread: ${threadChannelId ? `<#${threadChannelId}>` : 'Unavailable'}`,
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
      content: `${formatTaskPublicLabel(task.taskNumber)} cannot be joined in its current state.`,
    });
    return;
  }

  if (!taskNeedsMoreMembers(task)) {
    await interaction.editReply({
      content: `${formatTaskPublicLabel(task.taskNumber)} already has enough team members.`,
    });
    return;
  }

  if (hasTaskMember(task, interaction.user.id)) {
    await interaction.editReply({
      content: `You are already on the team for ${formatTaskPublicLabel(task.taskNumber)}.`,
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
      content: `You do not have the required role to join ${formatTaskPublicLabel(task.taskNumber)}.`,
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
      content: `${formatTaskPublicLabel(task.taskNumber)} could not be updated because it no longer exists.`,
    });
    return;
  }

  if (joinResult.status === 'not_joinable') {
    await interaction.editReply({
      content: `${formatTaskPublicLabel(joinResult.task.taskNumber)} cannot be joined in its current state.`,
    });
    return;
  }

  if (joinResult.status === 'already_member') {
    await interaction.editReply({
      content: `You are already on the team for ${formatTaskPublicLabel(joinResult.task.taskNumber)}.`,
    });
    return;
  }

  if (joinResult.status === 'full') {
    await interaction.editReply({
      content: `${formatTaskPublicLabel(joinResult.task.taskNumber)} already has enough team members.`,
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
    notice: `You joined the team for **${formatTaskPublicLabel(updatedTask.taskNumber)}**.`,
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
      content: `${formatTaskPublicLabel(task.taskNumber)} is not currently in progress.`,
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
      content: `${formatTaskPublicLabel(task.taskNumber)} changed before the blocked update could be applied.`,
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
    notice: `Marked **${formatTaskPublicLabel(updatedTask.taskNumber)}** as Blocked.`,
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
      content: `${formatTaskPublicLabel(task.taskNumber)} is not currently blocked.`,
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
      content: `${formatTaskPublicLabel(task.taskNumber)} changed before the unblock update could be applied.`,
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
    notice: `Moved **${formatTaskPublicLabel(updatedTask.taskNumber)}** back to In Progress.`,
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
      content: `${formatTaskPublicLabel(task.taskNumber)} must be In Progress before requesting review.`,
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
      content: `${formatTaskPublicLabel(task.taskNumber)} changed before review could be requested.`,
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
    notice: `Moved **${formatTaskPublicLabel(updatedTask.taskNumber)}** to Review.${reviewerLine}`,
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
      content: `${formatTaskPublicLabel(task.taskNumber)} is not waiting for review.`,
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
      content: `${formatTaskPublicLabel(task.taskNumber)} changed before approval could be applied.`,
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
    notice: `Approved **${formatTaskPublicLabel(updatedTask.taskNumber)}** and marked it Done.`,
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
      content: `${formatTaskPublicLabel(task.taskNumber)} is not waiting for review.`,
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
      content: `${formatTaskPublicLabel(task.taskNumber)} changed before it could be returned to In Progress.`,
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
    notice: `Returned **${formatTaskPublicLabel(updatedTask.taskNumber)}** to In Progress.`,
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
      content: `${formatTaskPublicLabel(task.taskNumber)} is not currently done.`,
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
      content: `${formatTaskPublicLabel(task.taskNumber)} changed before it could be reopened.`,
    });
    return;
  }

  await clearTaskMembers(reopenedTask.id);
  const updatedTask = await findTaskByIdWithMembers(reopenedTask.id);
  if (!updatedTask) {
    await interaction.editReply({
      content: `${formatTaskPublicLabel(task.taskNumber)} disappeared while it was being reopened.`,
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
    notice: `Reopened **${formatTaskPublicLabel(updatedTask.taskNumber)}** and moved it back to Backlog.`,
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

function getInteractionAccess(
  interaction: TaskInteraction,
  task: ResolvedTask,
  guildConfig: NonNullable<Awaited<ReturnType<typeof findGuildConfigByGuildId>>>,
) {
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

  return getTaskActionAccess({
    task,
    userId: interaction.user.id,
    manager: hasManagementAccessForInteraction(interaction, guildConfig),
    reviewer: canReviewFromInteraction(interaction, guildConfig),
    canClaim,
    canManageProgress,
  });
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
    case 'reload-dashboard': {
      await deferEphemeral(interaction);
      if (!hasManagementAccessForInteraction(interaction, guildConfig)) {
        await interaction.editReply({ content: 'Only configured manager roles can reload the dashboard.' });
        return;
      }

      const dashboardChannel = interaction.guild.channels.cache.get(guildConfig.dashboardChannelId)
        ?? await interaction.guild.channels.fetch(guildConfig.dashboardChannelId).catch(() => null);
      if (!isGuildTextChannel(dashboardChannel)) {
        await interaction.editReply({ content: 'The configured dashboard channel is unavailable or is not a text channel.' });
        return;
      }

      const result = await syncTaskDashboard({
        guild: interaction.guild,
        guildConfig,
        dashboardChannel,
        refreshedByUserId: interaction.user.id,
        taskNumber: null,
      });

      await editTrackedPrivateReply(interaction, {
        content: [
          `Dashboard reloaded for **${interaction.guild.name}**.`,
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
            ? reviewTasks.slice(0, 15).map((task) => `- **${formatTaskPublicLabel(task.taskNumber)}** — ${task.title}`).join('\n')
            : 'There are no tasks waiting for review right now.',
        )
        .setFooter({ text: 'Open a task card and use its private controls to review a specific task.' });

      await editTrackedPrivateReply(interaction, { embeds: [embed], components: [] });
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
            ? myTasks.slice(0, 15).map((task) => `- **${formatTaskPublicLabel(task.taskNumber)}** — ${task.title} (${task.status})`).join('\n')
            : 'You do not have any active tasks right now.',
        )
        .setFooter({ text: 'Open a task card and use its private controls for task-specific actions.' });

      await editTrackedPrivateReply(interaction, { embeds: [embed], components: [] });
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

async function handleTaskEditPanelInteraction(
  interaction: ButtonInteraction,
  taskId: number,
): Promise<void> {
  await deferEphemeral(interaction);

  const context = await resolveTaskContext(interaction, taskId);
  if (!context) {
    return;
  }

  if (!hasManagementAccessForInteraction(interaction, context.guildConfig)) {
    await interaction.editReply({ content: 'Only configured manager roles can edit this task.' });
    return;
  }

  await showTaskPanelReply({ interaction, taskId, mode: 'edit' });
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

async function handleAttachmentUploadHelpInteraction(
  interaction: ButtonInteraction,
  taskId: number,
): Promise<void> {
  await deferEphemeral(interaction);

  const context = await resolveTaskContext(interaction, taskId);
  if (!context) {
    return;
  }

  if (!hasManagementAccessForInteraction(interaction, context.guildConfig)) {
    await interaction.editReply({ content: 'Only configured manager roles can upload task files.' });
    return;
  }

  await showTaskPanelReply({
    interaction,
    taskId,
    mode: 'attachments',
    notice: [
      `Copy this command: \`/task add-attachment task_code:${context.task.taskNumber}\``,
      `Target task: **${formatTaskPublicLabel(context.task.taskNumber)}**.`,
      'Then attach the file in Discord before you send the slash command.',
      'Optional: fill the label field if you want extra context.',
    ].join('\n'),
  });
}

async function handleAttachmentLinkHelpInteraction(
  interaction: ButtonInteraction,
  taskId: number,
): Promise<void> {
  await deferEphemeral(interaction);

  const context = await resolveTaskContext(interaction, taskId);
  if (!context) {
    return;
  }

  if (!hasManagementAccessForInteraction(interaction, context.guildConfig)) {
    await interaction.editReply({ content: 'Only configured manager roles can add attachment links.' });
    return;
  }

  await showTaskPanelReply({
    interaction,
    taskId,
    mode: 'attachments',
    notice: [
      `Copy this command: \`/task add-attachment task_code:${context.task.taskNumber} url:https://example.com\``,
      `Target task: **${formatTaskPublicLabel(context.task.taskNumber)}**.`,
      'Replace the example URL before you send the slash command.',
      'Optional: fill the label field if you want extra context.',
    ].join('\n'),
  });
}

async function handleTaskExitInteraction(interaction: ButtonInteraction): Promise<void> {
  const privatePanelKey = buildPrivatePanelKey(interaction);
  if (privatePanelKey) {
    lastPrivateTaskPanelByUser.delete(privatePanelKey);
  }

  await interaction.deferUpdate();
  await interaction.deleteReply().catch(async () => {
    await interaction.editReply({ content: 'Closed.', embeds: [], components: [] });
  });
}

async function handleSetRoleSelectionInteraction(
  interaction: StringSelectMenuInteraction,
  taskId: number,
): Promise<void> {
  await deferEphemeral(interaction);
  const context = await resolveTaskContext(interaction, taskId);
  if (!context) {
    return;
  }

  const { guild, guildConfig, task, dashboardChannel } = context;
  if (!hasManagementAccessForInteraction(interaction, guildConfig)) {
    await interaction.editReply({ content: 'Only configured manager roles can change the required role.' });
    return;
  }

  const requiredRole = parseRequiredRoleInput(interaction.values[0] ?? '');
  if (!requiredRole) {
    await interaction.editReply({ content: 'Required role must be ADMIN, TECHNICIAN, or RESEARCHER.' });
    return;
  }

  const updatedTask = await updateTaskWithMembers(task.id, { requiredRole });
  await createTaskEvent({
    taskId: updatedTask.id,
    actorDiscordUserId: interaction.user.id,
    type: 'TASK_UPDATED',
    summary: 'Manager updated the required role.',
    details: `Required role: ${requiredRole}`,
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
    mode: 'edit',
    notice: `Required role updated to **${requiredRole}** on **${formatTaskPublicLabel(updatedTask.taskNumber)}**.`,
  });
}

async function handleSetPrioritySelectionInteraction(
  interaction: StringSelectMenuInteraction,
  taskId: number,
): Promise<void> {
  await deferEphemeral(interaction);
  const context = await resolveTaskContext(interaction, taskId);
  if (!context) {
    return;
  }

  const { guild, guildConfig, task, dashboardChannel } = context;
  if (!hasManagementAccessForInteraction(interaction, guildConfig)) {
    await interaction.editReply({ content: 'Only configured manager roles can change task priority.' });
    return;
  }

  const priority = parsePriorityInput(interaction.values[0] ?? '');
  if (!priority) {
    await interaction.editReply({ content: 'Priority must be LOW, MEDIUM, HIGH, or URGENT.' });
    return;
  }

  const updatedTask = await updateTaskWithMembers(task.id, { priority });
  await createTaskEvent({
    taskId: updatedTask.id,
    actorDiscordUserId: interaction.user.id,
    type: 'TASK_UPDATED',
    summary: 'Manager updated task priority.',
    details: `Priority: ${priority}`,
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
    mode: 'edit',
    notice: `Priority updated to **${priority}** on **${formatTaskPublicLabel(updatedTask.taskNumber)}**.`,
  });
}

async function handleSetDeadlinePresetInteraction(
  interaction: StringSelectMenuInteraction,
  taskId: number,
): Promise<void> {
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

  const selectedValue = interaction.values[0] ?? '';
  if (selectedValue === 'clear') {
    const updatedTask = await updateTaskWithMembers(task.id, { deadlineAt: null });
    await createTaskEvent({
      taskId: updatedTask.id,
      actorDiscordUserId: interaction.user.id,
      type: 'DEADLINE_CLEARED',
      summary: 'Manager cleared the task deadline.',
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
      mode: 'edit',
      notice: `Cleared the deadline for **${formatTaskPublicLabel(updatedTask.taskNumber)}**.`,
    });
    return;
  }

  const preset = findTaskDeadlinePreset(selectedValue);
  if (!preset) {
    await interaction.editReply({ content: 'That deadline preset is no longer available.' });
    return;
  }

  const deadlineAt = buildDeadlineFromVietnamPreset({
    dayOffset: preset.dayOffset,
    hour: preset.hour,
    minute: preset.minute,
  });

  const updatedTask = await updateTaskWithMembers(task.id, { deadlineAt });
  await createTaskEvent({
    taskId: updatedTask.id,
    actorDiscordUserId: interaction.user.id,
    type: 'DEADLINE_SET',
    summary: 'Manager set the task deadline from a preset.',
    details: formatDeadlineForInput(deadlineAt),
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
    mode: 'edit',
    notice: `Deadline updated to **${formatDeadlineForInput(deadlineAt)}** on **${formatTaskPublicLabel(updatedTask.taskNumber)}**.`,
  });
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

async function handleEditAttachmentPrompt(
  interaction: ButtonInteraction,
  taskId: number,
  attachmentId: number,
): Promise<void> {
  const context = await resolveTaskContext(interaction, taskId);
  if (!context) {
    return;
  }

  if (!hasManagementAccessForInteraction(interaction, context.guildConfig)) {
    await interaction.reply({ content: 'Only configured manager roles can edit attachments.', flags: MessageFlags.Ephemeral });
    return;
  }

  const modal = buildEditAttachmentModal(context.task, attachmentId);
  if (!modal) {
    await interaction.reply({ content: `Attachment #${attachmentId} could not be found on this task.`, flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.showModal(modal);
}

async function handleDeleteAttachmentInteraction(
  interaction: ButtonInteraction,
  taskId: number,
  attachmentId: number,
): Promise<void> {
  await deferEphemeral(interaction);
  const context = await resolveTaskContext(interaction, taskId);
  if (!context) {
    return;
  }

  const { guild, guildConfig, task, dashboardChannel } = context;
  if (!hasManagementAccessForInteraction(interaction, guildConfig)) {
    await interaction.editReply({ content: 'Only configured manager roles can delete attachments.' });
    return;
  }

  const removedAttachment = await removeTaskAttachment({ attachmentId, taskId: task.id });
  if (!removedAttachment) {
    await interaction.editReply({ content: `Attachment #${attachmentId} could not be found on **${formatTaskPublicLabel(task.taskNumber)}**.` });
    return;
  }

  const updatedTask = await findTaskByIdWithMembers(task.id);
  if (!updatedTask) {
    await interaction.editReply({ content: `Attachment #${attachmentId} was deleted, but ${formatTaskPublicLabel(task.taskNumber)} could not be reloaded.` });
    return;
  }

  await createTaskEvent({
    taskId: updatedTask.id,
    actorDiscordUserId: interaction.user.id,
    type: 'ATTACHMENT_REMOVED',
    summary: 'Manager removed a task attachment.',
    details: `${removedAttachment.id} • ${formatAttachmentLabel(removedAttachment)}`,
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
    mode: 'edit',
    notice: `Deleted attachment #${removedAttachment.id} from **${formatTaskPublicLabel(updatedTask.taskNumber)}**.`,
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
  if (!isGuildTextChannel(dashboardChannel)) {
    await interaction.editReply({ content: 'The configured dashboard channel is unavailable or is not a text channel.' });
    return;
  }

  const teamSize = parsePositiveIntegerInput(interaction.fields.getTextInputValue('team_size'));
  if (!teamSize || teamSize > 10) {
    await interaction.editReply({ content: 'Team size must be a number between 1 and 10.' });
    return;
  }

  const task = await createTask({
    guildId: interaction.guild.id,
    title: interaction.fields.getTextInputValue('title').trim(),
    description: interaction.fields.getTextInputValue('description').trim(),
    requiredRole: 'RESEARCHER',
    priority: 'MEDIUM',
    createdByDiscordUserId: interaction.user.id,
    targetMemberCount: teamSize,
  });

  await createTaskStatusHistory({ taskId: task.id, actorDiscordUserId: interaction.user.id, toStatus: task.status, reason: 'Task created' });

  const createdTask = await findTaskByIdWithMembers(task.id);
  if (!createdTask) {
    await interaction.editReply({ content: 'The task was created, but it could not be reloaded.' });
    return;
  }

  const persistedTask = await refreshTaskPresentation({
    guild: interaction.guild,
    guildConfig,
    dashboardChannel,
    refreshedByUserId: interaction.user.id,
    task: createdTask,
  });

  await showTaskPanelReply({
    interaction,
    taskId: persistedTask.id,
    mode: 'edit',
    delivery: 'follow_up',
    closeLabel: 'Done',
    notice: [
      `Created **${formatTaskPublicLabel(persistedTask.taskNumber)}** in <#${persistedTask.taskMessageChannelId ?? dashboardChannel.id}>.`,
      'The public task card is now live.',
      'Use this private editor only to finish tuning the task right after creation.',
      '',
      'Current defaults:',
      '- Required Role: **RESEARCHER**',
      '- Priority: **MEDIUM**',
      '- Deadline: **Not set**',
      '',
      'Suggested next steps:',
      '1. Use the role dropdown to choose who can claim the task.',
      '2. Use the priority dropdown to set urgency.',
      '3. Use a deadline preset or **Custom Deadline** for an exact time.',
      '4. Open **Attachments** if you want to add files or links now.',
      '5. Press **Done** when you finish this first-round setup.',
    ].join('\n'),
  });
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
    targetMemberCount: teamSize,
  });

  await createTaskEvent({
    taskId: updatedTask.id,
    actorDiscordUserId: interaction.user.id,
    type: 'TASK_UPDATED',
    summary: 'Manager updated task metadata.',
    details: `Title: ${title} | Team size: ${teamSize}`,
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
    mode: 'edit',
    notice: `Updated **${formatTaskPublicLabel(updatedTask.taskNumber)}** metadata successfully.`,
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

  const deadlineInput = normalizeOptionalText(interaction.fields.getTextInputValue('deadline'));
  if (!deadlineInput) {
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
      mode: 'edit',
      notice: `Cleared the deadline for **${formatTaskPublicLabel(updatedTask.taskNumber)}**.`,
    });
    return;
  }

  const deadlineAt = parseDeadlineInput(deadlineInput);
  if (!deadlineAt) {
    await interaction.editReply({ content: `Invalid deadline. ${getDeadlineInputHint()}` });
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
    mode: 'edit',
    notice: `Updated the deadline for **${formatTaskPublicLabel(updatedTask.taskNumber)}**.`,
  });
}

async function handleEditAttachmentModalSubmit(
  interaction: ModalSubmitInteraction,
  taskId: number,
  attachmentId: number,
): Promise<void> {
  await deferEphemeral(interaction);
  const context = await resolveTaskContext(interaction, taskId);
  if (!context) {
    return;
  }

  const { guild, guildConfig, task, dashboardChannel } = context;
  if (!hasManagementAccessForInteraction(interaction, guildConfig)) {
    await interaction.editReply({ content: 'Only configured manager roles can edit attachments.' });
    return;
  }

  const currentAttachment = task.attachments.find((item) => item.id === attachmentId);
  if (!currentAttachment) {
    await interaction.editReply({ content: `Attachment #${attachmentId} could not be found on **${formatTaskPublicLabel(task.taskNumber)}**.` });
    return;
  }

  const label = normalizeOptionalText(interaction.fields.getTextInputValue('label'));
  const nextUrl = currentAttachment.fileName
    ? undefined
    : interaction.fields.getTextInputValue('url').trim();

  if (nextUrl !== undefined && !/^https?:\/\//i.test(nextUrl)) {
    await interaction.editReply({ content: 'Please provide a valid http/https URL.' });
    return;
  }

  const updatedAttachment = await updateTaskAttachment({
    attachmentId,
    taskId: task.id,
    ...(nextUrl !== undefined ? { url: nextUrl } : {}),
    label,
  });

  if (!updatedAttachment) {
    await interaction.editReply({ content: `Attachment #${attachmentId} could not be updated on **${formatTaskPublicLabel(task.taskNumber)}**.` });
    return;
  }

  const updatedTask = await findTaskByIdWithMembers(task.id);
  if (!updatedTask) {
    await interaction.editReply({ content: `Attachment #${attachmentId} was updated, but ${formatTaskPublicLabel(task.taskNumber)} could not be reloaded.` });
    return;
  }

  await createTaskEvent({
    taskId: updatedTask.id,
    actorDiscordUserId: interaction.user.id,
    type: 'ATTACHMENT_UPDATED',
    summary: 'Manager edited a task attachment.',
    details: `${updatedAttachment.id} • ${formatAttachmentLabel(updatedAttachment)}`,
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
    mode: 'edit',
    notice: `Updated attachment #${updatedAttachment.id} on **${formatTaskPublicLabel(updatedTask.taskNumber)}**.`,
  });
}
