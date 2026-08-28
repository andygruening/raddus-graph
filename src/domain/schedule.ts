import type { ScheduleDraft, ScheduleMode, SlackTriggerDraft, SlackTriggerType } from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function deploymentScheduleDraft(schedule: unknown): ScheduleDraft {
  if (isRecord(schedule) && schedule.type === "cron") {
    const expression = typeof schedule.expression === "string" ? schedule.expression : "0 9 * * *";
    const parsed = scheduleDraftFromCronExpression(expression);
    return {
      ...parsed,
      expression,
      timezone: typeof schedule.timezone === "string" ? schedule.timezone : "UTC",
    };
  }
  return { mode: "days", interval: 1, minute: 0, hour: 9, dayOfWeek: 1, expression: "0 9 * * *", timezone: "UTC" };
}

export function createDefaultScheduleDraft(): ScheduleDraft {
  return deploymentScheduleDraft(null);
}

export function createDefaultSlackTriggerDraft(): SlackTriggerDraft {
  return { type: "none" };
}

export function createSlackTriggerDraft(type: SlackTriggerType, current: SlackTriggerDraft = createDefaultSlackTriggerDraft(), nextValue?: string): SlackTriggerDraft {
  if (type === "none" || type === "all") return { type };
  if (type === "channel") return { type, channel_id: nextValue ?? current.channel_id ?? "" };
  if (type === "user") return { type, user_id: nextValue ?? current.user_id ?? "" };
  return { type, keyword: nextValue ?? current.keyword ?? "" };
}

export function scheduleDraftFromCronExpression(expression: string): Omit<ScheduleDraft, "timezone"> {
  const fallback = { mode: "cron" as const, interval: 1, minute: 0, hour: 9, dayOfWeek: 1, expression };
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return fallback;

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
  const parsedMinute = parseCronNumber(minute, 0, 59);
  if (parsedMinute === null || month !== "*") return fallback;

  const hourStep = hour.match(/^\*\/(\d+)$/);
  if (hourStep && dayOfMonth === "*" && dayOfWeek === "*") {
    return { mode: "hours", interval: clamp(Number(hourStep[1]), 1, 23), minute: parsedMinute, hour: 9, dayOfWeek: 1, expression };
  }

  const parsedHour = parseCronNumber(hour, 0, 23);
  if (parsedHour === null) return fallback;

  const dayStep = dayOfMonth.match(/^\*\/(\d+)$/);
  if (dayStep && dayOfWeek === "*") {
    return { mode: "days", interval: clamp(Number(dayStep[1]), 1, 31), minute: parsedMinute, hour: parsedHour, dayOfWeek: 1, expression };
  }

  const parsedDayOfWeek = parseCronNumber(dayOfWeek, 0, 7);
  if (dayOfMonth === "*" && parsedDayOfWeek !== null) {
    return { mode: "weeks", interval: 1, minute: parsedMinute, hour: parsedHour, dayOfWeek: parsedDayOfWeek === 0 ? 7 : parsedDayOfWeek, expression };
  }

  return fallback;
}

export function cronExpressionForSchedule(draft: ScheduleDraft): string {
  if (!draft.timezone.trim()) throw new Error("Schedule timezone is required.");

  if (draft.mode === "cron") {
    const expression = draft.expression.trim();
    if (expression.split(/\s+/).length !== 5) throw new Error("Cron expression must have 5 fields.");
    return expression;
  }

  const interval = clamp(Math.trunc(draft.interval), 1, scheduleIntervalMax(draft.mode));
  const minute = clamp(Math.trunc(draft.minute), 0, 59);
  if (draft.mode === "hours") {
    return `${minute} */${interval} * * *`;
  }

  const hour = clamp(Math.trunc(draft.hour), 0, 23);
  if (draft.mode === "days") {
    return `${minute} ${hour} */${interval} * *`;
  }

  const dayOfWeek = clamp(Math.trunc(draft.dayOfWeek), 1, 7);
  if (interval === 1) {
    return `${minute} ${hour} * * ${dayOfWeek}`;
  }
  return `${minute} ${hour} */${interval * 7} * *`;
}

export function cronExpressionPreview(draft: ScheduleDraft): string {
  try {
    return cronExpressionForSchedule(draft);
  } catch {
    return "Invalid schedule";
  }
}

export function scheduleIntervalMax(mode: ScheduleMode): number {
  if (mode === "hours") return 23;
  if (mode === "weeks") return 4;
  return 31;
}

export function parseCronNumber(value: string, min: number, max: number): number | null {
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) return null;
  return parsed;
}

export function numberFromInput(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function timeInputValue(hour: number, minute: number): string {
  return `${String(clamp(Math.trunc(hour), 0, 23)).padStart(2, "0")}:${String(clamp(Math.trunc(minute), 0, 59)).padStart(2, "0")}`;
}

export function parseTimeInput(value: string): { hour: number; minute: number } {
  const [hour = "0", minute = "0"] = value.split(":");
  return {
    hour: clamp(numberFromInput(hour, 0), 0, 23),
    minute: clamp(numberFromInput(minute, 0), 0, 59),
  };
}

export function weekdays(): Array<{ value: number; label: string }> {
  return [
    { value: 1, label: "Monday" },
    { value: 2, label: "Tuesday" },
    { value: 3, label: "Wednesday" },
    { value: 4, label: "Thursday" },
    { value: 5, label: "Friday" },
    { value: 6, label: "Saturday" },
    { value: 7, label: "Sunday" },
  ];
}
