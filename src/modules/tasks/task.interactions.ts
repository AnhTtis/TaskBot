import {
  ActionRowBuilder,
  ChannelType,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type ModalSubmitInteraction,
  type RepliableInteraction,
  type TextChannel,
} from 'discord.js';

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
  isAdminOverride,
} from './task.policy.js';
import { buildTaskCardComponents, buildTaskCardEmbed } from './task.renderer.js';
import {
  addTaskMember,
  claimTask,
  clearTaskMembers,
  countActiveTasksForAssignee,
  createTaskStatusHistory,
  findTaskByIdWithMembers,
  transitionTaskWithMembers,
  updateTaskWithMembers,
} from './task.repository.js';

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

  if (namespace !== 'task' || action !== 'block-modal' || !taskIdPart) {
    await interaction.reply({
      content: `Unsupported task modal: ${interaction.customId}`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await handleBlockTaskSubmit(interaction, Number.parseInt(taskIdPart, 10));
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
        'Run `/task sync-dashboard` after fixing the channel/thread permissions.',
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

  await interaction.editReply({
    content: threadCreationFailed
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

  await interaction.editReply({
    content: `You joined the team for **${updatedTask.taskCode}**.`,
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

  await interaction.editReply({
    content: `Marked **${updatedTask.taskCode}** as Blocked.`,
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

  await interaction.editReply({
    content: `Moved **${updatedTask.taskCode}** back to In Progress.`,
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

  await interaction.editReply({
    content: `Moved **${updatedTask.taskCode}** to Review.${reviewerLine}`,
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

  await interaction.editReply({
    content: `Approved **${updatedTask.taskCode}** and marked it Done.`,
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

  await interaction.editReply({
    content: `Returned **${updatedTask.taskCode}** to In Progress.`,
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

  await interaction.editReply({
    content: `Reopened **${updatedTask.taskCode}** and moved it back to Backlog.`,
  });
}
