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

/**
 * Schedules unscheduled todos as time blocks for the given date.
 * High-priority todos (p5, p4) are placed first and earlier in the day.
 * Returns the number of time blocks created.
 */
export async function scheduleMyDay(
  dateStr: string,
  unscheduledTodos: Todo[],
  existingBlocks: TimeBlock[]
): Promise<number> {
  if (unscheduledTodos.length === 0) return 0;

  // Sort by priority descending so p5/p4 go first
  const sorted = [...unscheduledTodos].sort((a, b) => b.priority - a.priority);

  // Build the set of hours already occupied by existing blocks.
  // Hour H is occupied if any existing block overlaps the [H:00, H+1:00) window.
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

  // Partition todos into high-priority (p4-5) and lower-priority (p1-3)
  const highPriority = sorted.filter(t => t.priority >= 4);
  const lowPriority = sorted.filter(t => t.priority < 4);

  let created = 0;

  // High-priority todos: assign into earliest available slots that match hours[]
  for (const todo of highPriority) {
    const slot = hours.find(h => !occupiedHours.has(h));
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
    created++;
  }

  // Low-priority todos: fill remaining time chronologically
  const now = new Date();
  const todayStr = format(now, 'yyyy-MM-dd');
  let currentHour = 9;
  if (dateStr === todayStr) {
    currentHour = Math.max(9, now.getHours());
  }

  for (const todo of lowPriority) {
    while (occupiedHours.has(currentHour) && currentHour < 24) {
      currentHour++;
    }
    if (currentHour >= 24) break;

    const startTime = `${String(currentHour).padStart(2, '0')}:00`;
    const endTime = `${String(currentHour + 1).padStart(2, '0')}:00`;
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

    occupiedHours.add(currentHour);
    currentHour++;
    created++;
  }

  return created;
}
