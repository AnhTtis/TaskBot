import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import type { GuildConfig } from '@prisma/client';

import {
  buildDeadlineFromVietnamPreset,
  formatDeadlineForDisplay,
  formatDeadlineForInput,
} from '../../lib/task-datetime.js';
import { hasTaskMember, taskNeedsMoreMembers } from './task.members.js';
import { getManagerRoleIds, getReviewerRoleIds } from './task.policy.js';
import {
  formatAttachmentLabel,
  formatRoleMentions,
  formatTaskPublicLabel,
  priorityOptions,
  requiredRoleOptions,
  taskDeadlinePresetOptions,
} from './task.helpers.js';
import type { TaskWithMembers } from './task.types.js';

export type TaskPanelMode = 'overview' | 'edit' | 'attachments';

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
  readonly notice?: string | null;
  readonly closeLabel?: string | undefined;
};

function withNotice(embed: EmbedBuilder, notice?: string | null): EmbedBuilder {
  if (!notice) {
    return embed;
  }

  return embed.addFields({
    name: 'Update',
    value: notice,
    inline: false,
  });
}

function truncateLabel(value: string, maxLength = 70): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}

function buildRoleSelectRow(task: TaskWithMembers): ActionRowBuilder<StringSelectMenuBuilder> {
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`task:set-role:${task.id}`)
      .setPlaceholder('Choose required role')
      .addOptions(
        requiredRoleOptions.map((option) => ({
          label: option.label,
          value: option.value,
          description: option.description,
          default: task.requiredRole === option.value,
        })),
      ),
  );
}

function buildPrioritySelectRow(task: TaskWithMembers): ActionRowBuilder<StringSelectMenuBuilder> {
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`task:set-priority:${task.id}`)
      .setPlaceholder('Choose priority')
      .addOptions(
        priorityOptions.map((option) => ({
          label: option.label,
          value: option.value,
          description: option.description,
          default: task.priority === option.value,
        })),
      ),
  );
}

function buildDeadlinePresetSelectRow(task: TaskWithMembers): ActionRowBuilder<StringSelectMenuBuilder> {
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`task:set-deadline-preset:${task.id}`)
      .setPlaceholder(
        task.deadlineAt
          ? `Current deadline: ${formatDeadlineForInput(task.deadlineAt)}`
          : 'Choose a deadline preset',
      )
      .addOptions(
        taskDeadlinePresetOptions.map((option) => ({
          label: option.label,
          value: option.value,
          description: formatDeadlineForInput(
            buildDeadlineFromVietnamPreset({
              dayOffset: option.dayOffset,
              hour: option.hour,
              minute: option.minute,
            }),
          ),
        })).concat({
          label: 'Clear deadline',
          value: 'clear',
          description: 'Remove the current due date.',
        }),
      ),
  );
}

function buildTaskOverviewPanelEmbed(options: Omit<TaskPanelPayloadOptions, 'mode'>): EmbedBuilder {
  const { task, guildConfig, access, notice } = options;
  const attachmentLines = task.attachments.length > 0
    ? task.attachments.slice(0, 8).map((attachment) => `• ${formatAttachmentLabel(attachment)}`)
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

  return withNotice(
    new EmbedBuilder()
      .setTitle(`🧰 ${formatTaskPublicLabel(task.taskNumber)} • ${task.title}`)
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
      .setFooter({ text: 'Use Exit to close this private panel.' })
      .setTimestamp(task.updatedAt),
    notice,
  );
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

  const manageRow = new ActionRowBuilder<ButtonBuilder>();
  if (access.manager) {
    manageRow.addComponents(
      new ButtonBuilder()
        .setCustomId(`task:edit-task:${task.id}`)
        .setLabel('Edit Task')
        .setEmoji('⚙️')
        .setStyle(ButtonStyle.Secondary),
    );
  }

  manageRow.addComponents(
    new ButtonBuilder()
      .setCustomId(`task:exit:${task.id}`)
      .setLabel('Exit')
      .setEmoji('✖️')
      .setStyle(ButtonStyle.Secondary),
  );
  rows.push(manageRow);

  return rows;
}

function buildTaskEditPanelEmbed(options: Omit<TaskPanelPayloadOptions, 'mode'>): EmbedBuilder {
  const { task, notice } = options;
  const attachmentLines = task.attachments.length > 0
    ? task.attachments.slice(0, 8).map((attachment) => `• ${formatAttachmentLabel(attachment)}`)
    : ['No attachments yet.'];

  return withNotice(
    new EmbedBuilder()
      .setTitle(`Edit Task • ${formatTaskPublicLabel(task.taskNumber)}`)
      .setColor(0x5865f2)
      .setDescription([
        task.status === 'BACKLOG'
          ? 'Manager-only task editor for pre-claim tuning.'
          : 'Manager-only task editor for live task maintenance.',
        '',
        `Title: **${task.title}**`,
        `Required Role: **${task.requiredRole}**`,
        `Priority: **${task.priority}**`,
        `Deadline: **${formatDeadlineForDisplay(task.deadlineAt ?? null)}**`,
        `Attachments: **${task.attachments.length}**`,
      ].join('\n'))
      .addFields({
        name: 'Current attachments',
        value: attachmentLines.join('\n'),
        inline: false,
      })
      .setFooter({ text: 'Use the dropdowns for role, priority, and deadline presets. Use Custom Deadline for exact times.' })
      .setTimestamp(task.updatedAt),
    notice,
  );
}

