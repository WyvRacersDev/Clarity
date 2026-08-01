/**
 * Pure iCalendar (RFC 5545) builder for the N10 calendar feed.
 *
 * No I/O and no DB — takes plain task rows and returns a `.ics` string, so it is
 * unit-testable in isolation. The route layer resolves the user + loads the
 * tasks; this only formats. Each task with a due date becomes a 30-minute VEVENT
 * anchored at the deadline (VEVENTs render on every major calendar client,
 * unlike VTODO which many ignore).
 */

/** The minimal task shape the feed needs. */
export interface IcsTask {
  id: string;
  taskname: string;
  /** ISO timestamp of the due date/time, or null (undated tasks are skipped). */
  due: string | null;
  is_done: boolean;
  priority: number;
  project_name: string;
}

const CRLF = "\r\n";
const DEFAULT_EVENT_MINUTES = 30;

/** Escape TEXT values per RFC 5545 §3.3.11 (backslash, comma, semicolon, newline). */
export function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/** Format a Date as a UTC iCalendar timestamp: YYYYMMDDTHHMMSSZ. */
export function formatUtc(date: Date): string {
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return (
    `${date.getUTCFullYear()}${p(date.getUTCMonth() + 1)}${p(date.getUTCDate())}` +
    `T${p(date.getUTCHours())}${p(date.getUTCMinutes())}${p(date.getUTCSeconds())}Z`
  );
}

/**
 * Fold a content line to <=75 octets per RFC 5545 §3.1 (continuation lines start
 * with a single space). Folding on characters is a safe approximation for the
 * ASCII-ish content we emit.
 */
export function foldLine(line: string): string {
  if (line.length <= 75) return line;
  const parts: string[] = [];
  let idx = 0;
  parts.push(line.slice(0, 75));
  idx = 75;
  while (idx < line.length) {
    parts.push(" " + line.slice(idx, idx + 74));
    idx += 74;
  }
  return parts.join(CRLF);
}

function priorityLabel(priority: number): string {
  // Matches the app's 1=high .. 3=low convention (lower number = higher priority).
  if (priority <= 1) return "High";
  if (priority === 2) return "Medium";
  return "Low";
}

/**
 * Build a full VCALENDAR string from the given tasks. `now` is injectable so the
 * DTSTAMP is deterministic in tests (defaults to the current time at call).
 */
export function buildIcsCalendar(
  tasks: IcsTask[],
  opts: { calName?: string; now?: Date } = {}
): string {
  const calName = opts.calName ?? "Clarity Tasks";
  const stamp = formatUtc(opts.now ?? new Date());

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Clarity//Tasks//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(calName)}`,
  ];

  for (const task of tasks) {
    if (!task.due) continue;
    const start = new Date(task.due);
    if (Number.isNaN(start.getTime())) continue;
    const end = new Date(start.getTime() + DEFAULT_EVENT_MINUTES * 60_000);

    const summary = `${task.is_done ? "✓ " : ""}${task.taskname}`;
    const description = `Project: ${task.project_name} · Priority: ${priorityLabel(
      task.priority
    )}`;

    lines.push(
      "BEGIN:VEVENT",
      `UID:task-${task.id}@clarity`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${formatUtc(start)}`,
      `DTEND:${formatUtc(end)}`,
      foldLine(`SUMMARY:${escapeText(summary)}`),
      foldLine(`DESCRIPTION:${escapeText(description)}`),
      // Done tasks are cancelled so calendars can grey/strike them; the ✓ in the
      // summary conveys completion for clients that ignore STATUS.
      `STATUS:${task.is_done ? "CANCELLED" : "CONFIRMED"}`,
      "END:VEVENT"
    );
  }

  lines.push("END:VCALENDAR");
  return lines.join(CRLF) + CRLF;
}
