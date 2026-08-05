import { ChannelType, REST, Routes, SlashCommandBuilder } from 'discord.js';

import { requireDiscordCredentials } from '../config/env.js';

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
    ),
  new SlashCommandBuilder()
    .setName('task')
    .setDescription('Attachment-only task helpers.')
    .addSubcommand((subcommand) =>
      subcommand
        .setName('add-attachment')
        .setDescription('Upload a file or add a URL to a task.')
        .addStringOption((option) =>
          option
            .setName('task_code')
            .setDescription('Task number, for example 42 or Task #0042. Legacy TASK-042 still works.')
            .setRequired(true)
            .setAutocomplete(true),
        )
        .addAttachmentOption((option) =>
          option
            .setName('file')
            .setDescription('File to attach to the task.')
            .setRequired(false),
        )
        .addStringOption((option) =>
          option
            .setName('url')
            .setDescription('URL to attach to the task.')
            .setRequired(false),
        )
        .addStringOption((option) =>
          option
            .setName('label')
            .setDescription('Optional note or label for this attachment.')
            .setRequired(false),
        ),
    )
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
