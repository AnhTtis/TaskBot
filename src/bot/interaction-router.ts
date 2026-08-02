import type {
  AutocompleteInteraction,
  ButtonInteraction,
  ChatInputCommandInteraction,
  Interaction,
  ModalSubmitInteraction,
} from 'discord.js';
import { DiscordAPIError, MessageFlags } from 'discord.js';

import { logger } from '../lib/logger.js';
import { handleSetupCommand } from '../modules/guild-config/guild-config.service.js';
import {
  handleTaskAutocompleteInteraction,
  handleTaskCommand,
} from '../modules/tasks/task.commands.js';
import {
  handleTaskButtonInteraction,
  handleTaskModalSubmitInteraction,
} from '../modules/tasks/task.interactions.js';

export async function routeInteraction(interaction: Interaction): Promise<void> {
  try {
    if (interaction.isChatInputCommand()) {
      await handleChatInputCommand(interaction);
      return;
    }

    if (interaction.isAutocomplete()) {
      await handleAutocompleteInteraction(interaction);
      return;
    }

    if (interaction.isButton()) {
      await handleButtonInteraction(interaction);
      return;
    }

    if (interaction.isModalSubmit()) {
      await handleModalSubmit(interaction);
    }
  } catch (error) {
    logger.error('Interaction routing failed', error);

    try {
      await replyWithError(interaction);
    } catch (replyError) {
      if (replyError instanceof DiscordAPIError && replyError.code === 10062) {
        logger.warn('Unable to send interaction error reply because the interaction has already expired.', {
          interactionId: interaction.id,
        });
        return;
      }

      throw replyError;
    }
  }
}

async function handleChatInputCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  switch (interaction.commandName) {
    case 'ping': {
      await interaction.reply({
        content: `Pong! Gateway latency: ${interaction.client.ws.ping}ms`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    case 'setup': {
      await handleSetupCommand(interaction);
      return;
    }

    case 'task': {
      await handleTaskCommand(interaction);
      return;
    }

    default: {
      await interaction.reply({
        content: `Unknown command: ${interaction.commandName}`,
        flags: MessageFlags.Ephemeral,
      });
    }
  }
}

async function handleAutocompleteInteraction(
  interaction: AutocompleteInteraction,
): Promise<void> {
  if (interaction.commandName === 'task') {
    await handleTaskAutocompleteInteraction(interaction);
    return;
  }

  await interaction.respond([]);
}

async function handleButtonInteraction(
  interaction: ButtonInteraction,
): Promise<void> {
  await handleTaskButtonInteraction(interaction);
}

async function handleModalSubmit(
  interaction: ModalSubmitInteraction,
): Promise<void> {
  await handleTaskModalSubmitInteraction(interaction);
}

async function replyWithError(interaction: Interaction): Promise<void> {
  const payload = {
    content: 'Something went wrong while processing that interaction.',
    flags: MessageFlags.Ephemeral,
  } as const;

  if (interaction.isRepliable()) {
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(payload);
      return;
    }

    await interaction.reply(payload);
  }
}
