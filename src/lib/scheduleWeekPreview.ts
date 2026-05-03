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

/**
 * Days-until-due relative to a given date string.  Returns `Infinity` for
 * todos with no due date so they sort last on this axis.  Negative values
 * mean overdue.
 */
function daysUntilDue(todo: Todo, dateStr: string): number {
  if (!todo.dueAt) return Infinity;
  const due = new Date(todo.dueAt);
  if (Number.isNaN(due.getTime())) return Infinity;
  const dueDay = new Date(`${format(due, 'yyyy-MM-dd')}T00:00:00`);
  const slotDay = new Date(`${dateStr}T00:00:00`);
  return Math.round((dueDay.getTime() - slotDay.getTime()) / 86_400_000);
}

/**
 * Bias added to slot scores for due-soon / overdue todos.  Tuned so an
 * overdue or same-day-due task outranks a higher-priority task that isn't
 * urgent, without overwhelming peak-focus alignment.
 */
function dueUrgencyBias(todo: Todo, dateStr: string): number {
  const days = daysUntilDue(todo, dateStr);
  if (!Number.isFinite(days)) return 0;
  if (days < 0) return 6;        // overdue
  if (days === 0) return 5;      // due today
  if (days === 1) return 3;      // due tomorrow
  if (days <= 3) return 1.5;     // due this week
  return 0;
}

/**
 * Small bias for older todos so a long-stale task isn't forever outranked
 * by fresher work of equal priority.  Capped at +2 (≥30d old) to stay
 * subordinate to due-soon urgency.
 */
function taskAgeBias(todo: Todo, dateStr: string): number {
  if (!todo.createdAt) return 0;
  const created = new Date(todo.createdAt);
  if (Number.isNaN(created.getTime())) return 0;
  const slot = new Date(`${dateStr}T00:00:00`);
  const days = Math.max(0, Math.round((slot.getTime() - created.getTime()) / 86_400_000));
  if (days <= 1) return 0;
  if (days >= 30) return 2;
  return Math.min(2, days / 15);
}

/**
 * Reward placing a todo in a slot whose length is close to the todo's
 * duration; penalize burning a much longer free interval on a short task,
 * which would leave only thin slivers behind for the remaining todos.
 * Returns roughly [-1.5, +1].
 */
function durationFitBias(durationMinutes: number, intervalLengthMinutes: number): number {
  if (intervalLengthMinutes <= 0 || durationMinutes <= 0) return 0;
  const ratio = durationMinutes / intervalLengthMinutes;
  if (ratio >= 0.85) return 1;       // snug fit — best
  if (ratio >= 0.6) return 0.5;
  if (ratio >= 0.35) return 0;
  if (ratio >= 0.2) return -0.5;
  return -1.5;                        // tiny task in a huge slot
}

/**
 * Pressure penalty as the day fills toward its effective capacity.
 * 0 when empty, ramps up to ~-2 once we hit cap.  Lets a high-urgency
 * task still squeeze in but discourages piling more onto an already-full
 * day when other days have room.
 */
function workloadPressureBias(dayMinutesUsed: number, effectiveCap: number): number {
  if (effectiveCap <= 0) return 0;
  const ratio = Math.min(1.5, dayMinutesUsed / effectiveCap);
  if (ratio <= 0.5) return 0;
  return -2 * (ratio - 0.5) / 1;
}

/**
 * Cluster same-project work within a single day (tiny positive bias when
 * the day already has a block from the same project), and discourage
 * concentrating one project on one day across the whole week (negative
 * bias once a project already owns several blocks earlier in the week).
 */
function projectBalanceBias(
  todo: Todo,
  dayProjectCounts: Map<string, number>,
  weeklyProjectCounts: Map<string, number>,
): number {
  if (!todo.projectId) return 0;
  const dayCount = dayProjectCounts.get(todo.projectId) ?? 0;
  const weekCount = weeklyProjectCounts.get(todo.projectId) ?? 0;
  // Mild clustering bonus for the first-and-second hit on the same day.
  const clusterBonus = dayCount === 0 ? 0 : dayCount === 1 ? 0.5 : 0;
  // Across the week, after a project already has 2 blocks elsewhere, push
  // additional ones toward other days (small negative).  Note: the day's
  // own count is included in weekCount, so we subtract it to consider
  // *other* days only for the balance term.
  const elsewhere = weekCount - dayCount;
  const balancePenalty = elsewhere >= 2 ? -1 : elsewhere >= 1 ? -0.4 : 0;
  return clusterBonus + balancePenalty;
}

