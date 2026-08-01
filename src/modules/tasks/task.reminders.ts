import type { Client } from 'discord.js';

import {
  formatDeadlineForDisplay,
  getCurrentTimeForDisplay,
  getDailyReminderKey,
  getDeadlineReminderSummary,
} from '../../lib/task-datetime.js';
import { logger } from '../../lib/logger.js';
import { findGuildConfigByGuildId } from '../guild-config/guild-config.repository.js';
import {
  createTaskEvent,
  createTaskReminderReceipt,
  hasTaskReminderReceipt,
  listTasksForDeadlineReminders,
} from './task.repository.js';

const REMINDER_CHECK_INTERVAL_MS = 60 * 60 * 1000;
const REMINDER_LOOKAHEAD_DAYS = 365;

async function sendDeadlineReminderPass(client: Client): Promise<void> {
  const now = new Date();
  const dueBefore = new Date(now.getTime() + REMINDER_LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000);
  const tasks = await listTasksForDeadlineReminders({ now, dueBefore });

  for (const task of tasks) {
    if (!task.assigneeDiscordUserId || !task.deadlineAt) {
      continue;
    }

    const guildConfig = await findGuildConfigByGuildId(task.guildId);
    const timezone = guildConfig?.defaultTimezone ?? 'Asia/Ho_Chi_Minh';
    const reminderKey = getDailyReminderKey(task.deadlineAt, now, timezone);
    const alreadySent = await hasTaskReminderReceipt({
      taskId: task.id,
      recipientDiscordUserId: task.assigneeDiscordUserId,
      reminderKey,
    });

    if (alreadySent) {
      continue;
    }

    try {
      const user = await client.users.fetch(task.assigneeDiscordUserId);
      await user.send([
        `⏰ Deadline update for **${task.taskCode} — ${task.title}**`,
        `Current time: ${getCurrentTimeForDisplay(timezone, now)}`,
        getDeadlineReminderSummary(task.deadlineAt, now, timezone),
        `Deadline: ${formatDeadlineForDisplay(task.deadlineAt, timezone)}`,
        `Status: ${task.status}`,
      ].join('\n'));

      await createTaskReminderReceipt({
        taskId: task.id,
        recipientDiscordUserId: task.assigneeDiscordUserId,
        reminderKey,
      });

      await createTaskEvent({
        taskId: task.id,
        actorDiscordUserId: null,
        type: 'REMINDER_SENT',
        summary: 'Sent private deadline reminder to the assignee.',
        details: `${task.assigneeDiscordUserId} • ${reminderKey}`,
      });
    } catch (error) {
      logger.warn('Failed to send deadline reminder DM.', {
        taskId: task.id,
        taskCode: task.taskCode,
        assigneeDiscordUserId: task.assigneeDiscordUserId,
        error,
      });
    }
  }
}

export function startDeadlineReminderLoop(client: Client): NodeJS.Timeout {
  void sendDeadlineReminderPass(client).catch((error) => {
    logger.error('Initial deadline reminder pass failed', error);
  });

  return setInterval(() => {
    void sendDeadlineReminderPass(client).catch((error) => {
      logger.error('Scheduled deadline reminder pass failed', error);
    });
  }, REMINDER_CHECK_INTERVAL_MS);
}
