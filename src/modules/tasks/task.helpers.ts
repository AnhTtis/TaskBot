import { ChannelType, type TextChannel } from 'discord.js';
import type { RequiredRole, TaskPriority } from '@prisma/client';

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
