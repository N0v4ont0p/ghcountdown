import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Flame, CheckCircle, Timer, ChartBar } from '@phosphor-icons/react';
import { format, startOfWeek, endOfWeek } from 'date-fns';
import { getAllTodos } from '@/db/repositories/todosRepo';
import { getTimeBlocksByDate } from '@/db/repositories/timeBlocksRepo';
import { getAllTimeEntries } from '@/db/repositories/timeRepo';

interface MomentumData {
  streak: number;
  completedToday: number;
  focusMinutesToday: number;
  weeklyRate: number;
}

const MAX_STREAK_LOOKBACK_DAYS = 365;

export function MomentumStrip({ compact }: { compact?: boolean } = {}) {
  const [data, setData] = useState<MomentumData | null>(null);

  useEffect(() => {
    async function load() {
      const today = format(new Date(), 'yyyy-MM-dd');
      const [allTodos, todayBlocks, entries] = await Promise.all([
        getAllTodos(),
        getTimeBlocksByDate(today),
        getAllTimeEntries(),
      ]);

      // Tasks completed today (status=done, updatedAt starts with today)
      const completedToday = allTodos.filter(
        t => t.status === 'done' && t.updatedAt.startsWith(today)
      ).length;

      // Focus time today: autoTrack blocks
      const focusMinutesToday = todayBlocks
        .filter(b => b.autoTrack)
        .reduce((sum, b) => {
          const [sh, sm] = b.startTime.split(':').map(Number);
          const [eh, em] = b.endTime.split(':').map(Number);
          return sum + Math.max(0, (eh * 60 + em) - (sh * 60 + sm));
        }, 0);

      // Current streak: consecutive days with completed time entries
      const completedEntries = entries.filter(e => e.endAt !== null);
      const daysWithActivity = new Set(completedEntries.map(e => e.startAt.split('T')[0]));
      let streak = 0;
      const streakStart = daysWithActivity.has(today)
        ? new Date()
        : new Date(Date.now() - 86_400_000);
      const checkDate = new Date(streakStart);
      for (let i = 0; i < MAX_STREAK_LOOKBACK_DAYS; i++) {
        const dateStr = checkDate.toISOString().split('T')[0];
        if (daysWithActivity.has(dateStr)) {
          streak++;
          checkDate.setDate(checkDate.getDate() - 1);
        } else {
          break;
        }
      }

      // Weekly completion rate: done this week / (done + active) this week
      const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 }).toISOString().split('T')[0];
      const weekEnd = endOfWeek(new Date(), { weekStartsOn: 1 }).toISOString().split('T')[0];
      const weekTodos = allTodos.filter(t => {
        const ref = t.updatedAt.split('T')[0];
        return ref >= weekStart && ref <= weekEnd;
      });
      const weekDone = weekTodos.filter(t => t.status === 'done').length;
      const weeklyRate = weekTodos.length > 0 ? Math.round((weekDone / weekTodos.length) * 100) : 0;

      setData({ streak, completedToday, focusMinutesToday, weeklyRate });
    }
    load();
  }, []);

  if (!data) return null;

  if (compact) {
    const focusFormatted = data.focusMinutesToday >= 60
      ? `${Math.floor(data.focusMinutesToday / 60)}h ${data.focusMinutesToday % 60}m`
      : `${data.focusMinutesToday}m`;
    return (
      <div className="flex items-center gap-4 text-sm flex-wrap">
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <Flame size={14} className="text-orange-500" />
          <span className="tabular-nums font-semibold text-foreground">{data.streak}d</span>
          <span>streak</span>
        </span>
        <span className="text-muted-foreground">·</span>
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <Timer size={14} className="text-blue-500" />
          <span className="tabular-nums font-semibold text-foreground">{focusFormatted}</span>
          <span>focus today</span>
        </span>
      </div>
    );
  }

  const stats = [
    {
      icon: <Flame size={18} className="text-orange-500" />,
      label: 'Streak',
      value: `${data.streak}d`,
    },
    {
      icon: <CheckCircle size={18} className="text-green-500" />,
      label: 'Done today',
      value: String(data.completedToday),
    },
    {
      icon: <Timer size={18} className="text-blue-500" />,
      label: 'Focus time',
      value: data.focusMinutesToday >= 60
        ? `${Math.floor(data.focusMinutesToday / 60)}h ${data.focusMinutesToday % 60}m`
        : `${data.focusMinutesToday}m`,
    },
    {
      icon: <ChartBar size={18} className="text-purple-500" />,
      label: 'This week',
      value: `${data.weeklyRate}%`,
    },
  ];

  return (
    <Card className="p-6">
      <h3 className="text-lg font-semibold mb-4">Momentum</h3>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {stats.map(({ icon, label, value }) => (
          <div key={label} className="flex flex-col gap-1">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              {icon}
              <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
            </div>
            <span className="text-2xl font-bold tabular-nums">{value}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}
