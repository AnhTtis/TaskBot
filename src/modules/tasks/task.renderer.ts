import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  escapeMarkdown,
} from 'discord.js';
import type { DateInputMode, RequiredRole, Task, TaskPriority, TaskStatus } from '@prisma/client';

import { formatDeadlineForDisplay } from '../../lib/task-datetime.js';

import {
  formatTaskTeamMentions,
  formatTaskTeamSummary,
  getTaskMemberCount,
  getTaskRemainingSlots,
  getTaskTargetMemberCount,
  taskNeedsMoreMembers,
} from './task.members.js';
import type {
  DashboardSummaryCounts,
  DashboardSummaryTask,
  TaskWithMembers,
} from './task.types.js';

type BuildDashboardSummaryEmbedInput = {
  readonly guildName: string;
  readonly refreshedByUserId: string;
  readonly managerRoleIds: readonly string[];
  readonly reviewerRoleIds: readonly string[];
  readonly feedChannelId: string;
  readonly archiveChannelId: string | null;
  readonly maxActiveTasksPerUser: number;
  readonly defaultThreadAutoArchiveMinutes: number;
  readonly defaultTimezone: string;
  readonly defaultDateInputMode: DateInputMode;
  readonly tasks: readonly DashboardSummaryTask[];
};

type TaskCardTask = Task | TaskWithMembers;

type TaskCardRenderOptions = {
  readonly timezone?: string;
};

const SECTION_DIVIDER = '────────────────────────';

function wrapSection(lines: readonly string[]): string {
  return [SECTION_DIVIDER, '', ...lines, '', SECTION_DIVIDER].join('\n');
}

function formatThreadArchiveLabel(minutes: number): string {
  switch (minutes) {
    case 60:
      return '1 hour';
    case 1440:
      return '24 hours';
    case 4320:
      return '3 days';
    case 10080:
      return '7 days';
    default:
      return `${minutes} minutes`;
  }
}

function formatRoleMentions(roleIds: readonly string[], fallback: string): string {
  return roleIds.length > 0
    ? roleIds.map((roleId) => `<@&${roleId}>`).join(', ')
    : fallback;
}

function formatDateInputMode(inputMode: DateInputMode): string {
  switch (inputMode) {
    case 'ISO_ONLY':
      return 'ISO only';
    case 'VIETNAM_ONLY':
      return 'Việt Nam only';
    case 'VIETNAM_OR_ISO':
      return 'Việt Nam + ISO';
  }
}

function hasAttachments(task: TaskCardTask): task is TaskWithMembers {
  return 'attachments' in task && Array.isArray(task.attachments);
}

function formatAttachmentDisplayName(task: TaskWithMembers['attachments'][number]): string {
  const fileName = task.fileName?.trim();
  const label = task.label?.trim();

  if (fileName) {
    return fileName;
  }

  if (label) {
    return label;
  }

  return `Attachment #${task.id}`;
}

function formatAttachmentLine(task: TaskWithMembers['attachments'][number]): string {
  const fileName = task.fileName?.trim();
  const label = task.label?.trim();
  const parts = [`#${task.id}`, `**${escapeMarkdown(formatAttachmentDisplayName(task))}**`];

  if (fileName && label) {
    parts.push(`Note: ${escapeMarkdown(label)}`);
  }

  parts.push(`[Open](${task.url})`);
  return parts.join(' • ');
}

function joinLinesWithFieldLimit(lines: readonly string[], maxLength = 1024): string {
  const visibleLines: string[] = [];

  for (const line of lines) {
    const candidate = visibleLines.length === 0 ? line : `${visibleLines.join('\n')}\n${line}`;
    if (candidate.length > maxLength) {
      break;
    }

    visibleLines.push(line);
  }

  if (visibleLines.length === lines.length) {
    return visibleLines.join('\n');
  }

  const remainingCount = lines.length - visibleLines.length;
  const suffix = `…and ${remainingCount} more attachment${remainingCount === 1 ? '' : 's'}.`;
  if (visibleLines.length === 0) {
    return suffix;
  }

  const baseText = visibleLines.join('\n');
  const suffixedText = `${baseText}\n${suffix}`;
  if (suffixedText.length <= maxLength) {
    return suffixedText;
  }

  return baseText.slice(0, maxLength - suffix.length - 1) + `\n${suffix}`;
}