function buildTaskEditPanelComponents(options: Omit<TaskPanelPayloadOptions, 'mode'>) {
  const { task, closeLabel } = options;

  return [
    buildRoleSelectRow(task),
    buildPrioritySelectRow(task),
    buildDeadlinePresetSelectRow(task),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`task:edit-details:${task.id}`)
        .setLabel('Edit Details')
        .setEmoji('⚙️')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`task:deadline-custom:${task.id}`)
        .setLabel('Custom Deadline')
        .setEmoji('🗓️')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`task:attachments:${task.id}`)
        .setLabel('Attachments')
        .setEmoji('📎')
        .setStyle(ButtonStyle.Secondary),
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`task:back-actions:${task.id}`)
        .setLabel('Overview')
        .setEmoji('↩️')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`task:exit:${task.id}`)
        .setLabel(closeLabel ?? 'Exit')
        .setEmoji(closeLabel ? '✅' : '✖️')
        .setStyle(ButtonStyle.Secondary),
    ),
  ];
}

function buildTaskAttachmentsPanelEmbed(options: Omit<TaskPanelPayloadOptions, 'mode'>): EmbedBuilder {
  const { task, notice } = options;
  const attachmentLines = task.attachments.length > 0
    ? task.attachments.slice(0, 8).map((attachment, index) => `${index + 1}. ${formatAttachmentLabel(attachment)}`)
    : ['No attachments yet.'];

  return withNotice(
    new EmbedBuilder()
      .setTitle(`Attachments • ${formatTaskPublicLabel(task.taskNumber)}`)
      .setColor(0x5865f2)
      .setDescription([
        'Attachment uploads use the dedicated slash command path so Discord can show the native file upload field.',
        `Copy this command for **${formatTaskPublicLabel(task.taskNumber)}**: \`/task add-attachment task_code:${task.taskNumber}\``,
        'Then pick a file in Discord or switch to the URL field before sending.',
        'Choose an existing attachment below to edit or delete it.',
      ].join('\n'))
      .addFields({
        name: 'Current attachments',
        value: attachmentLines.join('\n'),
        inline: false,
      })
      .setFooter({ text: 'Use Back to return to Edit Task or Exit to close.' })
      .setTimestamp(task.updatedAt),
    notice,
  );
}

function buildAttachmentActionRows(task: TaskWithMembers): Array<ActionRowBuilder<ButtonBuilder>> {
  const rows: Array<ActionRowBuilder<ButtonBuilder>> = [];

  for (const attachment of task.attachments.slice(0, 4)) {
    const displayName = truncateLabel(formatAttachmentLabel(attachment), 26);
    rows.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`task:attachment-edit:${task.id}:${attachment.id}`)
          .setLabel(`Fix ${displayName}`)
          .setEmoji('⚙️')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(`task:attachment-delete:${task.id}:${attachment.id}`)
          .setLabel(`X ${displayName}`)
          .setEmoji('✖️')
          .setStyle(ButtonStyle.Danger),
      ),
    );
  }

  return rows;
}

function buildTaskAttachmentsPanelComponents(options: Omit<TaskPanelPayloadOptions, 'mode'>): Array<ActionRowBuilder<ButtonBuilder>> {
  const { task } = options;

  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`task:attachment-upload-help:${task.id}`)
        .setLabel('Upload File')
        .setEmoji('📤')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`task:attachment-link-help:${task.id}`)
        .setLabel('Add URL')
        .setEmoji('🔗')
        .setStyle(ButtonStyle.Secondary),
    ),
    ...buildAttachmentActionRows(task),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`task:back-edit:${task.id}`)
        .setLabel('Back')
        .setEmoji('↩️')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`task:exit:${task.id}`)
        .setLabel('Exit')
        .setEmoji('✖️')
        .setStyle(ButtonStyle.Secondary),
    ),
  ];
}

export function buildTaskPanelPayload(options: TaskPanelPayloadOptions) {
  switch (options.mode) {
    case 'attachments':
      return {
        embeds: [buildTaskAttachmentsPanelEmbed(options)],
        components: buildTaskAttachmentsPanelComponents(options),
      };
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
    .setTitle('Create Task')
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId('title').setLabel('Title').setStyle(TextInputStyle.Short).setMaxLength(120).setRequired(true),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId('description').setLabel('Description').setStyle(TextInputStyle.Paragraph).setMaxLength(4000).setRequired(true),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId('team_size').setLabel('Team Size').setStyle(TextInputStyle.Short).setValue('1').setRequired(true),
      ),
    );
}

export function buildEditTaskModal(task: TaskWithMembers): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(`task:edit-modal:${task.id}`)
    .setTitle(`Edit ${formatTaskPublicLabel(task.taskNumber)}`)
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId('title').setLabel('Title').setStyle(TextInputStyle.Short).setValue(task.title).setMaxLength(120).setRequired(true),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId('description').setLabel('Description').setStyle(TextInputStyle.Paragraph).setValue(task.description).setMaxLength(4000).setRequired(true),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId('team_size').setLabel('Team Size').setStyle(TextInputStyle.Short).setValue(String(task.targetMemberCount)).setRequired(true),
      ),
    );
}

export function buildDeadlineModal(task: TaskWithMembers): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(`task:deadline-modal:${task.id}`)
    .setTitle(`Deadline • ${formatTaskPublicLabel(task.taskNumber)}`)
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

export function buildEditAttachmentModal(task: TaskWithMembers, attachmentId: number): ModalBuilder | null {
  const attachment = task.attachments.find((item) => item.id === attachmentId);
  if (!attachment) {
    return null;
  }

  if (attachment.fileName) {
    return new ModalBuilder()
      .setCustomId(`task:attachment-edit-modal:${task.id}:${attachment.id}`)
      .setTitle(`Edit file • ${formatTaskPublicLabel(task.taskNumber)}`)
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
    .setTitle(`Edit link • ${formatTaskPublicLabel(task.taskNumber)}`)
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
