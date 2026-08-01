import type { DateInputMode } from '@prisma/client';

const SUPPORTED_TIMEZONE_OFFSETS = {
  'Asia/Ho_Chi_Minh': 7,
  UTC: 0,
} as const;

export const SUPPORTED_TIMEZONE_CHOICES = [
  { name: 'Việt Nam (Asia/Ho_Chi_Minh)', value: 'Asia/Ho_Chi_Minh' },
  { name: 'UTC', value: 'UTC' },
] as const;

export const DATE_INPUT_MODE_CHOICES = [
  { name: 'Vietnam + ISO', value: 'VIETNAM_OR_ISO' },
  { name: 'Vietnam only', value: 'VIETNAM_ONLY' },
  { name: 'ISO only', value: 'ISO_ONLY' },
] as const;

const VIETNAM_DEADLINE_PATTERN = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?$/;

type SupportedTimezone = keyof typeof SUPPORTED_TIMEZONE_OFFSETS;

type ParseDeadlineOptions = {
  readonly timezone: string;
  readonly inputMode: DateInputMode;
};

function isSupportedTimezone(timezone: string): timezone is SupportedTimezone {
  return timezone in SUPPORTED_TIMEZONE_OFFSETS;
}

function getTimezoneOffsetHours(timezone: string): number {
  return SUPPORTED_TIMEZONE_OFFSETS[isSupportedTimezone(timezone) ? timezone : 'Asia/Ho_Chi_Minh'];
}

function parseVietnamDateInput(input: string, timezone: string): Date | null {
  const match = VIETNAM_DEADLINE_PATTERN.exec(input.trim());
  if (!match) {
    return null;
  }

  const dayRaw = match[1]!;
  const monthRaw = match[2]!;
  const yearRaw = match[3]!;
  const hourRaw = match[4];
  const minuteRaw = match[5];
  const day = Number.parseInt(dayRaw, 10);
  const month = Number.parseInt(monthRaw, 10);
  const year = Number.parseInt(yearRaw, 10);
  const hour = hourRaw ? Number.parseInt(hourRaw, 10) : 0;
  const minute = minuteRaw ? Number.parseInt(minuteRaw, 10) : 0;

  if (
    !Number.isInteger(day) || !Number.isInteger(month) || !Number.isInteger(year)
    || !Number.isInteger(hour) || !Number.isInteger(minute)
    || month < 1 || month > 12
    || day < 1 || day > 31
    || hour < 0 || hour > 23
    || minute < 0 || minute > 59
  ) {
    return null;
  }

  const offsetHours = getTimezoneOffsetHours(timezone);
  const utcMillis = Date.UTC(year, month - 1, day, hour - offsetHours, minute, 0, 0);
  const parsed = new Date(utcMillis);

  if (
    parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== day
  ) {
    return null;
  }

  return parsed;
}

function parseIsoDateInput(input: string): Date | null {
  const parsed = new Date(input.trim());
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function parseDeadlineInput(
  input: string,
  options: ParseDeadlineOptions,
): Date | null {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return null;
  }

  switch (options.inputMode) {
    case 'ISO_ONLY':
      return parseIsoDateInput(trimmed);
    case 'VIETNAM_ONLY':
      return parseVietnamDateInput(trimmed, options.timezone);
    case 'VIETNAM_OR_ISO': {
      return parseVietnamDateInput(trimmed, options.timezone) ?? parseIsoDateInput(trimmed);
    }
  }
}

export function getDeadlineInputHint(inputMode: DateInputMode): string {
  switch (inputMode) {
    case 'ISO_ONLY':
      return 'Use ISO-8601, for example 2026-08-31T18:00:00+07:00.';
    case 'VIETNAM_ONLY':
      return 'Use dd/MM/yyyy HH:mm, for example 31/08/2026 18:00.';
    case 'VIETNAM_OR_ISO':
      return 'Use dd/MM/yyyy HH:mm or ISO-8601, for example 31/08/2026 18:00 or 2026-08-31T18:00:00+07:00.';
  }
}

function getSafeTimezone(timezone: string): SupportedTimezone {
  return isSupportedTimezone(timezone) ? timezone : 'Asia/Ho_Chi_Minh';
}

type TimezoneDateParts = {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
};

function getTimezoneDateParts(date: Date, timezone: string): TimezoneDateParts {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: getSafeTimezone(timezone),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return {
    year: Number.parseInt(values.year ?? '0', 10),
    month: Number.parseInt(values.month ?? '0', 10),
    day: Number.parseInt(values.day ?? '0', 10),
    hour: Number.parseInt(values.hour ?? '0', 10),
    minute: Number.parseInt(values.minute ?? '0', 10),
  };
}

function getTimezoneDaySerial(date: Date, timezone: string): number {
  const parts = getTimezoneDateParts(date, timezone);
  return Math.floor(Date.UTC(parts.year, parts.month - 1, parts.day) / (24 * 60 * 60 * 1000));
}

function formatTimezoneDateKey(date: Date, timezone: string): string {
  const parts = getTimezoneDateParts(date, timezone);
  return `${parts.year.toString().padStart(4, '0')}-${parts.month.toString().padStart(2, '0')}-${parts.day.toString().padStart(2, '0')}`;
}

export function formatDeadlineForDisplay(deadlineAt: Date | null, timezone: string): string {
  if (!deadlineAt) {
    return 'Not set';
  }

  const safeTimezone = getSafeTimezone(timezone);
  const formatter = new Intl.DateTimeFormat('vi-VN', {
    timeZone: safeTimezone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const formatted = formatter.format(deadlineAt);
  const suffix = safeTimezone === 'Asia/Ho_Chi_Minh' ? 'GMT+7' : safeTimezone;
  return `${formatted} (${suffix})`;
}

export function getCurrentTimeForDisplay(timezone: string, now: Date = new Date()): string {
  return formatDeadlineForDisplay(now, timezone);
}

export function getDeadlineReminderSummary(deadlineAt: Date, now: Date, timezone: string): string {
  const dayDifference = getTimezoneDaySerial(deadlineAt, timezone) - getTimezoneDaySerial(now, timezone);

  if (dayDifference < 0) {
    const overdueDays = Math.abs(dayDifference);
    return overdueDays === 1 ? 'Deadline passed yesterday in your timezone.' : `Deadline passed ${overdueDays} days ago in your timezone.`;
  }

  if (dayDifference === 0) {
    if (deadlineAt.getTime() <= now.getTime()) {
      return 'Deadline passed earlier today in your timezone.';
    }

    return 'Deadline is due today in your timezone.';
  }

  if (dayDifference === 1) {
    return 'Deadline is due tomorrow in your timezone.';
  }

  return `Deadline is due in ${dayDifference} days in your timezone.`;
}

export function getDailyReminderKey(deadlineAt: Date, now: Date, timezone: string): string {
  const dueDateKey = formatTimezoneDateKey(deadlineAt, timezone);
  const todayDateKey = formatTimezoneDateKey(now, timezone);
  return `${todayDateKey}:${dueDateKey}`;
}