function formatRequiredRole(role: RequiredRole): string {
  switch (role) {
    case 'ADMIN':
      return 'Admin';
    case 'TECHNICIAN':
      return 'Technician';
    case 'RESEARCHER':
      return 'Researcher';
  }
}

function formatTaskStatusBadge(status: TaskStatus): string {
  switch (status) {
    case 'BACKLOG':
      return '📝 Backlog';
    case 'IN_PROGRESS':
      return '⚙️ In Progress';
    case 'BLOCKED':
      return '⛔ Blocked';
    case 'REVIEW':
      return '👀 Review';
    case 'DONE':
      return '✅ Done';
  }
}

function formatTaskPriorityBadge(priority: TaskPriority): string {
  switch (priority) {
    case 'LOW':
      return '🟢 Low';
    case 'MEDIUM':
      return '🟡 Medium';
    case 'HIGH':
      return '🟠 High';
    case 'URGENT':
      return '🔴 Urgent';
  }
}

function getTaskCardColor(status: TaskStatus): number {
  switch (status) {
    case 'BACKLOG':
      return 0x5865f2;
    case 'IN_PROGRESS':
      return 0x57f287;
    case 'BLOCKED':
      return 0xed4245;
    case 'REVIEW':
      return 0xfee75c;
    case 'DONE':
      return 0x3ba55c;
  }
}

function buildWorkspaceButton(task: TaskCardTask): ButtonBuilder | null {
  if (!task.threadChannelId) {
    return null;
  }

  return new ButtonBuilder()
    .setLabel('Open Workspace')
    .setEmoji('🔗')
    .setStyle(ButtonStyle.Link)
    .setURL(`https://discord.com/channels/${task.guildId}/${task.threadChannelId}`);
}

function summarizeCounts(tasks: readonly DashboardSummaryTask[]): DashboardSummaryCounts {
  const counts: DashboardSummaryCounts = {
    backlog: 0,
    inProgress: 0,
    blocked: 0,
    review: 0,
    done: 0,
  };

  for (const task of tasks) {
    switch (task.status) {
      case 'BACKLOG':
        counts.backlog += 1;
        break;
      case 'IN_PROGRESS':
        counts.inProgress += 1;
        break;
      case 'BLOCKED':
        counts.blocked += 1;
        break;
      case 'REVIEW':
        counts.review += 1;
        break;
      case 'DONE':
        counts.done += 1;
        break;
    }
  }

  return counts;
}

function truncateLines(lines: string[], maxLines: number): string[] {
  if (lines.length <= maxLines) {
    return lines;
  }

  return [...lines.slice(0, maxLines), `…and ${lines.length - maxLines} more.`];
}

function buildAttentionLines(tasks: readonly DashboardSummaryTask[]): string[] {
  const now = Date.now();
  const blocked = tasks.filter((task) => task.status === 'BLOCKED').map((task) => task.taskCode);
  const review = tasks.filter((task) => task.status === 'REVIEW').map((task) => task.taskCode);
  const overdue = tasks
    .filter(
      (task) =>
        task.status !== 'DONE' &&
        task.deadlineAt !== null &&
        task.deadlineAt.getTime() < now,
    )
    .map((task) => task.taskCode);
  const helpNeeded = tasks
    .filter(
      (task) =>
        (task.status === 'IN_PROGRESS' || task.status === 'BLOCKED') && taskNeedsMoreMembers(task),
    )
    .map((task) => `${task.taskCode} (${getTaskMemberCount(task)}/${getTaskTargetMemberCount(task)})`);

  const lines = [
    `⛔ Blocked: ${blocked.length > 0 ? blocked.join(', ') : 'None'}`,
    `👀 Review queue: ${review.length > 0 ? review.join(', ') : 'None'}`,
    `⚠️ Overdue: ${overdue.length > 0 ? overdue.join(', ') : 'None'}`,
    `🤝 Need help: ${helpNeeded.length > 0 ? helpNeeded.join(', ') : 'None'}`,
  ];

  return truncateLines(lines, 6);
}