function sortGroup(todos: Todo[], dateStr: string): Todo[] {
  return [...todos].sort((a, b) => {
    // Primary: combined priority + due-urgency + age. Higher first.
    const aRank = a.priority + dueUrgencyBias(a, dateStr) + taskAgeBias(a, dateStr);
    const bRank = b.priority + dueUrgencyBias(b, dateStr) + taskAgeBias(b, dateStr);
    if (bRank !== aRank) return bRank - aRank;
    // Secondary: earlier dueAt wins (treat undefined as far future).
    const aDue = daysUntilDue(a, dateStr);
    const bDue = daysUntilDue(b, dateStr);
    if (aDue !== bDue) return aDue - bDue;
    // Tertiary: cluster by project to reduce context switching.
    const aProj = a.projectId ?? '';
    const bProj = b.projectId ?? '';
    return aProj.localeCompare(bProj);
  });
}

function reasonFor(
  todo: Todo,
  dateStr: string,
  isPeak: boolean,
  opts: {
    /** Length of the chosen free slot, in minutes. */
    intervalLengthMinutes: number;
    /** Duration the todo will occupy, in minutes. */
    durationMinutes: number;
    /** True when the day's status flags low-cognitive-load only (sick). */
    isSick: boolean;
  },
): string {
  const { intervalLengthMinutes, durationMinutes, isSick } = opts;
  const parts: string[] = [];

  // 1. Urgency leads — most actionable signal for the user.
  let urgencyLabel: string | null = null;
  if (todo.dueAt) {
    const due = new Date(todo.dueAt);
    if (!Number.isNaN(due.getTime())) {
      const dueDateStr = format(due, 'yyyy-MM-dd');
      if (dueDateStr < dateStr) urgencyLabel = 'Overdue';
      else if (dueDateStr === dateStr) urgencyLabel = 'Due today';
      else {
        const slotDay = new Date(`${dateStr}T00:00:00`);
        const dueDay = new Date(`${dueDateStr}T00:00:00`);
        const daysUntil = Math.round((dueDay.getTime() - slotDay.getTime()) / 86_400_000);
        if (daysUntil === 1) urgencyLabel = 'Due tomorrow';
        else if (daysUntil <= 3) urgencyLabel = 'Due soon';
      }
    }
  }
  if (urgencyLabel) parts.push(urgencyLabel);

  // 2. Sick-day light-work callout — explains why a low-energy task got the slot.
  if (isSick && todo.cognitiveLoad === 'low') {
    parts.push('Low-energy task for sick day');
  } else if (isSick && todo.cognitiveLoad !== 'high') {
    parts.push('Lighter task for sick day');
  } else if (todo.cognitiveLoad === 'high' && isPeak) {
    parts.push('Deep work in peak focus hours');
  } else if (todo.cognitiveLoad === 'low' && !isPeak) {
    parts.push('Light task in off-peak hours');
  } else if (isPeak) {
    parts.push('Peak focus window');
  } else if (parts.length === 0) {
    // Only fall back to "Next free slot" if nothing more specific landed.
    parts.push('Next free slot');
  }

  // 3. Priority + project context — surfaces "High priority project task".
  if (todo.priority >= 4 && todo.projectId) {
    parts.push(todo.priority >= 5 ? 'Critical project task' : 'High-priority project task');
  } else if (todo.priority >= 4) {
    parts.push(`P${todo.priority} priority`);
  }

  // 4. Duration fit — note when the task snugly uses the chosen gap.
  if (intervalLengthMinutes > 0 && durationMinutes > 0) {
    const ratio = durationMinutes / intervalLengthMinutes;
    if (ratio >= 0.7) {
      const gap = Math.round(intervalLengthMinutes / 5) * 5;
      parts.push(`Fits ${gap}m gap`);
    }
  }

  // Cap at 3 segments to keep the chip readable.
  return parts.slice(0, 3).join(' · ');
}

