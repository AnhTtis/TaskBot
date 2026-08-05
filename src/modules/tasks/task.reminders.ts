import type { Client } from 'discord.js';

import {
  formatDeadlineForDisplay,
  getCurrentTimeForDisplay,
  getDailyReminderKey,
  getDeadlineReminderSummary,
} from '../../lib/task-datetime.js';
import { formatTaskDisplayLabel, formatTaskPublicLabel } from './task.helpers.js';
import { logger } from '../../lib/logger.js';
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

    const reminderKey = getDailyReminderKey(task.deadlineAt, now);
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
        `⏰ Deadline update for **${formatTaskDisplayLabel(task)}**`,
        `Current time: ${getCurrentTimeForDisplay(now)}`,
        getDeadlineReminderSummary(task.deadlineAt, now),
        `Deadline: ${formatDeadlineForDisplay(task.deadlineAt)}`,
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
        taskLabel: formatTaskPublicLabel(task.taskNumber),
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