function buildActiveTaskLines(tasks: readonly DashboardSummaryTask[]): string[] {
  const activeTasks = tasks.filter((task) =>
    task.status === 'IN_PROGRESS' || task.status === 'BLOCKED' || task.status === 'REVIEW',
  );

  if (activeTasks.length === 0) {
    return ['No active tasks.'];
  }

  return truncateLines(
    activeTasks.map(
      (task) => `${task.taskCode} — ${getTaskMemberCount(task)}/${getTaskTargetMemberCount(task)} • ${formatTaskTeamMentions(task)}`,
    ),
    8,
  );
}

export function buildDashboardSummaryEmbed(
  input: BuildDashboardSummaryEmbedInput,
): EmbedBuilder {
  const counts = summarizeCounts(input.tasks);
  const totalTasks = input.tasks.length;

  return new EmbedBuilder()
    .setTitle(`📋 ${input.guildName} • Task Dashboard`)
    .setColor(0x5865f2)
    .setDescription(
      [
        `**Total tasks:** ${totalTasks}`,
        '',
        SECTION_DIVIDER,
        '',
        `📝 Backlog: **${counts.backlog}**`,
        `⚙️ In Progress: **${counts.inProgress}**`,
        `⛔ Blocked: **${counts.blocked}**`,
        `👀 Review: **${counts.review}**`,
        `✅ Done: **${counts.done}**`,
        '',
        SECTION_DIVIDER,
        '',
        'Use the buttons below to open your private task controls.',
      ].join('\n'),
    )
    .addFields(
      {
        name: '🚨 Needs attention',
        value: wrapSection(buildAttentionLines(input.tasks)),
        inline: false,
      },
      {
        name: '👥 Active teams',
        value: wrapSection(buildActiveTaskLines(input.tasks)),
        inline: false,
      },
      {
        name: '⚙️ Configuration',
        value: wrapSection([
          `Refreshed by: <@${input.refreshedByUserId}>`,
          `Managers: ${formatRoleMentions(input.managerRoleIds, 'Not set')}`,
          `Reviewer roles: ${formatRoleMentions(input.reviewerRoleIds, 'Managers only')}`,
          `Feed: <#${input.feedChannelId}>`,
          `Archive: ${input.archiveChannelId ? `<#${input.archiveChannelId}>` : 'Not set'}`,
          `Max active tasks: ${input.maxActiveTasksPerUser}`,
          `Thread auto-archive: ${formatThreadArchiveLabel(input.defaultThreadAutoArchiveMinutes)}`,
          `Default timezone: ${input.defaultTimezone}`,
          `Deadline input: ${formatDateInputMode(input.defaultDateInputMode)}`,
        ]),
        inline: false,
      },
    )
    .setFooter({
      text: 'TaskBot dashboard',
    })
    .setTimestamp();
}

export function buildDashboardSummaryComponents(): Array<ActionRowBuilder<ButtonBuilder>> {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId('dashboard:my-tasks')
        .setLabel('My Tasks')
        .setEmoji('📌')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('dashboard:review-queue')
        .setLabel('Review Queue')
        .setEmoji('👀')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('dashboard:create-task')
        .setLabel('Create Task')
        .setEmoji('➕')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('dashboard:manager-console')
        .setLabel('Manager Console')
        .setEmoji('🛠️')
        .setStyle(ButtonStyle.Secondary),
    ),
  ];
}

