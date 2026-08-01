import { ChannelType, REST, Routes, SlashCommandBuilder } from 'discord.js';

import { requireDiscordCredentials } from '../config/env.js';
import {
  DATE_INPUT_MODE_CHOICES,
  SUPPORTED_TIMEZONE_CHOICES,
} from '../lib/task-datetime.js';

const commands = [
  new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Check whether TaskBot is online.'),
  new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Initialize TaskBot for this server.')
    .addChannelOption((option) =>
      option
        .setName('dashboard_channel')
        .setDescription('Text channel where the dashboard summary will be posted.')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true),
    )
    .addChannelOption((option) =>
      option
        .setName('feed_channel')
        .setDescription('Text channel for operational updates and repair notices.')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true),
    )
    .addRoleOption((option) =>
      option
        .setName('admin_role')
        .setDescription('Primary role that can administer TaskBot workflows.')
        .setRequired(true),
    )
    .addRoleOption((option) =>
      option
        .setName('secondary_manager_role')
        .setDescription('Optional second role that can administer TaskBot workflows.')
        .setRequired(false),
    )
    .addChannelOption((option) =>
      option
        .setName('archive_channel')
        .setDescription('Optional archive channel for completed task references.')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(false),
    )
    .addRoleOption((option) =>
      option
        .setName('reviewer_role')
        .setDescription('Primary role that can approve tasks in review.')
        .setRequired(false),
    )
    .addRoleOption((option) =>
      option
        .setName('secondary_reviewer_role')
        .setDescription('Optional second role that can approve tasks in review.')
        .setRequired(false),
    )
    .addIntegerOption((option) =>
      option
        .setName('max_active_tasks')
        .setDescription('Maximum number of active tasks per contributor.')
        .setMinValue(1)
        .setMaxValue(10)
        .setRequired(false),
    )
    .addIntegerOption((option) =>
      option
        .setName('thread_auto_archive_minutes')
        .setDescription('Auto-archive duration for task threads in minutes.')
        .addChoices(
          { name: '1 hour', value: 60 },
          { name: '24 hours', value: 1440 },
          { name: '3 days', value: 4320 },
          { name: '7 days', value: 10080 },
        )
        .setRequired(false),
    )
    .addStringOption((option) =>
      option
        .setName('default_timezone')
        .setDescription('Default timezone used when a deadline input has no offset.')
        .addChoices(...SUPPORTED_TIMEZONE_CHOICES)
        .setRequired(false),
    )
    .addStringOption((option) =>
      option
        .setName('default_date_input_mode')
        .setDescription('Accepted date input format for task deadlines.')
        .addChoices(...DATE_INPUT_MODE_CHOICES)
        .setRequired(false),
    ),
  new SlashCommandBuilder()
    .setName('task')
    .setDescription('Create and manage TaskBot tasks.')
    .addSubcommand((subcommand) =>
      subcommand
        .setName('create')
        .setDescription('Create a new backlog task on the dashboard.')
        .addStringOption((option) =>
          option.setName('title').setDescription('Short task title.').setRequired(true),
        )
        .addStringOption((option) =>
          option
            .setName('description')
            .setDescription('Full task description shown on the task card.')
            .setRequired(true),
        )
        .addStringOption((option) =>
          option
            .setName('required_role')
            .setDescription('Which role should claim this task?')
            .setRequired(true)
            .addChoices(
              { name: 'Admin', value: 'ADMIN' },
              { name: 'Technician', value: 'TECHNICIAN' },
              { name: 'Researcher', value: 'RESEARCHER' },
            ),
        )
        .addIntegerOption((option) =>
          option
            .setName('team_size')
            .setDescription('How many people should this task have in total?')
            .setMinValue(1)
            .setMaxValue(10)
            .setRequired(false),
        )
        .addStringOption((option) =>
          option
            .setName('priority')
            .setDescription('Optional task priority.')
            .setRequired(false)
            .addChoices(
              { name: 'Low', value: 'LOW' },
              { name: 'Medium', value: 'MEDIUM' },
              { name: 'High', value: 'HIGH' },
              { name: 'Urgent', value: 'URGENT' },
            ),
        )
        .addStringOption((option) =>
          option
            .setName('deadline')
            .setDescription('Optional deadline in dd/MM/yyyy HH:mm or ISO-8601, e.g. 31/08/2026 18:00')
            .setRequired(false),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('update-meta')
        .setDescription('Manager-only update for title, description, role, priority, and team size.')
        .addStringOption((option) =>
          option
            .setName('task_code')
            .setDescription('Task code to update, for example TASK-001.')
            .setRequired(true),
        )
        .addStringOption((option) =>
          option.setName('title').setDescription('Updated task title.').setRequired(false),
        )
        .addStringOption((option) =>
          option
            .setName('description')
            .setDescription('Updated task description.')
            .setRequired(false),
        )
        .addStringOption((option) =>
          option
            .setName('required_role')
            .setDescription('Updated required role.')
            .setRequired(false)
            .addChoices(
              { name: 'Admin', value: 'ADMIN' },
              { name: 'Technician', value: 'TECHNICIAN' },
              { name: 'Researcher', value: 'RESEARCHER' },
            ),
        )
        .addIntegerOption((option) =>
          option
            .setName('team_size')
            .setDescription('Updated team size.')
            .setMinValue(1)
            .setMaxValue(10)
            .setRequired(false),
        )
        .addStringOption((option) =>
          option
            .setName('priority')
            .setDescription('Updated task priority.')
            .setRequired(false)
            .addChoices(
              { name: 'Low', value: 'LOW' },
              { name: 'Medium', value: 'MEDIUM' },
              { name: 'High', value: 'HIGH' },
              { name: 'Urgent', value: 'URGENT' },
            ),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('set-deadline')
        .setDescription('Manager-only set or replace a task deadline.')
        .addStringOption((option) =>
          option
            .setName('task_code')
            .setDescription('Task code to update, for example TASK-001.')
            .setRequired(true),
        )
        .addStringOption((option) =>
          option
            .setName('deadline')
            .setDescription('Deadline in dd/MM/yyyy HH:mm or ISO-8601.')
            .setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('clear-deadline')
        .setDescription('Manager-only clear a task deadline.')
        .addStringOption((option) =>
          option
            .setName('task_code')
            .setDescription('Task code to update, for example TASK-001.')
            .setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('add-attachment')
        .setDescription('Manager-only add an attachment or reference link to a task.')
        .addStringOption((option) =>
          option
            .setName('task_code')
            .setDescription('Task code to update, for example TASK-001.')
            .setRequired(true),
        )
        .addAttachmentOption((option) =>
          option
            .setName('file')
            .setDescription('Optional file attachment to associate with the task.')
            .setRequired(false),
        )
        .addStringOption((option) =>
          option
            .setName('url')
            .setDescription('Optional reference URL to attach when no file is uploaded.')
            .setRequired(false),
        )
        .addStringOption((option) =>
          option
            .setName('label')
            .setDescription('Optional short label for the attachment.')
            .setRequired(false),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('remove-attachment')
        .setDescription('Manager-only remove an attachment from a task.')
        .addStringOption((option) =>
          option
            .setName('task_code')
            .setDescription('Task code to update, for example TASK-001.')
            .setRequired(true),
        )
        .addIntegerOption((option) =>
          option
            .setName('attachment_id')
            .setDescription('Attachment ID shown on the task card.')
            .setMinValue(1)
            .setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('sync-dashboard')
        .setDescription('Repair dashboard summary, task cards, and workspace threads from database state.')
        .addStringOption((option) =>
          option
            .setName('task_code')
            .setDescription('Optional task code to repair, for example TASK-001.')
            .setRequired(false),
        ),
    ),
].map((command) => command.toJSON());

async function main(): Promise<void> {
  const { clientId, discordToken, guildId } = requireDiscordCredentials();
  const rest = new REST({ version: '10' }).setToken(discordToken);

  if (guildId) {
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
      body: commands,
    });

    console.log(`Registered ${commands.length} guild command(s) for guild ${guildId}.`);
    return;
  }

  await rest.put(Routes.applicationCommands(clientId), {
    body: commands,
  });

  console.log(`Registered ${commands.length} global command(s).`);
}

main().catch((error) => {
  console.error('Failed to register slash commands.');
  console.error(error);
  process.exit(1);
});
