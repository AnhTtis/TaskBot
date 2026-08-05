import { ChannelType, type TextChannel } from 'discord.js';
import type { RequiredRole, TaskPriority } from '@prisma/client';

export const requiredRoleOptions: ReadonlyArray<{
  readonly value: RequiredRole;
  readonly label: string;
  readonly description: string;
}> = [
  {
    value: 'ADMIN',
    label: 'Admin',
    description: 'Only managers/admins can claim this task.',
  },
  {
    value: 'TECHNICIAN',
    label: 'Technician',
    description: 'Technician contributors can claim or join.',
  },
  {
    value: 'RESEARCHER',
    label: 'Researcher',
    description: 'Researcher contributors can claim or join.',
  },
] as const;

export const priorityOptions: ReadonlyArray<{
  readonly value: TaskPriority;
  readonly label: string;
  readonly description: string;
}> = [
  {
    value: 'LOW',
    label: 'Low',
    description: 'Useful but not urgent.',
  },
  {
    value: 'MEDIUM',
    label: 'Medium',
    description: 'Normal working priority.',
  },
  {
    value: 'HIGH',
    label: 'High',
    description: 'Needs attention soon.',
  },
  {
    value: 'URGENT',
    label: 'Urgent',
    description: 'Handle as soon as possible.',
  },
] as const;

export type TaskDeadlinePreset = {
  readonly value: string;
  readonly label: string;
  readonly dayOffset: number;
  readonly hour: number;
  readonly minute: number;
};

export type ParsedTaskReference = {
  readonly taskNumber: number | null;
  readonly legacyTaskCode: string | null;
};

export const taskDeadlinePresetOptions: ReadonlyArray<TaskDeadlinePreset> = [
  { value: 'today-18-00', label: 'Today 18:00', dayOffset: 0, hour: 18, minute: 0 },
  { value: 'tomorrow-09-00', label: 'Tomorrow 09:00', dayOffset: 1, hour: 9, minute: 0 },
  { value: 'tomorrow-14-00', label: 'Tomorrow 14:00', dayOffset: 1, hour: 14, minute: 0 },
  { value: 'tomorrow-18-00', label: 'Tomorrow 18:00', dayOffset: 1, hour: 18, minute: 0 },
  { value: 'plus-2-09-00', label: '+2 Days 09:00', dayOffset: 2, hour: 9, minute: 0 },
  { value: 'plus-3-18-00', label: '+3 Days 18:00', dayOffset: 3, hour: 18, minute: 0 },
  { value: 'plus-7-09-00', label: '+7 Days 09:00', dayOffset: 7, hour: 9, minute: 0 },
] as const;

export function isGuildTextChannel(channel: unknown): channel is TextChannel {
  return (
    typeof channel === 'object' &&
    channel !== null &&
    (channel as { type?: number }).type === ChannelType.GuildText
  );
}

export function formatRoleMentions(roleIds: readonly string[], fallback: string): string {
  return roleIds.length > 0
    ? roleIds.map((roleId) => `<@&${roleId}>`).join(', ')
    : fallback;
}

export function normalizeOptionalText(value: string | null): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : null;
}

export function formatTaskPublicLabel(taskNumber: number): string {
  return `Task #${taskNumber.toString().padStart(4, '0')}`;
}

export function formatTaskDisplayLabel(options: {
  readonly taskNumber: number;
  readonly title: string;
}): string {
  return `${formatTaskPublicLabel(options.taskNumber)} • ${options.title}`;
}

export function formatLegacyTaskCode(taskNumber: number): string {
  return `TASK-${taskNumber.toString().padStart(4, '0')}`;
}

export function parseTaskReferenceInput(value: string): ParsedTaskReference {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return { taskNumber: null, legacyTaskCode: null };
  }

  const normalized = trimmed.replace(/\s+/g, ' ');
  const legacyMatch = /^TASK-(\d+)$/i.exec(normalized);
  if (legacyMatch) {
    const taskNumber = Number.parseInt(legacyMatch[1]!, 10);
    return {
      taskNumber: Number.isInteger(taskNumber) && taskNumber > 0 ? taskNumber : null,
      legacyTaskCode: normalized.toUpperCase(),
    };
  }

  const taskNumberMatch = /^(?:task\s*#\s*|#\s*)?0*(\d+)$/i.exec(normalized);
  if (!taskNumberMatch) {
    return { taskNumber: null, legacyTaskCode: null };
  }

  const taskNumber = Number.parseInt(taskNumberMatch[1]!, 10);
  return {
    taskNumber: Number.isInteger(taskNumber) && taskNumber > 0 ? taskNumber : null,
    legacyTaskCode: null,
  };
}

export function parseRequiredRoleInput(value: string): RequiredRole | null {
  switch (value.trim().toUpperCase()) {
    case 'ADMIN':
      return 'ADMIN';
    case 'TECHNICIAN':
      return 'TECHNICIAN';
    case 'RESEARCHER':
      return 'RESEARCHER';
    default:
      return null;
  }
}

export function parsePriorityInput(value: string): TaskPriority | null {
  switch (value.trim().toUpperCase()) {
    case 'LOW':
      return 'LOW';
    case 'MEDIUM':
      return 'MEDIUM';
    case 'HIGH':
      return 'HIGH';
    case 'URGENT':
      return 'URGENT';
    default:
      return null;
  }
}

export function parsePositiveIntegerInput(value: string): number | null {
  const parsed = Number.parseInt(value.trim(), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function findTaskDeadlinePreset(value: string): TaskDeadlinePreset | null {
  return taskDeadlinePresetOptions.find((option) => option.value === value) ?? null;
}

export function formatAttachmentLabel(options: {
  readonly id: number;
  readonly fileName?: string | null;
  readonly label?: string | null;
  readonly url: string;
}): string {
  const fileName = options.fileName?.trim();
  const label = options.label?.trim();

  return fileName || label || options.url || `Attachment #${options.id}`;
}
