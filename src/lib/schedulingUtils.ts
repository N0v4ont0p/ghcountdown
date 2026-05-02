import { format } from 'date-fns';
import { Todo, TimeBlock } from '@/db/schema';
import { createTimeBlock } from '@/db/repositories/timeBlocksRepo';
import { getAllEvents } from '@/db/repositories/eventsRepo';
import { getPeakFocusHours } from '@/lib/energyHours';
import { getEffectiveScheduleForDate } from '@/lib/effectiveSchedule';
import {
  getDayStatus,
  prefersLowCognitiveLoad,
  suppressesRoutine,
} from '@/db/repositories/dayStatusRepo';
import { toast } from 'sonner';

export const PRIORITY_COLORS: Record<number, string> = {
  5: 'oklch(0.58 0.20 20)',
  4: 'oklch(0.65 0.18 40)',
  3: 'oklch(0.58 0.20 260)',
  2: 'oklch(0.60 0.16 240)',
  1: 'oklch(0.65 0.12 200)',
};

/**
 * Returns a color with reduced opacity by inserting an alpha value into the
 * oklch() function, e.g. oklch(0.58 0.20 20) → oklch(0.58 0.20 20 / 0.2).
 */
export function withColorAlpha(color: string, alpha: number): string {
  const trimmed = color.trim();
  if (trimmed.startsWith('oklch(') && trimmed.endsWith(')')) {
    return `oklch(${trimmed.slice(6, -1)} / ${alpha})`;
  }
  // Fallback: wrap in color-mix for non-oklch formats
  return `color-mix(in srgb, ${trimmed} ${Math.round(alpha * 100)}%, transparent)`;
}

/** Maximum working minutes before the day is considered overloaded. */
export const DAY_CAPACITY_MINUTES = 480;

/** Default estimated duration per todo when no explicit estimate exists (minutes). */
export const DEFAULT_TODO_MINUTES = 60;
const SCHEDULING_GRANULARITY_MINUTES = 15;
const MIN_TODO_MINUTES = 30;
const MAX_TODO_MINUTES = 180;
const EVENT_BUSY_BUFFER_MINUTES = 60;

/**
 * Compute a combined score for a todo used to rank it under capacity constraints.
 * Higher score → schedule first.
 *   priority contributes 0-4 (p1→0, p5→4)
 *   cognitive load: high→2, medium→1, low→0, null→1
 */
export function todoScore(todo: Todo): number {
  const priorityScore = Math.max(0, todo.priority - 1);
  const loadScore =
    todo.cognitiveLoad === 'high' ? 2 :
    todo.cognitiveLoad === 'low'  ? 0 : 1;
  return priorityScore + loadScore;
}

function toMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return (h * 60) + m;
}

function fromMinutes(totalMinutes: number): string {
  const clamped = ((totalMinutes % (24 * 60)) + (24 * 60)) % (24 * 60);
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function normalizeTodoMinutes(todo: Todo): number {
  const estimated = todo.estimatedMinutes ?? DEFAULT_TODO_MINUTES;
  const bounded = Math.min(MAX_TODO_MINUTES, Math.max(MIN_TODO_MINUTES, estimated));
  return Math.ceil(bounded / SCHEDULING_GRANULARITY_MINUTES) * SCHEDULING_GRANULARITY_MINUTES;
}

function mergeIntervals(intervals: Array<{ start: number; end: number }>): Array<{ start: number; end: number }> {
  const sorted = intervals
    .filter((it) => it.end > it.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  if (sorted.length === 0) return [];
  const merged: Array<{ start: number; end: number }> = [{ ...sorted[0] }];
  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i];
    const last = merged[merged.length - 1];
    if (current.start <= last.end) {
      last.end = Math.max(last.end, current.end);
    } else {
      merged.push({ ...current });
    }
  }
  return merged;
}

/**
 * Sort a group of todos to minimise context switching:
 * - Higher priority first
 * - Same-project todos cluster together
 */
function sortGroup(todos: Todo[]): Todo[] {
  return [...todos].sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    const aProj = a.projectId ?? '';
    const bProj = b.projectId ?? '';
    return aProj.localeCompare(bProj);
  });
}

