import { format } from 'date-fns';
import { Todo, TimeBlock } from '@/db/schema';
import { createTimeBlock } from '@/db/repositories/timeBlocksRepo';
import { getPeakFocusHours } from '@/lib/energyHours';

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

const DEFAULT_TODO_MINUTES = 60;
const MAX_PRODUCTIVE_HOURS = 8;
const OVERLOAD_MAX_TODOS = 5;

/**
 * Computes the total estimated workload (in minutes) for a given day.
 * Counts the duration of all scheduled time blocks plus the estimated minutes
 * for each unscheduled today-todo (default 60 min if no estimate set).
 */
export function computeDayLoadMinutes(
  existingBlocks: TimeBlock[],
  unscheduledTodos: Todo[]
): number {
  const blockMinutes = existingBlocks.reduce((sum, block) => {
    const [sh, sm] = block.startTime.split(':').map(Number);
    const [eh, em] = block.endTime.split(':').map(Number);
    return sum + (eh * 60 + em) - (sh * 60 + sm);
  }, 0);

  const todoMinutes = unscheduledTodos.reduce((sum, todo) => {
    return sum + (todo.estimatedMinutes ?? DEFAULT_TODO_MINUTES);
  }, 0);

  return blockMinutes + todoMinutes;
}

/**
 * Returns true if the current day load already exceeds 8 hours of productive time.
 */
export function isDayOverloaded(
  existingBlocks: TimeBlock[],
  unscheduledTodos: Todo[]
): boolean {
  return computeDayLoadMinutes(existingBlocks, unscheduledTodos) > MAX_PRODUCTIVE_HOURS * 60;
}

/**
 * Groups todos by project for context-aware scheduling.
 * Within each project cluster, todos are sorted by cognitiveLoad high→low.
 * Ungrouped (no project) todos come last.
 */
function groupByProject(todos: Todo[]): Todo[] {
  const clusters = new Map<string, Todo[]>();
  const ungrouped: Todo[] = [];

  for (const todo of todos) {
    if (todo.projectId) {
      const group = clusters.get(todo.projectId) ?? [];
      group.push(todo);
      clusters.set(todo.projectId, group);
    } else {
      ungrouped.push(todo);
    }
  }

  const sortByCognitiveLoad = (a: Todo, b: Todo) => {
    return (b.cognitiveLoad ?? 1) - (a.cognitiveLoad ?? 1);
  };

  const result: Todo[] = [];
  for (const group of clusters.values()) {
    result.push(...group.sort(sortByCognitiveLoad));
  }
  result.push(...ungrouped.sort(sortByCognitiveLoad));
  return result;
}

/**
 * Schedules unscheduled todos as time blocks for the given date.
 * High-priority todos (p5, p4) are placed first and earlier in the day.
 * Applies context grouping (by project, then by cognitiveLoad) to minimise
 * context switching. When the day is overloaded, caps scheduling to the top
 * OVERLOAD_MAX_TODOS todos by combined priority + cognitive load score.
 * Returns { created, wasOverloaded } so callers can surface a warning.
 */
export async function scheduleMyDay(
  dateStr: string,
  unscheduledTodos: Todo[],
  existingBlocks: TimeBlock[]
): Promise<{ created: number; wasOverloaded: boolean }> {
  if (unscheduledTodos.length === 0) return { created: 0, wasOverloaded: false };

  // Detect overload before we add the new todos
  const overloaded = isDayOverloaded(existingBlocks, unscheduledTodos);

  // When overloaded, pick the top OVERLOAD_MAX_TODOS todos by (priority*2 + cognitiveLoad)
  let todosToSchedule = [...unscheduledTodos];
  if (overloaded) {
    todosToSchedule = [...unscheduledTodos]
      .sort((a, b) => {
        const scoreA = a.priority * 2 + (a.cognitiveLoad ?? 1);
        const scoreB = b.priority * 2 + (b.cognitiveLoad ?? 1);
        return scoreB - scoreA;
      })
      .slice(0, OVERLOAD_MAX_TODOS);
  }

  // Apply context grouping: cluster by project, sort within clusters by cognitiveLoad desc
  const grouped = groupByProject(
    [...todosToSchedule].sort((a, b) => b.priority - a.priority)
  );

  // Build the set of hours already occupied by existing blocks.
  const occupiedHours = new Set<number>();
  for (const block of existingBlocks) {
    const [startH, startM] = block.startTime.split(':').map(Number);
    const [endH, endM] = block.endTime.split(':').map(Number);
    const startMinutes = startH * 60 + startM;
    const endMinutes = endH * 60 + endM;
    for (let h = Math.floor(startMinutes / 60); h < Math.ceil(endMinutes / 60); h++) {
      occupiedHours.add(h);
    }
  }

  const peakHours = await getPeakFocusHours();
  const fallback = [9, 10, 14, 15];
  const hours = peakHours.length ? peakHours : fallback;

  // Assign grouped todos to consecutive available slots
  const now = new Date();
  const todayStr = format(now, 'yyyy-MM-dd');
  let currentHour = 9;
  if (dateStr === todayStr) {
    currentHour = Math.max(9, now.getHours());
  }

  let created = 0;
  let slotCursor = currentHour;

  for (const todo of grouped) {
    // For high-priority todos (p4-5), prefer peak hours
    let slot: number | undefined;
    if (todo.priority >= 4) {
      slot = hours.find(h => !occupiedHours.has(h));
    }
    // For all others, place chronologically to keep project clusters consecutive
    if (slot === undefined) {
      while (slotCursor < 24 && occupiedHours.has(slotCursor)) slotCursor++;
      slot = slotCursor < 24 ? slotCursor : undefined;
    }
    if (slot === undefined) break;

    const startTime = `${String(slot).padStart(2, '0')}:00`;
    const endTime = `${String(slot + 1).padStart(2, '0')}:00`;
    const color = PRIORITY_COLORS[todo.priority] ?? PRIORITY_COLORS[3];

    await createTimeBlock({
      title: todo.title,
      date: dateStr,
      startTime,
      endTime,
      todoId: todo.id,
      projectId: todo.projectId,
      color,
      autoTrack: true,
      slotType: 'fixed',
    });

    occupiedHours.add(slot);
    if (slot === slotCursor) slotCursor++;
    created++;
  }

  return { created, wasOverloaded: overloaded };
}

