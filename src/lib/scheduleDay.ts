import { format } from 'date-fns';
import { Todo, TimeBlock } from '@/db/schema';
import { createTimeBlock } from '@/db/repositories/timeBlocksRepo';

const PRIORITY_COLORS: Record<number, string> = {
  5: 'oklch(0.58 0.20 20)',
  4: 'oklch(0.65 0.18 40)',
  3: 'oklch(0.58 0.20 260)',
  2: 'oklch(0.60 0.16 240)',
  1: 'oklch(0.65 0.12 200)',
};

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

  // Sort by priority descending so p5/p4 go first and earlier
  const sorted = [...unscheduledTodos].sort((a, b) => b.priority - a.priority);

  // Build the set of hours already occupied by existing blocks
  const occupiedHours = new Set<number>();
  for (const block of existingBlocks) {
    const [startH] = block.startTime.split(':').map(Number);
    const [endH, endM] = block.endTime.split(':').map(Number);
    const actualEndH = endM > 0 ? endH + 1 : endH;
    for (let h = startH; h < actualEndH; h++) {
      occupiedHours.add(h);
    }
  }

  // Start from 9am, or the next full hour after now when scheduling today
  const now = new Date();
  const todayStr = format(now, 'yyyy-MM-dd');
  let currentHour = 9;
  if (dateStr === todayStr && now.getHours() >= 9) {
    currentHour = now.getHours() + (now.getMinutes() > 0 ? 1 : 0);
  }

  let created = 0;
  for (const todo of sorted) {
    // Advance to the next free hour slot
    while (occupiedHours.has(currentHour) && currentHour < 23) {
      currentHour++;
    }
    if (currentHour >= 23) break;

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
    });

    occupiedHours.add(currentHour);
    currentHour++;
    created++;
  }

  return created;
}
