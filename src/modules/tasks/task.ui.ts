import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import type { GuildConfig } from '@prisma/client';

import { formatDeadlineForInput } from '../../lib/task-datetime.js';
import { hasTaskMember, taskNeedsMoreMembers } from './task.members.js';
import { getManagerRoleIds, getReviewerRoleIds } from './task.policy.js';
import { formatAttachmentLabel, formatRoleMentions } from './task.helpers.js';
import type { TaskWithMembers } from './task.types.js';

export type TaskPanelMode = 'overview' | 'edit';

export type TaskActionAccess = {
  readonly manager: boolean;
  readonly reviewer: boolean;
  readonly canClaim: boolean;
  readonly canManageProgress: boolean;
  readonly isTaskMember: boolean;
};

type TaskPanelPayloadOptions = {
  readonly task: TaskWithMembers;
  readonly guildConfig: GuildConfig;
  readonly access: TaskActionAccess;
  readonly mode: TaskPanelMode;
};

function buildTaskOverviewPanelEmbed(options: Omit<TaskPanelPayloadOptions, 'mode'>): EmbedBuilder {
  const { task, guildConfig, access } = options;
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
        return access.manager
          ? 'This task is active. Managers can edit or block it, and task members can mark it done.'
          : 'This task is active. Task members can mark it done when the work is ready for review.';
      case 'BLOCKED':
        return 'This task is blocked. Managers or task members can unblock it when work can continue.';
      case 'REVIEW':
        return access.reviewer
          ? 'This task is waiting for review. Review roles can approve it or request changes.'
          : 'This task is waiting for review actions from managers/reviewers.';
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
        access.manager ? 'task editing' : null,
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

function buildTaskOverviewPanelComponents(options: Omit<TaskPanelPayloadOptions, 'mode'>): Array<ActionRowBuilder<ButtonBuilder>> {
  const { task, access } = options;
  const rows: Array<ActionRowBuilder<ButtonBuilder>> = [];
  const workflowRow = new ActionRowBuilder<ButtonBuilder>();

  if (task.status === 'BACKLOG' && !task.assigneeDiscordUserId && task.members.length === 0 && access.canClaim) {
    workflowRow.addComponents(
      new ButtonBuilder()
        .setCustomId(`task:claim:${task.id}`)
        .setLabel('Claim')
        .setEmoji('✋')
        .setStyle(ButtonStyle.Primary),
    );
  }

  if ((task.status === 'IN_PROGRESS' || task.status === 'BLOCKED') && taskNeedsMoreMembers(task) && !access.isTaskMember && access.canClaim) {
    workflowRow.addComponents(
      new ButtonBuilder()
        .setCustomId(`task:join:${task.id}`)
        .setLabel('Join Task')
        .setEmoji('🤝')
        .setStyle(ButtonStyle.Secondary),
    );
  }

  if (task.status === 'IN_PROGRESS') {
    if (access.manager) {
      workflowRow.addComponents(
        new ButtonBuilder()
          .setCustomId(`task:block:${task.id}`)
          .setLabel('Block')
          .setEmoji('⛔')
          .setStyle(ButtonStyle.Danger),
      );
    }

    if (access.canManageProgress && access.isTaskMember) {
      workflowRow.addComponents(
        new ButtonBuilder()
          .setCustomId(`task:review:${task.id}`)
          .setLabel('Done')
          .setEmoji('✅')
          .setStyle(ButtonStyle.Success),
      );
    }
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
    rows.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`task:edit-task:${task.id}`)
          .setLabel('Edit Task')
          .setEmoji('⚙️')
          .setStyle(ButtonStyle.Secondary),
      ),
    );
  }

  return rows;
}

function buildTaskEditPanelEmbed(options: Omit<TaskPanelPayloadOptions, 'mode'>): EmbedBuilder {
  const { task } = options;
  const attachmentLines = task.attachments.length > 0
    ? task.attachments.slice(0, 12).map((attachment) => `#${attachment.id} • ${formatAttachmentLabel(attachment)}`)
    : ['No attachments yet.'];

  return new EmbedBuilder()
    .setTitle(`Edit Task • ${task.taskCode}`)
    .setColor(0x5865f2)
    .setDescription([
      task.status === 'BACKLOG'
        ? 'Manager-only task editor for pre-claim tuning.'
        : 'Manager-only task editor for live task maintenance.',
      '',
      'Use the controls below to edit details, update the deadline, add links/files, and manage existing attachments.',
      'Attachment rows use ⚙️ to edit and ✖️ to delete.',
      'When you press **Add File**, upload the next file message in the task workspace or dashboard within 10 minutes.',
    ].join('\n'))
    .addFields({
      name: 'Current attachments',
      value: attachmentLines.join('\n'),
      inline: false,
    })
    .setTimestamp(task.updatedAt);
}