/**
 * Schedules unscheduled todos as time blocks for the given date.
 *
 * Cognitive load aware:
 *   - High load (deep work) → peak focus hours first.
 *   - Low load (easy/admin) → off-peak hours.
 *   - Medium / unset       → any remaining slot (peak preferred).
 *
 * Project grouping: within each cognitive-load band todos are sorted so
 * same-project tasks land in consecutive slots, reducing context switching.
 *
 * Capacity cap: if scheduling all provided todos would push the day over
 * DAY_CAPACITY_MINUTES, only the top 5 ranked by combined priority + cognitive
 * load score are scheduled and a toast warning is shown.
 *
 * Returns the number of time blocks created.
 */
export async function scheduleMyDay(
  dateStr: string,
  unscheduledTodos: Todo[],
  existingBlocks: TimeBlock[]
): Promise<number> {
  if (unscheduledTodos.length === 0) return 0;

  // Day-status gate: vacation / off pause auto-scheduling entirely.  The user
  // can still drag individual todos onto the timeline.
  const dayStatus = await getDayStatus(dateStr);
  if (suppressesRoutine(dayStatus)) {
    toast.info(
      dayStatus === 'vacation'
        ? "It's a vacation day — auto-schedule is paused. Drag todos in manually if you want."
        : "It's marked off — auto-schedule is paused. Drag todos in manually if you want.",
    );
    return 0;
  }
  const isSick = prefersLowCognitiveLoad(dayStatus);

  const DAY_START = 7 * 60;
  const DAY_END = 22 * 60;
  const now = new Date();
  const todayStr = format(now, 'yyyy-MM-dd');
  const minStartMinute = dateStr === todayStr
    ? Math.max(
        DAY_START,
        Math.ceil((now.getHours() * 60 + now.getMinutes()) / SCHEDULING_GRANULARITY_MINUTES) * SCHEDULING_GRANULARITY_MINUTES
      )
    : DAY_START;

  const existingIntervals = existingBlocks.flatMap((block) => {
    const start = toMinutes(block.startTime);
    const end = toMinutes(block.endTime);
    if (end <= start) {
      return [];
    }
    return [{ start, end }];
  });
  const existingMinutes = existingIntervals.reduce((sum, interval) => sum + (interval.end - interval.start), 0);

  const estimatedMinutesAll = unscheduledTodos.reduce((sum, todo) => sum + normalizeTodoMinutes(todo), 0);
  let todosToSchedule = unscheduledTodos;
  // Half the daily cap on sick days so we don't pile work onto someone who's
  // recovering.  The "top N under cap" path below uses the same cap.
  const effectiveCap = isSick ? Math.round(DAY_CAPACITY_MINUTES / 2) : DAY_CAPACITY_MINUTES;
  const MAX_TODOS_UNDER_CAP = isSick ? 3 : 5;
  if (existingMinutes + estimatedMinutesAll > effectiveCap) {
    const scored = unscheduledTodos.map((todo) => ({ todo, score: todoScore(todo) }));
    scored.sort((a, b) => b.score - a.score);
    todosToSchedule = scored.slice(0, MAX_TODOS_UNDER_CAP).map((s) => s.todo);
    toast.warning(
      isSick
        ? `Sick day — scheduling top ${MAX_TODOS_UNDER_CAP} tasks only. ` +
          `${Math.max(0, unscheduledTodos.length - MAX_TODOS_UNDER_CAP)} task(s) skipped.`
        : `Day would exceed 8 hours — scheduling top ${MAX_TODOS_UNDER_CAP} tasks only. ` +
          `${Math.max(0, unscheduledTodos.length - MAX_TODOS_UNDER_CAP)} task(s) skipped.`,
    );
  }

  const [peakHours, allEvents, effectiveSchedule] = await Promise.all([
    getPeakFocusHours(),
    getAllEvents(),
    getEffectiveScheduleForDate(dateStr),
  ]);
  const fallbackPeak = [9, 10, 14, 15];
  const peakSet = new Set(peakHours.length ? peakHours : fallbackPeak);

  const eventIntervals = allEvents
    .filter((event) => !event.allDay && format(new Date(event.startsAt), 'yyyy-MM-dd') === dateStr)
    .map((event) => {
      const startsAt = new Date(event.startsAt);
      const start = startsAt.getHours() * 60 + startsAt.getMinutes();
      // Events currently only store startsAt (no explicit end time),
      // so reserve a conservative one-hour conflict buffer.
      const end = start + EVENT_BUSY_BUFFER_MINUTES;
      return { start, end };
    });

  const protectedIntervals = [
    { start: 0, end: DAY_START },                  // sleep (early)
    { start: DAY_END, end: 24 * 60 },              // sleep (late)
    { start: 12 * 60, end: 13 * 60 },              // lunch
    { start: 18 * 60, end: 19 * 60 },              // dinner
    ...effectiveSchedule
      .filter((entry) => entry.kind === 'fixed')
      .map((entry) => ({ start: toMinutes(entry.startTime), end: toMinutes(entry.endTime) })),
  ];

  let freeIntervals = (() => {
    const busy = mergeIntervals([
      ...existingIntervals,
      ...eventIntervals,
      ...protectedIntervals,
    ]).map((interval) => ({
      start: Math.max(interval.start, minStartMinute),
      end: Math.min(interval.end, DAY_END),
    })).filter((interval) => interval.end > interval.start);

    const free: Array<{ start: number; end: number }> = [];
    let cursor = minStartMinute;
    for (const interval of busy) {
      if (cursor < interval.start) {
        free.push({ start: cursor, end: interval.start });
      }
      cursor = Math.max(cursor, interval.end);
    }
    if (cursor < DAY_END) {
      free.push({ start: cursor, end: DAY_END });
    }
    return free;
  })();

  function scoreSlot(todo: Todo, startMinute: number, durationMinutes: number): number {
    const centerHour = Math.floor((startMinute + durationMinutes / 2) / 60);
    const isPeak = peakSet.has(centerHour);
    const loadBias =
      todo.cognitiveLoad === 'high' ? (isPeak ? 4 : -2) :
      todo.cognitiveLoad === 'low' ? (isPeak ? -1 : 2) :
      (isPeak ? 2 : 0);
    const urgencyBias = todo.priority;
    const earlierBias = (DAY_END - startMinute) / 120;
    return loadBias + urgencyBias + earlierBias;
  }

  const highLoad = sortGroup(todosToSchedule.filter((t) => t.cognitiveLoad === 'high'));
  const mediumLoad = sortGroup(todosToSchedule.filter((t) => t.cognitiveLoad === 'medium' || t.cognitiveLoad === null));
  const lowLoad = sortGroup(todosToSchedule.filter((t) => t.cognitiveLoad === 'low'));
  // On sick days flip the order so low cognitive-load tasks are placed first
  // (they get the best slots and are most likely to fit before the cap).
  const orderedTodos = isSick
    ? [...lowLoad, ...mediumLoad, ...highLoad]
    : [...highLoad, ...mediumLoad, ...lowLoad];

  let created = 0;
  let skipped = 0;

  for (const todo of orderedTodos) {
    const duration = normalizeTodoMinutes(todo);
    const candidates = freeIntervals
      .filter((interval) => interval.end - interval.start >= duration)
      .map((interval) => ({
        interval,
        score: scoreSlot(todo, interval.start, duration),
      }))
      .sort((a, b) => b.score - a.score || a.interval.start - b.interval.start);

    if (candidates.length === 0) {
      skipped += 1;
      continue;
    }

    const winner = candidates[0].interval;
    const startMinute = winner.start;
    const endMinute = startMinute + duration;
    const color = PRIORITY_COLORS[todo.priority] ?? PRIORITY_COLORS[3];

    await createTimeBlock({
      title: todo.title,
      date: dateStr,
      startTime: fromMinutes(startMinute),
      endTime: fromMinutes(endMinute),
      todoId: todo.id,
      projectId: todo.projectId,
      color,
      autoTrack: true,
      slotType: 'fixed',
    });

    const nextIntervals: Array<{ start: number; end: number }> = [];
    for (const interval of freeIntervals) {
      if (interval.start <= startMinute && interval.end >= endMinute) {
        if (interval.start < winner.start) {
          nextIntervals.push({ start: interval.start, end: startMinute });
        }
        if (endMinute < interval.end) {
          nextIntervals.push({ start: endMinute, end: interval.end });
        }
      } else {
        nextIntervals.push(interval);
      }
    }
    freeIntervals = nextIntervals;
    created += 1;
  }

  if (skipped > 0) {
    toast.warning(`${skipped} task(s) could not be scheduled without conflicts`);
  }

  return created;
}