interface DayPlanContext {
  dateStr: string;
  unscheduledTodos: Todo[];
  existingBlocks: TimeBlock[];
  projectNameById: Map<string, string>;
  peakSet: Set<number>;
  /** When true, schedule even if the day's status would normally suppress
   *  the routine (vacation / off).  Sick still applies its lighter-load
   *  rules — that's a capacity adjustment, not a hard skip. */
  allowSkippedDay: boolean;
  /** Cumulative projectId → block count across previously planned days in
   *  the same week.  Mutated by planDay as it places new blocks so later
   *  days can see and push back against concentration. */
  weeklyProjectCounts: Map<string, number>;
}

async function planDay(ctx: DayPlanContext): Promise<DayPreview> {
  const {
    dateStr,
    unscheduledTodos,
    existingBlocks,
    projectNameById,
    peakSet,
    allowSkippedDay,
    weeklyProjectCounts,
  } = ctx;
  const dayStatus = await getDayStatus(dateStr);
  if (suppressesRoutine(dayStatus) && !allowSkippedDay) {
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
  // On sick days, drop high-cognitive-load tasks from the candidate pool
  // entirely — sick days are for lighter work only.  prefersLowCognitiveLoad
  // already biases ordering, but the explicit filter makes the rule
  // observable in the preview and prevents a "deep work" task from sneaking
  // in just because it's overdue.
  let todosToSchedule = isSick
    ? unscheduledTodos.filter((t) => t.cognitiveLoad !== 'high')
    : unscheduledTodos;
  if (existingMinutes + estimatedMinutesAll > effectiveCap) {
    const scored = todosToSchedule.map((todo) => ({
      todo,
      // Boost capacity-cap selection with due-soon urgency + age so a
      // critical or long-stale task isn't dropped just because its base
      // priority is moderate.
      score:
        todoScore(todo) +
        dueUrgencyBias(todo, dateStr) +
        taskAgeBias(todo, dateStr),
    }));
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

  // Day-level state used by the slot scorer.  Seeded with whatever
  // already-scheduled blocks are on the day so newly proposed work still
  // respects existing project distribution and remaining headroom.
  const dayProjectCounts = new Map<string, number>();
  for (const block of existingBlocks) {
    if (block.projectId) {
      dayProjectCounts.set(block.projectId, (dayProjectCounts.get(block.projectId) ?? 0) + 1);
    }
  }
  let dayMinutesUsed = existingMinutes;

  function scoreSlot(
    todo: Todo,
    startMinute: number,
    durationMinutes: number,
    intervalLengthMinutes: number,
  ): number {
    const centerHour = Math.floor((startMinute + durationMinutes / 2) / 60);
    const isPeak = peakSet.has(centerHour);
    // Cognitive-load × time-of-day fit.
    const loadBias =
      todo.cognitiveLoad === 'high' ? (isPeak ? 4 : -2) :
      todo.cognitiveLoad === 'low' ? (isPeak ? -1 : 2) :
      (isPeak ? 2 : 0);
    // Priority + due-soon urgency + age.
    const urgencyBias =
      todo.priority + dueUrgencyBias(todo, dateStr) + taskAgeBias(todo, dateStr);
    // Prefer earlier starts so urgent work happens before the day drifts.
    const earlierBias = (DAY_END - startMinute) / 120;
    // Penalize burning a much-longer slot on a tiny task.
    const fitBias = durationFitBias(durationMinutes, intervalLengthMinutes);
    // Penalize piling onto a day that's already near its effective cap.
    const pressureBias = workloadPressureBias(dayMinutesUsed, effectiveCap);
    // Cluster within day, balance across week.
    const projectBias = projectBalanceBias(todo, dayProjectCounts, weeklyProjectCounts);
    return loadBias + urgencyBias + earlierBias + fitBias + pressureBias + projectBias;
  }

  const highLoad = sortGroup(todosToSchedule.filter((t) => t.cognitiveLoad === 'high'), dateStr);
  const mediumLoad = sortGroup(
    todosToSchedule.filter((t) => t.cognitiveLoad === 'medium' || t.cognitiveLoad === null),
    dateStr,
  );
  const lowLoad = sortGroup(todosToSchedule.filter((t) => t.cognitiveLoad === 'low'), dateStr);
  const orderedTodos = isSick
    // High-cognitive-load todos were filtered out of `todosToSchedule`
    // earlier on sick days, so `highLoad` is always empty here — list only
    // the bands that can actually contribute, light first.
    ? [...lowLoad, ...mediumLoad]
    : [...highLoad, ...mediumLoad, ...lowLoad];

  const blocks: ProposedBlock[] = [];
  let unplaced = 0;

  for (const todo of orderedTodos) {
    const duration = normalizeTodoMinutes(todo);
    const candidates = freeIntervals
      .filter((interval) => interval.end - interval.start >= duration)
      .map((interval) => ({
        interval,
        score: scoreSlot(todo, interval.start, duration, interval.end - interval.start),
      }))
      .sort((a, b) => b.score - a.score || a.interval.start - b.interval.start);

    if (candidates.length === 0) {
      unplaced += 1;
      continue;
    }

    const winner = candidates[0].interval;
    const startMinute = winner.start;
    const endMinute = startMinute + duration;
    const intervalLength = winner.end - winner.start;
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
      reason: reasonFor(todo, dateStr, isPeak, {
        intervalLengthMinutes: intervalLength,
        durationMinutes: duration,
        isSick,
      }),
    });

    // Update day-level state so subsequent slot scoring sees this placement.
    dayMinutesUsed += duration;
    if (todo.projectId) {
      dayProjectCounts.set(
        todo.projectId,
        (dayProjectCounts.get(todo.projectId) ?? 0) + 1,
      );
      weeklyProjectCounts.set(
        todo.projectId,
        (weeklyProjectCounts.get(todo.projectId) ?? 0) + 1,
      );
    }

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
  /**
   * Date strings for which the planner is *explicitly* allowed to schedule
   * even though the day's status (vacation / off) would normally suppress
   * the routine.  Days not in this set follow the default skip behaviour.
   */
  allowedSkippedDates?: Set<string>;
}

/**
 * Plans a non-mutating preview for an entire week.  Each candidate todo is
 * placed on at most one day; days are processed in input order so earlier
 * days get first pick of urgent work.  Skipped days (vacation / off) are
 * returned with `skippedReason` set so callers can surface that to the user.
 */
export async function previewWeekSchedule(input: PreviewInput): Promise<DayPreview[]> {
  const { dateStrs, candidateTodos, projectNameById, allowedSkippedDates } = input;
  const peakHours = await getPeakFocusHours();
  const peakSet = new Set(peakHours.length ? peakHours : FALLBACK_PEAK_HOURS);

  // Pre-fetch existing blocks for every day in the preview window so we can
  // (a) reuse them per-day as busy intervals (preserving fixed/manual blocks),
  // and (b) seed the dedupe set with todoIds that are *already* scheduled
  // anywhere in the week — no todo should be proposed twice.
  const blocksByDate = new Map<string, TimeBlock[]>();
  await Promise.all(
    dateStrs.map(async (dateStr) => {
      const blocks = await getTimeBlocksByDate(dateStr);
      blocksByDate.set(dateStr, blocks);
    }),
  );
  const claimed = new Set<string>();
  // Seed week-wide project counts from blocks that already exist before
  // planning starts.  The planner mutates this map as it places new
  // blocks, so later days within the same call see the running total.
  const weeklyProjectCounts = new Map<string, number>();
  for (const blocks of blocksByDate.values()) {
    for (const block of blocks) {
      if (block.todoId) claimed.add(block.todoId);
      if (block.projectId) {
        weeklyProjectCounts.set(
          block.projectId,
          (weeklyProjectCounts.get(block.projectId) ?? 0) + 1,
        );
      }
    }
  }

  const days: DayPreview[] = [];
  for (const dateStr of dateStrs) {
    const existingBlocks = blocksByDate.get(dateStr) ?? [];
    const remaining = candidateTodos.filter((t) => !claimed.has(t.id));
    const day = await planDay({
      dateStr,
      unscheduledTodos: remaining,
      existingBlocks,
      projectNameById,
      peakSet,
      allowSkippedDay: allowedSkippedDates?.has(dateStr) ?? false,
      weeklyProjectCounts,
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