function buildAttachmentActionRows(task: TaskWithMembers): Array<ActionRowBuilder<ButtonBuilder>> {
  const attachmentPairs = task.attachments.slice(0, 4);
  const rows: Array<ActionRowBuilder<ButtonBuilder>> = [];

  for (let index = 0; index < attachmentPairs.length; index += 2) {
    const row = new ActionRowBuilder<ButtonBuilder>();

    for (const attachment of attachmentPairs.slice(index, index + 2)) {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`task:attachment-edit:${task.id}:${attachment.id}`)
          .setLabel(`#${attachment.id}`)
          .setEmoji('⚙️')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(`task:attachment-delete:${task.id}:${attachment.id}`)
          .setLabel(`#${attachment.id}`)
          .setEmoji('✖️')
          .setStyle(ButtonStyle.Danger),
      );
    }

    rows.push(row);
  }

  return rows;
}

function buildTaskEditPanelComponents(options: Omit<TaskPanelPayloadOptions, 'mode'>): Array<ActionRowBuilder<ButtonBuilder>> {
  const { task } = options;

  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`task:edit-details:${task.id}`)
        .setLabel('Details')
        .setEmoji('⚙️')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`task:set-deadline:${task.id}`)
        .setLabel('Deadline')
        .setEmoji('🗓️')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`task:add-url:${task.id}`)
        .setLabel('Link')
        .setEmoji('🔗')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`task:add-file:${task.id}`)
        .setLabel('Add File')
        .setEmoji('📤')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`task:back-actions:${task.id}`)
        .setLabel('Back')
        .setEmoji('↩️')
        .setStyle(ButtonStyle.Secondary),
    ),
    ...buildAttachmentActionRows(task),
  ];
}

export function buildTaskPanelPayload(options: TaskPanelPayloadOptions) {
  switch (options.mode) {
    case 'edit':
      return {
        embeds: [buildTaskEditPanelEmbed(options)],
        components: buildTaskEditPanelComponents(options),
      };
    case 'overview':
      return {
        embeds: [buildTaskOverviewPanelEmbed(options)],
        components: buildTaskOverviewPanelComponents(options),
      };
  }
}

export function buildCreateTaskModal(): ModalBuilder {
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
        new TextInputBuilder()
          .setCustomId('required_role')
          .setLabel('Required role')
          .setPlaceholder('ADMIN / TECHNICIAN / RESEARCHER')
          .setStyle(TextInputStyle.Short)
          .setRequired(true),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId('team_size').setLabel('Team size').setStyle(TextInputStyle.Short).setValue('1').setRequired(true),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('deadline')
          .setLabel('Deadline (optional)')
          .setPlaceholder('dd/MM/yyyy HH:mm')
          .setStyle(TextInputStyle.Short)
          .setRequired(false),
      ),
    );
}

export function buildEditTaskModal(task: TaskWithMembers): ModalBuilder {
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

export function buildDeadlineModal(task: TaskWithMembers): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(`task:deadline-modal:${task.id}`)
    .setTitle(`Deadline • ${task.taskCode}`)
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('deadline')
          .setLabel('Deadline (dd/MM/yyyy HH:mm)')
          .setPlaceholder('Leave blank to clear')
          .setValue(formatDeadlineForInput(task.deadlineAt ?? null))
          .setStyle(TextInputStyle.Short)
          .setRequired(false),
      ),
    );
}

export function buildAddLinkModal(task: TaskWithMembers): ModalBuilder {
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

export function buildEditAttachmentModal(task: TaskWithMembers, attachmentId: number): ModalBuilder | null {
  const attachment = task.attachments.find((item) => item.id === attachmentId);
  if (!attachment) {
    return null;
  }

  if (attachment.fileName) {
    return new ModalBuilder()
      .setCustomId(`task:attachment-edit-modal:${task.id}:${attachment.id}`)
      .setTitle(`Edit file • ${task.taskCode}`)
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId('label')
            .setLabel('File note')
            .setStyle(TextInputStyle.Short)
            .setValue(attachment.label ?? '')
            .setRequired(false),
        ),
      );
  }

  return new ModalBuilder()
    .setCustomId(`task:attachment-edit-modal:${task.id}:${attachment.id}`)
    .setTitle(`Edit link • ${task.taskCode}`)
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('url')
          .setLabel('URL')
          .setStyle(TextInputStyle.Short)
          .setValue(attachment.url)
          .setRequired(true),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('label')
          .setLabel('Optional label')
          .setStyle(TextInputStyle.Short)
          .setValue(attachment.label ?? '')
          .setRequired(false),
      ),
    );
}

export function getTaskActionAccess(options: {
  readonly task: TaskWithMembers;
  readonly userId: string;
  readonly manager: boolean;
  readonly reviewer: boolean;
  readonly canClaim: boolean;
  readonly canManageProgress: boolean;
}): TaskActionAccess {
  return {
    manager: options.manager,
    reviewer: options.reviewer,
    canClaim: options.canClaim,
    canManageProgress: options.canManageProgress,
    isTaskMember: hasTaskMember(options.task, options.userId),
  };
}
