import { getAllTodos } from '@/db/repositories/todosRepo';
import { getAllTimeEntries } from '@/db/repositories/timeRepo';
import { format, startOfWeek, addDays } from 'date-fns';

export interface WeeklySnapshot {
  weekStart: string;
  todosCompleted: number;
  minutesTracked: number;
}

/**
 * Returns one snapshot per week (Monday-based) for the past `weeks` weeks,
 * ordered oldest-first.
 */
export async function getWeeklySnapshots(weeks = 8): Promise<WeeklySnapshot[]> {
  const [todos, entries] = await Promise.all([getAllTodos(), getAllTimeEntries()]);

  const snapshots: WeeklySnapshot[] = [];
  const now = new Date();

  for (let i = weeks - 1; i >= 0; i--) {
    const weekStart = startOfWeek(addDays(now, -i * 7), { weekStartsOn: 1 });
    const weekEnd = addDays(weekStart, 7);
    const weekStartStr = format(weekStart, 'yyyy-MM-dd');

    const todosCompleted = todos.filter((t) => {
      if (t.status !== 'done') return false;
      const updated = new Date(t.updatedAt);
      return updated >= weekStart && updated < weekEnd;
    }).length;

    const minutesTracked = entries
      .filter((e) => {
        if (!e.endAt) return false;
        const start = new Date(e.startAt);
        return start >= weekStart && start < weekEnd;
      })
      .reduce((sum, e) => {
        const mins = (new Date(e.endAt!).getTime() - new Date(e.startAt).getTime()) / 60000;
        return sum + mins;
      }, 0);

    snapshots.push({
      weekStart: weekStartStr,
      todosCompleted,
      minutesTracked: Math.round(minutesTracked),
    });
  }

  return snapshots;
}

export type TrendDirection = 'up' | 'down' | 'flat';

export interface TrendResult {
  direction: TrendDirection;
  percentChange: number;
}

/**
 * Computes a simple linear trend for an array of numeric values.
 * Returns direction and approximate percent change from first to last half.
 */
export function computeTrend(values: number[]): TrendResult {
  if (values.length < 2) return { direction: 'flat', percentChange: 0 };

  const mid = Math.floor(values.length / 2);
  const firstHalf = values.slice(0, mid);
  const secondHalf = values.slice(mid);

  const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
  const first = avg(firstHalf);
  const second = avg(secondHalf);

  if (first === 0 && second === 0) return { direction: 'flat', percentChange: 0 };

  const percentChange = first === 0 ? 100 : Math.round(((second - first) / Math.abs(first)) * 100);

  const direction: TrendDirection =
    percentChange > 5 ? 'up' : percentChange < -5 ? 'down' : 'flat';

  return { direction, percentChange };
}
