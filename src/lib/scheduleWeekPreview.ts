import { format } from 'date-fns';
import { Todo, TimeBlock } from '@/db/schema';
import { getAllEvents } from '@/db/repositories/eventsRepo';
import { getTimeBlocksByDate } from '@/db/repositories/timeBlocksRepo';
import { createTimeBlock } from '@/db/repositories/timeBlocksRepo';
import { getPeakFocusHours } from '@/lib/energyHours';
import { getEffectiveScheduleForDate } from '@/lib/effectiveSchedule';
import {
  getDayStatus,
  prefersLowCognitiveLoad,
  suppressesRoutine,
} from '@/db/repositories/dayStatusRepo';
import {
  DAY_CAPACITY_MINUTES,
  DEFAULT_TODO_MINUTES,
  PRIORITY_COLORS,
  todoScore,
} from '@/lib/schedulingUtils';
import { broadcastDataChanged } from '@/lib/dataSync';

/**
 * A single proposed time block produced by {@link previewWeekSchedule}.  These
 * are pure data — nothing is persisted until {@link applyWeekPreview} is
 * called.
 */
export interface ProposedBlock {
  /** ISO date (yyyy-MM-dd) that the block belongs to. */
  date: string;
  /** Inclusive start time, HH:mm. */
  startTime: string;
  /** Exclusive end time, HH:mm. */
  endTime: string;
  /** Title — copied from the source todo. */
  title: string;
  /** Source todo id; needed when actually creating blocks on apply. */
  todoId: string;
  /** Optional project id. */
  projectId: string | null;
  /** Optional project display name (resolved when generating the preview). */
  projectName: string | null;
  /** Block color (priority-derived). */
  color: string;
  /** Short, human-readable explanation for why this slot was chosen. */
  reason: string;
}

/** Preview entry for a single day in the selected week. */
export interface DayPreview {
  date: string;
  blocks: ProposedBlock[];
  /** When non-null, the day was skipped wholesale (e.g. vacation). */
  skippedReason: string | null;
  /** Number of unscheduled todos that could not be slotted. */
  unplaced: number;
}

const SCHEDULING_GRANULARITY_MINUTES = 15;
const MIN_TODO_MINUTES = 30;
const MAX_TODO_MINUTES = 180;
const EVENT_BUSY_BUFFER_MINUTES = 60;
const DAY_START = 7 * 60;
const DAY_END = 22 * 60;
const FALLBACK_PEAK_HOURS = [9, 10, 14, 15];

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

function mergeIntervals(
  intervals: Array<{ start: number; end: number }>,
): Array<{ start: number; end: number }> {
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

function sortGroup(todos: Todo[]): Todo[] {
  return [...todos].sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    const aProj = a.projectId ?? '';
    const bProj = b.projectId ?? '';
    return aProj.localeCompare(bProj);
  });
}

function reasonFor(todo: Todo, dateStr: string, isPeak: boolean): string {
  const parts: string[] = [];
  if (todo.cognitiveLoad === 'high' && isPeak) {
    parts.push('Deep work in peak focus hours');
  } else if (todo.cognitiveLoad === 'low' && !isPeak) {
    parts.push('Light task in off-peak hours');
  } else if (isPeak) {
    parts.push('Peak focus window');
  } else {
    parts.push('Next free slot');
  }
  if (todo.priority >= 4) {
    parts.push(`P${todo.priority} priority`);
  }
  // Surface dueAt urgency relative to the day this slot lives on, not "today".
  if (todo.dueAt) {
    const due = new Date(todo.dueAt);
    if (!Number.isNaN(due.getTime())) {
      const dueDateStr = format(due, 'yyyy-MM-dd');
      if (dueDateStr < dateStr) {
        parts.push('Overdue');
      } else if (dueDateStr === dateStr) {
        parts.push('Due today');
      } else {
        // "Due soon" if the due date is within ~2 days after the slot's date.
        const slotDay = new Date(`${dateStr}T00:00:00`);
        const dueDay = new Date(`${dueDateStr}T00:00:00`);
        const daysUntil = Math.round((dueDay.getTime() - slotDay.getTime()) / 86_400_000);
        if (daysUntil > 0 && daysUntil <= 2) {
          parts.push('Due soon');
        }
      }
    }
  }
  return parts.join(' · ');
}

