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
 * Returns the number of time blocks created.
 */
export async function scheduleMyDay(
  dateStr: string,
  unscheduledTodos: Todo[],
  existingBlocks: TimeBlock[]
): Promise<number> {
  if (unscheduledTodos.length === 0) return 0;

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
  const fallbackPeak = [9, 10, 14, 15];
  const peakSet = new Set(peakHours.length ? peakHours : fallbackPeak);

  // Working-day range 7–22
  const DAY_START = 7;
  const DAY_END = 22;

  // For today don't schedule into the past
  const now = new Date();
  const todayStr = format(now, 'yyyy-MM-dd');
  const minHour = dateStr === todayStr ? Math.max(DAY_START, now.getHours()) : DAY_START;

  // Candidate arrays (ascending order so we fill morning first)
  const peakCandidates = Array.from(peakSet)
    .filter(h => h >= minHour && h < DAY_END)
    .sort((a, b) => a - b);

  const offPeakCandidates = Array.from({ length: DAY_END - DAY_START }, (_, i) => DAY_START + i)
    .filter(h => h >= minHour && !peakSet.has(h));

  // All hours sorted: peak first, then off-peak (for medium / fallback)
  const allCandidates = [
    ...peakCandidates,
    ...offPeakCandidates,
  ];

  // Pick the earliest available slot from the given list
  function pickSlot(candidates: number[]): number | undefined {
    return candidates.find(h => !occupiedHours.has(h));
  }

  // Partition todos by cognitive load and sort each group for minimal context switching
  const highLoad = sortGroup(unscheduledTodos.filter(t => t.cognitiveLoad === 'high'));
  const medLoad  = sortGroup(unscheduledTodos.filter(t => t.cognitiveLoad === 'medium' || t.cognitiveLoad == null));
  const lowLoad  = sortGroup(unscheduledTodos.filter(t => t.cognitiveLoad === 'low'));

  let created = 0;

  async function assignTodo(todo: Todo, hour: number): Promise<void> {
    const startTime = `${String(hour).padStart(2, '0')}:00`;
    const endTime   = `${String(hour + 1).padStart(2, '0')}:00`;
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

    occupiedHours.add(hour);
    created++;
  }

  // 1. High cognitive load → peak hours (deep work deserves peak focus time)
  for (const todo of highLoad) {
    const slot = pickSlot(peakCandidates) ?? pickSlot(allCandidates);
    if (slot !== undefined) await assignTodo(todo, slot);
  }

  // 2. Low cognitive load → off-peak hours (admin/easy tasks fill the gaps)
  for (const todo of lowLoad) {
    const slot = pickSlot(offPeakCandidates) ?? pickSlot(allCandidates);
    if (slot !== undefined) await assignTodo(todo, slot);
  }

  // 3. Medium / unset cognitive load → any remaining hour (peak preferred)
  for (const todo of medLoad) {
    const slot = pickSlot(allCandidates);
    if (slot !== undefined) await assignTodo(todo, slot);
  }

  return created;
}
