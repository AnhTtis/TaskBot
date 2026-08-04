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

export function parseNextTaskSequence(taskCode: string | null): number {
  if (!taskCode) {
    return 1;
  }

  const match = /^TASK-(\d+)$/.exec(taskCode);
  return match?.[1] ? Number.parseInt(match[1], 10) + 1 : 1;
}

export function formatTaskCode(sequence: number): string {
  return `TASK-${sequence.toString().padStart(3, '0')}`;
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
  if (fileName && label) {
    return `${fileName} — ${label}`;
  }

  return fileName || label || options.url || `Attachment #${options.id}`;
}
