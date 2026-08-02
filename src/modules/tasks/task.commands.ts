import type {
  AutocompleteInteraction,
  ChatInputCommandInteraction,
} from 'discord.js';
import { MessageFlags } from 'discord.js';

export async function handleTaskAutocompleteInteraction(
  interaction: AutocompleteInteraction,
): Promise<void> {
  await interaction.respond([]);
}

export async function handleTaskCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  await interaction.reply({
    content: 'Task slash commands have been removed. Use the dashboard buttons instead.',
    flags: MessageFlags.Ephemeral,
  });
}
