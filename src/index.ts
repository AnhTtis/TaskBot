import { Events } from 'discord.js';

import { createDiscordClient } from './bot/client.js';
import { routeInteraction } from './bot/interaction-router.js';
import { requireDiscordCredentials } from './config/env.js';
import { logger } from './lib/logger.js';
import { prisma } from './lib/prisma.js';
import { startDeadlineReminderLoop } from './modules/tasks/task.reminders.js';
import { handlePendingTaskFileUpload } from './modules/tasks/task.uploads.js';

async function main(): Promise<void> {
  const { discordToken } = requireDiscordCredentials();
  const client = createDiscordClient();
  let reminderTimer: NodeJS.Timeout | null = null;
  let shuttingDown = false;

  async function shutdown(signal: NodeJS.Signals): Promise<void> {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    logger.info(`Received ${signal}. Shutting down TaskBot...`);

    try {
      if (reminderTimer) {
        clearInterval(reminderTimer);
        reminderTimer = null;
      }
      client.destroy();
      await prisma.$disconnect();
      logger.info('TaskBot shutdown completed.');
    } catch (error) {
      logger.error('TaskBot shutdown failed', error);
      process.exitCode = 1;
    }
  }

  process.once('SIGINT', () => {
    void shutdown('SIGINT').finally(() => process.exit());
  });

  process.once('SIGTERM', () => {
    void shutdown('SIGTERM').finally(() => process.exit());
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    await routeInteraction(interaction);
  });

  client.on(Events.MessageCreate, async (message) => {
    await handlePendingTaskFileUpload(message);
  });

  logger.info('Starting TaskBot...');
  await client.login(discordToken);
  reminderTimer = startDeadlineReminderLoop(client);
}

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', reason);
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', error);
  process.exitCode = 1;
});

main().catch((error) => {
  logger.error('Failed to start TaskBot', error);
  process.exit(1);
});