export function buildTaskCardEmbed(
  task: TaskCardTask,
  options: TaskCardRenderOptions = {},
): EmbedBuilder {
  const remainingSlots = getTaskRemainingSlots(task);
  const timezone = options.timezone ?? 'Asia/Ho_Chi_Minh';
  const fields = [
    {
      name: 'Status',
      value: formatTaskStatusBadge(task.status),
      inline: true,
    },
    {
      name: 'Role',
      value: formatRequiredRole(task.requiredRole),
      inline: true,
    },
    {
      name: 'Priority',
      value: formatTaskPriorityBadge(task.priority),
      inline: true,
    },
    {
      name: 'Team',
      value: formatTaskTeamMentions(task),
      inline: false,
    },
    {
      name: 'Capacity',
      value: remainingSlots > 0
        ? `${formatTaskTeamSummary(task)} • Needs ${remainingSlots} more`
        : `${formatTaskTeamSummary(task)} • Full`,
      inline: false,
    },
    {
      name: 'Created by',
      value: `<@${task.createdByDiscordUserId}>`,
      inline: true,
    },
    {
      name: 'Deadline',
      value: formatDeadlineForDisplay(task.deadlineAt ?? null, timezone),
      inline: true,
    },
  ];

  if (hasAttachments(task) && task.attachments.length > 0) {
    fields.push({
      name: `Attachments (${task.attachments.length})`,
      value: joinLinesWithFieldLimit(task.attachments.map((attachment) => formatAttachmentLine(attachment))),
      inline: false,
    });
  }

  if (task.threadChannelId) {
    fields.push({
      name: 'Workspace',
      value: `<#${task.threadChannelId}>`,
      inline: false,
    });
  }

  if (task.blockedReason) {
    fields.push({
      name: 'Blocked reason',
      value: task.blockedReason,
      inline: false,
    });
  }

  return new EmbedBuilder()
    .setTitle(`${task.taskCode} • ${task.title}`)
    .setColor(getTaskCardColor(task.status))
    .setDescription([
      '### Task brief',
      task.description,
      '',
      SECTION_DIVIDER,
      '',
      'Use **Task Actions** below to open your private controls for this task.',
    ].join('\n'))
    .addFields(fields)
    .setFooter({
      text: `Task ID ${task.id} • Configured managers and reviewers handle approvals`,
    })
    .setTimestamp(task.updatedAt);
}

export function buildTaskCardComponents(
  task: TaskCardTask,
): Array<ActionRowBuilder<ButtonBuilder>> {
  const primaryRow = new ActionRowBuilder<ButtonBuilder>();
  const secondaryRow = new ActionRowBuilder<ButtonBuilder>();
  const workspaceButton = buildWorkspaceButton(task);
  const canJoin = (task.status === 'IN_PROGRESS' || task.status === 'BLOCKED') && taskNeedsMoreMembers(task);

  if (task.status === 'BACKLOG') {
    primaryRow.addComponents(
      new ButtonBuilder()
        .setCustomId(`task:claim:${task.id}`)
        .setLabel('Claim')
        .setEmoji('✋')
        .setStyle(ButtonStyle.Primary),
    );
  }

  if (canJoin) {
    primaryRow.addComponents(
      new ButtonBuilder()
        .setCustomId(`task:join:${task.id}`)
        .setLabel('Join Task')
        .setEmoji('🤝')
        .setStyle(ButtonStyle.Secondary),
    );
  }

  primaryRow.addComponents(
    new ButtonBuilder()
      .setCustomId(`task:actions:${task.id}`)
      .setLabel('Task Actions')
      .setEmoji('🧰')
      .setStyle(ButtonStyle.Secondary),
  );

  const rows = primaryRow.components.length > 0 ? [primaryRow] : [];

  if (workspaceButton) {
    secondaryRow.addComponents(workspaceButton);
    rows.push(secondaryRow);
  }

  return rows;
}