interface DayPlanContext {
  dateStr: string;
  unscheduledTodos: Todo[];
  existingBlocks: TimeBlock[];
  projectNameById: Map<string, string>;
  peakSet: Set<number>;
}

async function planDay(ctx: DayPlanContext): Promise<DayPreview> {
  const { dateStr, unscheduledTodos, existingBlocks, projectNameById, peakSet } = ctx;
  const dayStatus = await getDayStatus(dateStr);
  if (suppressesRoutine(dayStatus)) {
    return {
      date: dateStr,
      blocks: [],
      skippedReason: dayStatus === 'vacation' ? 'Vacation day' : 'Marked off',
      unplaced: unscheduledTodos.length,
    };
  }

  if (unscheduledTodos.length === 0) {
    return { date: dateStr, blocks: [], skippedReason: null, unplaced: 0 };
  }

  const isSick = prefersLowCognitiveLoad(dayStatus);
  const todayStr = format(new Date(), 'yyyy-MM-dd');
  const now = new Date();
  const minStartMinute = dateStr === todayStr
    ? Math.max(
        DAY_START,
        Math.ceil(
          (now.getHours() * 60 + now.getMinutes()) / SCHEDULING_GRANULARITY_MINUTES,
        ) * SCHEDULING_GRANULARITY_MINUTES,
      )
    : DAY_START;

  const existingIntervals = existingBlocks.flatMap((block) => {
    const start = toMinutes(block.startTime);
    const end = toMinutes(block.endTime);
    if (end <= start) return [];
    return [{ start, end }];
  });
  const existingMinutes = existingIntervals.reduce(
    (sum, interval) => sum + (interval.end - interval.start),
    0,
  );

  const estimatedMinutesAll = unscheduledTodos.reduce(
    (sum, todo) => sum + normalizeTodoMinutes(todo),
    0,
  );
  const effectiveCap = isSick ? Math.round(DAY_CAPACITY_MINUTES / 2) : DAY_CAPACITY_MINUTES;
  const MAX_TODOS_UNDER_CAP = isSick ? 3 : 5;
  let todosToSchedule = unscheduledTodos;
  if (existingMinutes + estimatedMinutesAll > effectiveCap) {
    const scored = unscheduledTodos.map((todo) => ({ todo, score: todoScore(todo) }));
    scored.sort((a, b) => b.score - a.score);
    todosToSchedule = scored.slice(0, MAX_TODOS_UNDER_CAP).map((s) => s.todo);
  }

  const [allEvents, effectiveSchedule] = await Promise.all([
    getAllEvents(),
    getEffectiveScheduleForDate(dateStr),
  ]);

  const eventIntervals = allEvents
    .filter((event) => !event.allDay && format(new Date(event.startsAt), 'yyyy-MM-dd') === dateStr)
    .map((event) => {
      const startsAt = new Date(event.startsAt);
      const start = startsAt.getHours() * 60 + startsAt.getMinutes();
      const end = start + EVENT_BUSY_BUFFER_MINUTES;
      return { start, end };
    });

  const protectedIntervals = [
    { start: 0, end: DAY_START },
    { start: DAY_END, end: 24 * 60 },
    { start: 12 * 60, end: 13 * 60 },
    { start: 18 * 60, end: 19 * 60 },
    ...effectiveSchedule
      .filter((entry) => entry.kind === 'fixed')
      .map((entry) => ({ start: toMinutes(entry.startTime), end: toMinutes(entry.endTime) })),
  ];

  let freeIntervals = (() => {
    const busy = mergeIntervals([
      ...existingIntervals,
      ...eventIntervals,
      ...protectedIntervals,
    ])
      .map((interval) => ({
        start: Math.max(interval.start, minStartMinute),
        end: Math.min(interval.end, DAY_END),
      }))
      .filter((interval) => interval.end > interval.start);

    const free: Array<{ start: number; end: number }> = [];
    let cursor = minStartMinute;
    for (const interval of busy) {
      if (cursor < interval.start) free.push({ start: cursor, end: interval.start });
      cursor = Math.max(cursor, interval.end);
    }
    if (cursor < DAY_END) free.push({ start: cursor, end: DAY_END });
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
  const mediumLoad = sortGroup(
    todosToSchedule.filter((t) => t.cognitiveLoad === 'medium' || t.cognitiveLoad === null),
  );
  const lowLoad = sortGroup(todosToSchedule.filter((t) => t.cognitiveLoad === 'low'));
  const orderedTodos = isSick
    ? [...lowLoad, ...mediumLoad, ...highLoad]
    : [...highLoad, ...mediumLoad, ...lowLoad];

  const blocks: ProposedBlock[] = [];
  let unplaced = 0;

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
      unplaced += 1;
      continue;
    }

    const winner = candidates[0].interval;
    const startMinute = winner.start;
    const endMinute = startMinute + duration;
    const centerHour = Math.floor((startMinute + duration / 2) / 60);
    const isPeak = peakSet.has(centerHour);
    const color = PRIORITY_COLORS[todo.priority] ?? PRIORITY_COLORS[3];

    blocks.push({
      date: dateStr,
      startTime: fromMinutes(startMinute),
      endTime: fromMinutes(endMinute),
      title: todo.title,
      todoId: todo.id,
      projectId: todo.projectId,
      projectName: todo.projectId ? (projectNameById.get(todo.projectId) ?? null) : null,
      color,
      reason: reasonFor(todo, dateStr, isPeak),
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
  }

  blocks.sort((a, b) => a.startTime.localeCompare(b.startTime));

  return { date: dateStr, blocks, skippedReason: null, unplaced };
}

interface PreviewInput {
  /** ISO date strings (yyyy-MM-dd) for the days to preview, in order. */
  dateStrs: string[];
  /** All "today" todos used as the candidate pool. */
  candidateTodos: Todo[];
  /** Map of projectId → display name for surfacing project context. */
  projectNameById: Map<string, string>;
}

/**
 * Plans a non-mutating preview for an entire week.  Each candidate todo is
 * placed on at most one day; days are processed in input order so earlier
 * days get first pick of urgent work.  Skipped days (vacation / off) are
 * returned with `skippedReason` set so callers can surface that to the user.
 */
export async function previewWeekSchedule(input: PreviewInput): Promise<DayPreview[]> {
  const { dateStrs, candidateTodos, projectNameById } = input;
  const peakHours = await getPeakFocusHours();
  const peakSet = new Set(peakHours.length ? peakHours : FALLBACK_PEAK_HOURS);

  // Tracks which todos have been claimed by an earlier day in the week so
  // they don't get double-booked across days.
  const claimed = new Set<string>();
  const days: DayPreview[] = [];

  for (const dateStr of dateStrs) {
    const existingBlocks = await getTimeBlocksByDate(dateStr);
    const remaining = candidateTodos.filter((t) => !claimed.has(t.id));
    const day = await planDay({
      dateStr,
      unscheduledTodos: remaining,
      existingBlocks,
      projectNameById,
      peakSet,
    });
    for (const block of day.blocks) claimed.add(block.todoId);
    days.push(day);
  }

  return days;
}

/**
 * Persists a previously-generated preview by creating one TimeBlock per
 * proposed block.  Returns the count of blocks actually created.  Notifies
 * other windows via {@link broadcastDataChanged} on success.
 */
export async function applyWeekPreview(days: DayPreview[]): Promise<number> {
  let created = 0;
  for (const day of days) {
    for (const block of day.blocks) {
      await createTimeBlock({
        title: block.title,
        date: block.date,
        startTime: block.startTime,
        endTime: block.endTime,
        todoId: block.todoId,
        projectId: block.projectId,
        color: block.color,
        autoTrack: true,
        slotType: 'fixed',
      });
      created += 1;
    }
  }
  if (created > 0) {
    broadcastDataChanged();
  }
  return created;
}
