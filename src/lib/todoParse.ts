/**
 * Shared parser for natural-language todo capture used by QuickCapture
 * (in-app modal).
 *
 * Keeps behavior identical so users learn one set of conventions:
 *   - "urgent" / "!!" / "asap"        → priority 5
 *   - "important" / "!"                → priority 4
 *   - "someday" / "maybe" / "eventually" → priority 1, status 'someday'
 *   - "~30m" / "1h" / "45 min"          → estimatedMinutes (stripped from title)
 *
 * The duration token is removed from the resulting title; priority keywords
 * are intentionally left in (they're often part of the user's phrasing,
 * e.g. "urgent: call mom").
 */

export interface ParsedTodo {
  title: string;
  status: 'today' | 'someday';
  priority: 1 | 2 | 3 | 4 | 5;
  estimatedMinutes: number | null;
}

const DURATION_RE = /~?(\d+(?:\.\d+)?)\s*(h|hr|hour|hours|min|mins|m)\b/i;
const DURATION_GLOBAL_RE = /~?\d+(?:\.\d+)?\s*(h|hr|hour|hours|min|mins|m)\b/gi;

export function parseTodoInput(raw: string): ParsedTodo {
  const text = raw.trim();

  let priority: ParsedTodo['priority'] = 3;
  let status: ParsedTodo['status'] = 'today';

  if (/\burgent\b|!!|\basap\b/i.test(text)) {
    priority = 5;
  } else if (/\bimportant\b|!/.test(text)) {
    priority = 4;
  } else if (/\bsomeday\b|\bmaybe\b|\beventually\b/i.test(text)) {
    priority = 1;
    status = 'someday';
  }

  const durationMatch = text.match(DURATION_RE);
  let estimatedMinutes: number | null = null;
  if (durationMatch) {
    const n = parseFloat(durationMatch[1]);
    const unit = durationMatch[2].toLowerCase();
    estimatedMinutes = unit.startsWith('h') ? Math.round(n * 60) : Math.round(n);
  }

  // Strip the duration token from the title so it doesn't read awkwardly,
  // then collapse any double spaces left behind.
  const stripped = text.replace(DURATION_GLOBAL_RE, '').replace(/\s{2,}/g, ' ').trim();
  const title = stripped || text;

  return { title, status, priority, estimatedMinutes };
}
