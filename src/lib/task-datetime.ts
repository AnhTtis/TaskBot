const VIETNAM_TIMEZONE = 'Asia/Ho_Chi_Minh';
const VIETNAM_TIMEZONE_LABEL = 'GMT+7';
const VIETNAM_TIMEZONE_OFFSET_HOURS = 7;
const VIETNAM_DEADLINE_PATTERN = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?$/;

type VietnamDateParts = {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
};

function parseVietnamDateInput(input: string): Date | null {
  const match = VIETNAM_DEADLINE_PATTERN.exec(input.trim());
  if (!match) {
    return null;
  }

  const day = Number.parseInt(match[1]!, 10);
  const month = Number.parseInt(match[2]!, 10);
  const year = Number.parseInt(match[3]!, 10);
  const hour = match[4] ? Number.parseInt(match[4], 10) : 0;
  const minute = match[5] ? Number.parseInt(match[5], 10) : 0;

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

  const utcMillis = Date.UTC(year, month - 1, day, hour - VIETNAM_TIMEZONE_OFFSET_HOURS, minute, 0, 0);
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

function getVietnamDateParts(date: Date): VietnamDateParts {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: VIETNAM_TIMEZONE,
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

function getVietnamDaySerial(date: Date): number {
  const parts = getVietnamDateParts(date);
  return Math.floor(Date.UTC(parts.year, parts.month - 1, parts.day) / (24 * 60 * 60 * 1000));
}

function formatVietnamDateKey(date: Date): string {
  const parts = getVietnamDateParts(date);
  return `${parts.year.toString().padStart(4, '0')}-${parts.month.toString().padStart(2, '0')}-${parts.day.toString().padStart(2, '0')}`;
}

export function parseDeadlineInput(input: string): Date | null {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return null;
  }

  return parseVietnamDateInput(trimmed);
}

export function getDeadlineInputHint(): string {
  return 'Use dd/MM/yyyy HH:mm, for example 31/08/2026 18:00.';
}

export function formatDeadlineForInput(deadlineAt: Date | null): string {
  if (!deadlineAt) {
    return '';
  }

  const parts = getVietnamDateParts(deadlineAt);
  return [
    parts.day.toString().padStart(2, '0'),
    parts.month.toString().padStart(2, '0'),
    parts.year.toString().padStart(4, '0'),
  ].join('/') + ` ${parts.hour.toString().padStart(2, '0')}:${parts.minute.toString().padStart(2, '0')}`;
}

export function formatDeadlineForDisplay(deadlineAt: Date | null): string {
  if (!deadlineAt) {
    return 'Not set';
  }

  return `${formatDeadlineForInput(deadlineAt)} (${VIETNAM_TIMEZONE_LABEL})`;
}

export function buildDeadlineFromVietnamPreset(options: {
  readonly dayOffset: number;
  readonly hour: number;
  readonly minute?: number;
  readonly now?: Date;
}): Date {
  const baseDate = options.now ?? new Date();
  const baseParts = getVietnamDateParts(baseDate);

  return new Date(
    Date.UTC(
      baseParts.year,
      baseParts.month - 1,
      baseParts.day + options.dayOffset,
      options.hour - VIETNAM_TIMEZONE_OFFSET_HOURS,
      options.minute ?? 0,
      0,
      0,
    ),
  );
}

export function getCurrentTimeForDisplay(now: Date = new Date()): string {
  return formatDeadlineForDisplay(now);
}

export function getDeadlineReminderSummary(deadlineAt: Date, now: Date): string {
  const dayDifference = getVietnamDaySerial(deadlineAt) - getVietnamDaySerial(now);

  if (dayDifference < 0) {
    const overdueDays = Math.abs(dayDifference);
    return overdueDays === 1
      ? 'Deadline đã qua hôm qua theo giờ Việt Nam.'
      : `Deadline đã qua ${overdueDays} ngày theo giờ Việt Nam.`;
  }

  if (dayDifference === 0) {
    if (deadlineAt.getTime() <= now.getTime()) {
      return 'Deadline đã qua trước đó trong hôm nay theo giờ Việt Nam.';
    }

    return 'Deadline đến hạn hôm nay theo giờ Việt Nam.';
  }

  if (dayDifference === 1) {
    return 'Deadline đến hạn ngày mai theo giờ Việt Nam.';
  }

  return `Deadline đến hạn sau ${dayDifference} ngày theo giờ Việt Nam.`;
}

export function getDailyReminderKey(deadlineAt: Date, now: Date): string {
  const dueDateKey = formatVietnamDateKey(deadlineAt);
  const todayDateKey = formatVietnamDateKey(now);
  return `${todayDateKey}:${dueDateKey}`;
}
