import { startOfWeek, endOfWeek, format, subWeeks, subDays, differenceInMinutes, parseISO } from 'date-fns';
import { TimeEntry, Todo } from '@/db/schema';

export interface WeeklySnapshot {
  weekStart: string;
  weekEnd: string;
  totalFocusMinutes: number;
  tasksCompleted: number;
  avgDailyFocusMinutes: number;
}

export interface TrendResult {
  direction: 'up' | 'down' | 'flat';
  percentChange: number;
}

export interface TrajectoryResult {
  snapshots: WeeklySnapshot[];
  focusTrend: TrendResult;
  tasksTrend: TrendResult;
  personalBestWeek: WeeklySnapshot | null;
  hasEnoughData: boolean;
}

export function computeWeeklySnapshots(
  entries: TimeEntry[],
  todos: Todo[],
  now: Date = new Date(),
): WeeklySnapshot[] {
  const snapshots: WeeklySnapshot[] = [];

  for (let i = 0; i < 8; i++) {
    const weekDate = subWeeks(now, i);
    const weekStart = startOfWeek(weekDate);
    const weekEnd = endOfWeek(weekDate);

    const weekEntries = entries.filter(e => {
      if (!e.endAt) return false;
      const start = parseISO(e.startAt);
      return start >= weekStart && start <= weekEnd;
    });

    const totalFocusMinutes = weekEntries.reduce((sum, e) => {
      if (e.endAt) {
        return sum + Math.max(0, differenceInMinutes(parseISO(e.endAt), parseISO(e.startAt)));
      }
      return sum;
    }, 0);

    const tasksCompleted = todos.filter(t => {
      if (t.status !== 'done') return false;
      const updated = parseISO(t.updatedAt);
      return updated >= weekStart && updated <= weekEnd;
    }).length;

    snapshots.push({
      weekStart: format(weekStart, 'yyyy-MM-dd'),
      weekEnd: format(weekEnd, 'yyyy-MM-dd'),
      totalFocusMinutes: Math.round(totalFocusMinutes),
      tasksCompleted,
      avgDailyFocusMinutes: Math.round(totalFocusMinutes / 7),
    });
  }

  // snapshots[0] = current week, snapshots[7] = 7 weeks ago
  return snapshots;
}

export function computeTrajectory(snapshots: WeeklySnapshot[]): TrajectoryResult {
  const weeksWithActivity = snapshots.filter(
    s => s.totalFocusMinutes > 0 || s.tasksCompleted > 0,
  );
  const hasEnoughData = weeksWithActivity.length >= 4;

  const personalBestWeek = snapshots.reduce<WeeklySnapshot | null>((best, w) => {
    if (!best) return w.totalFocusMinutes > 0 ? w : null;
    return w.totalFocusMinutes > best.totalFocusMinutes ? w : best;
  }, null);

  if (snapshots.length < 7) {
    return {
      snapshots,
      focusTrend: { direction: 'flat', percentChange: 0 },
      tasksTrend: { direction: 'flat', percentChange: 0 },
      personalBestWeek,
      hasEnoughData: false,
    };
  }

  // Skip current (possibly incomplete) week at index 0
  // Recent 3 weeks: indices 1, 2, 3
  // Prior 3 weeks: indices 4, 5, 6
  const recent = snapshots.slice(1, 4);
  const prior = snapshots.slice(4, 7);

  const avgFocusRecent = recent.reduce((s, w) => s + w.totalFocusMinutes, 0) / 3;
  const avgFocusPrior = prior.reduce((s, w) => s + w.totalFocusMinutes, 0) / 3;
  const avgTasksRecent = recent.reduce((s, w) => s + w.tasksCompleted, 0) / 3;
  const avgTasksPrior = prior.reduce((s, w) => s + w.tasksCompleted, 0) / 3;

  function computeTrend(recentAvg: number, priorAvg: number): TrendResult {
    if (priorAvg === 0) {
      if (recentAvg === 0) return { direction: 'flat', percentChange: 0 };
      return { direction: 'up', percentChange: 100 };
    }
    const change = ((recentAvg - priorAvg) / priorAvg) * 100;
    const rounded = Math.round(Math.abs(change));
    if (Math.abs(change) < 5) return { direction: 'flat', percentChange: rounded };
    return { direction: change > 0 ? 'up' : 'down', percentChange: rounded };
  }

  return {
    snapshots,
    focusTrend: computeTrend(avgFocusRecent, avgFocusPrior),
    tasksTrend: computeTrend(avgTasksRecent, avgTasksPrior),
    personalBestWeek,
    hasEnoughData,
  };
}

/** Returns a localStorage key for the weekly review window that covers
 *  Sunday ≥18:00 and the following Monday <11:00. */
export function weeklyReviewKey(now: Date = new Date()): string {
  const day = now.getDay(); // 0 = Sunday, 1 = Monday
  // Both Sunday evening and Monday morning refer to the same review window.
  // Use the Sunday date as the canonical key for both.
  if (day === 1) {
    // Monday → the Sunday was yesterday
    return `weeklyReview_${format(subDays(now, 1), 'yyyy-MM-dd')}`;
  }
  // Sunday → today
  return `weeklyReview_${format(now, 'yyyy-MM-dd')}`;
}
