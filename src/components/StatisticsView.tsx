import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { 
  Clock, 
  ChartBar, 
  TrendUp, 
  Lightning, 
  Target,
  CalendarBlank,
  CheckCircle,
  Timer,
  Flame,
  Trophy,
  ArrowUp,
  ArrowDown,
  Minus,
  Circle,
  Play,
  Stop,
  Trash
} from '@phosphor-icons/react';
import { getAllTimeEntries, createTimeEntry, updateTimeEntry, deleteTimeEntry, getRunningTimer } from '@/db/repositories/timeRepo';
import { getAllTodos } from '@/db/repositories/todosRepo';
import { getAllEvents } from '@/db/repositories/eventsRepo';
import { TimeEntry, Todo, Event } from '@/db/schema';
import { format, startOfWeek, endOfWeek, startOfMonth, endOfMonth, eachDayOfInterval, differenceInMinutes, differenceInSeconds, isToday, parseISO, startOfDay, endOfDay } from 'date-fns';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { computeWeeklySnapshots, computeTrajectory, TrajectoryResult } from '@/lib/weeklyTrajectory';

interface StatsSummary {
  totalFocusedTime: number;
  completedTodos: number;
  completedEvents: number;
  averageSessionLength: number;
  mostProductiveHour: number;
  currentStreak: number;
  longestStreak: number;
  todayFocusTime: number;
  weekFocusTime: number;
  monthFocusTime: number;
}

interface DayStats {
  date: string;
  focusTime: number;
  completedTodos: number;
  sessions: number;
}

interface HourlyStats {
  hour: number;
  focusTime: number;
  sessions: number;
}

interface ProductivityInsight {
  type: 'success' | 'warning' | 'info';
  title: string;
  description: string;
  icon: any;
}

export function StatisticsView() {
  const [timeEntries, setTimeEntries] = useState<TimeEntry[]>([]);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [_events, setEvents] = useState<Event[]>([]);
  const [stats, setStats] = useState<StatsSummary | null>(null);
  const [weeklyData, setWeeklyData] = useState<DayStats[]>([]);
  const [hourlyData, setHourlyData] = useState<HourlyStats[]>([]);
  const [insights, setInsights] = useState<ProductivityInsight[]>([]);
  const [trajectory, setTrajectory] = useState<TrajectoryResult | null>(null);
  const [selectedPeriod, setSelectedPeriod] = useState<'week' | 'month'>('week');
  const [selectedTab, setSelectedTab] = useState<'overview' | 'tracker' | 'planned-vs-actual'>('overview');
  const [isLoading, setIsLoading] = useState(true);

  // Tracker state
  const [runningTimer, setRunningTimer] = useState<TimeEntry | null>(null);
  const [timerElapsed, setTimerElapsed] = useState(0);
  const [isTimerDialogOpen, setIsTimerDialogOpen] = useState(false);
  const [timerDeleteConfirmOpen, setTimerDeleteConfirmOpen] = useState(false);
  const [timerEntryToDelete, setTimerEntryToDelete] = useState<string | null>(null);
  const [timerFormData, setTimerFormData] = useState({ todoId: 'none', note: '' });

  useEffect(() => {
    loadStatistics();
  }, [selectedPeriod]);

  // Tracker: periodic reload + elapsed timer
  useEffect(() => {
    loadTrackerData();
    const interval = setInterval(loadTrackerData, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!runningTimer) { setTimerElapsed(0); return; }
    const interval = setInterval(() => {
      setTimerElapsed(Math.floor((Date.now() - new Date(runningTimer.startAt).getTime()) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [runningTimer]);

  async function loadTrackerData() {
    const [running] = await Promise.all([getRunningTimer()]);
    setRunningTimer(running);
    if (running) {
      setTimerElapsed(Math.floor((Date.now() - new Date(running.startAt).getTime()) / 1000));
    }
  }

  async function loadStatistics() {
    setIsLoading(true);
    try {
      const entries = await getAllTimeEntries();
      const allTodos = await getAllTodos();
      const allEvents = await getAllEvents();
      
      setTimeEntries(entries);
      setTodos(allTodos);
      setEvents(allEvents);
      
      const summary = calculateStats(entries, allTodos, allEvents);
      setStats(summary);
      
      const weekly = calculateWeeklyData(entries, allTodos);
      setWeeklyData(weekly);
      
      const hourly = calculateHourlyData(entries);
      setHourlyData(hourly);
      
      const generatedInsights = generateInsights(summary, entries, allTodos);
      setInsights(generatedInsights);

      const snapshots = computeWeeklySnapshots(entries, allTodos);
      setTrajectory(computeTrajectory(snapshots));
    } catch (error) {
      console.error('Failed to load statistics:', error);
    } finally {
      setIsLoading(false);
    }
  }

  // Tracker action functions
  async function handleTimerStart() {
    if (runningTimer) return;
    try {
      await createTimeEntry({
        todoId: timerFormData.todoId !== 'none' ? timerFormData.todoId : null,
        projectId: null,
        timeBlockId: null,
        startAt: new Date().toISOString(),
        endAt: null,
        note: timerFormData.note,
      });
      toast.success('Timer started');
      setIsTimerDialogOpen(false);
      setTimerFormData({ todoId: 'none', note: '' });
      await loadTrackerData();
      await loadStatistics();
    } catch {
      toast.error('Failed to start timer');
    }
  }

  async function handleTimerStop() {
    if (!runningTimer) return;
    try {
      await updateTimeEntry(runningTimer.id, { endAt: new Date().toISOString() });
      toast.success(`Timer stopped — ${formatDurationSeconds(timerElapsed)}`);
      await loadTrackerData();
      await loadStatistics();
    } catch {
      toast.error('Failed to stop timer');
    }
  }

  async function handleTimerDelete(id: string) {
    setTimerEntryToDelete(id);
    setTimerDeleteConfirmOpen(true);
  }

  async function handleTimerDeleteConfirm() {
    if (!timerEntryToDelete) return;
    try {
      await deleteTimeEntry(timerEntryToDelete);
      toast.success('Time entry deleted');
      await loadStatistics();
    } catch {
      toast.error('Failed to delete time entry');
    } finally {
      setTimerEntryToDelete(null);
    }
  }

  function formatDurationSeconds(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  function getEntryDuration(entry: TimeEntry): number {
    return differenceInSeconds(
      entry.endAt ? new Date(entry.endAt) : new Date(),
      new Date(entry.startAt),
    );
  }

  function calculateStats(entries: TimeEntry[], allTodos: Todo[], allEvents: Event[]): StatsSummary {
    const now = new Date();
    const todayStart = startOfDay(now);
    const todayEnd = endOfDay(now);
    const weekStart = startOfWeek(now);
    const weekEnd = endOfWeek(now);
    const monthStart = startOfMonth(now);
    const monthEnd = endOfMonth(now);

    const completedEntries = entries.filter(e => e.endAt !== null);
    
    const totalFocusedTime = completedEntries.reduce((sum, entry) => {
      if (entry.endAt) {
        return sum + differenceInMinutes(parseISO(entry.endAt), parseISO(entry.startAt));
      }
      return sum;
    }, 0);

    const todayFocusTime = completedEntries
      .filter(e => {
        const start = parseISO(e.startAt);
        return start >= todayStart && start <= todayEnd;
      })
      .reduce((sum, entry) => {
        if (entry.endAt) {
          return sum + differenceInMinutes(parseISO(entry.endAt), parseISO(entry.startAt));
        }
        return sum;
      }, 0);

    const weekFocusTime = completedEntries
      .filter(e => {
        const start = parseISO(e.startAt);
        return start >= weekStart && start <= weekEnd;
      })
      .reduce((sum, entry) => {
        if (entry.endAt) {
          return sum + differenceInMinutes(parseISO(entry.endAt), parseISO(entry.startAt));
        }
        return sum;
      }, 0);

    const monthFocusTime = completedEntries
      .filter(e => {
        const start = parseISO(e.startAt);
        return start >= monthStart && start <= monthEnd;
      })
      .reduce((sum, entry) => {
        if (entry.endAt) {
          return sum + differenceInMinutes(parseISO(entry.endAt), parseISO(entry.startAt));
        }
        return sum;
      }, 0);

    const completedTodos = allTodos.filter(t => t.status === 'done').length;
    const completedEvents = allEvents.filter(e => parseISO(e.startsAt) < now).length;

    const averageSessionLength = completedEntries.length > 0
      ? totalFocusedTime / completedEntries.length
      : 0;

    const hourCounts: Record<number, number> = {};
    completedEntries.forEach(entry => {
      const hour = parseISO(entry.startAt).getHours();
      hourCounts[hour] = (hourCounts[hour] || 0) + differenceInMinutes(parseISO(entry.endAt!), parseISO(entry.startAt));
    });
    
    const mostProductiveHour = Object.entries(hourCounts).reduce((max, [hour, time]) => {
      return time > (hourCounts[max] || 0) ? parseInt(hour) : max;
    }, 0);

    const streaks = calculateStreaks(entries);

    return {
      totalFocusedTime,
      completedTodos,
      completedEvents,
      averageSessionLength,
      mostProductiveHour,
      currentStreak: streaks.current,
      longestStreak: streaks.longest,
      todayFocusTime,
      weekFocusTime,
      monthFocusTime,
    };
  }

  function calculateStreaks(entries: TimeEntry[]): { current: number; longest: number } {
    const completedEntries = entries.filter(e => e.endAt !== null);
    const daysWithActivity = new Set(
      completedEntries.map(e => format(parseISO(e.startAt), 'yyyy-MM-dd'))
    );

    let currentStreak = 0;
    let longestStreak = 0;
    let tempStreak = 0;
    
    const today = new Date();
    for (let i = 0; i < 365; i++) {
      const checkDate = new Date(today);
      checkDate.setDate(today.getDate() - i);
      const dateStr = format(checkDate, 'yyyy-MM-dd');
      
      if (daysWithActivity.has(dateStr)) {
        tempStreak++;
        longestStreak = Math.max(longestStreak, tempStreak);
        if (i === 0 || currentStreak > 0) {
          currentStreak = tempStreak;
        }
      } else {
        if (currentStreak > 0) break;
        tempStreak = 0;
      }
    }

    return { current: currentStreak, longest: longestStreak };
  }

  function calculateWeeklyData(entries: TimeEntry[], allTodos: Todo[]): DayStats[] {
    const now = new Date();
    const start = selectedPeriod === 'week' ? startOfWeek(now) : startOfMonth(now);
    const end = selectedPeriod === 'week' ? endOfWeek(now) : endOfMonth(now);
    
    const days = eachDayOfInterval({ start, end });
    
    return days.map(day => {
      const dayStr = format(day, 'yyyy-MM-dd');
      const dayStart = startOfDay(day);
      const dayEnd = endOfDay(day);
      
      const dayEntries = entries.filter(e => {
        const entryDate = parseISO(e.startAt);
        return entryDate >= dayStart && entryDate <= dayEnd && e.endAt !== null;
      });
      
      const focusTime = dayEntries.reduce((sum, entry) => {
        if (entry.endAt) {
          return sum + differenceInMinutes(parseISO(entry.endAt), parseISO(entry.startAt));
        }
        return sum;
      }, 0);
      
      const completedTodos = allTodos.filter(t => {
        if (t.status !== 'done') return false;
        const completedDate = parseISO(t.updatedAt);
        return completedDate >= dayStart && completedDate <= dayEnd;
      }).length;
      
      return {
        date: dayStr,
        focusTime,
        completedTodos,
        sessions: dayEntries.length,
      };
    });
  }

  function calculateHourlyData(entries: TimeEntry[]): HourlyStats[] {
    const hourlyMap: Record<number, { time: number; sessions: number }> = {};
    
    for (let i = 0; i < 24; i++) {
      hourlyMap[i] = { time: 0, sessions: 0 };
    }
    
    entries
      .filter(e => e.endAt !== null)
      .forEach(entry => {
        const hour = parseISO(entry.startAt).getHours();
        if (entry.endAt) {
          hourlyMap[hour].time += differenceInMinutes(parseISO(entry.endAt), parseISO(entry.startAt));
          hourlyMap[hour].sessions += 1;
        }
      });
    
    return Object.entries(hourlyMap).map(([hour, data]) => ({
      hour: parseInt(hour),
      focusTime: data.time,
      sessions: data.sessions,
    }));
  }

  function generateInsights(summary: StatsSummary, entries: TimeEntry[], allTodos: Todo[]): ProductivityInsight[] {
    const insights: ProductivityInsight[] = [];

    if (summary.currentStreak >= 7) {
      insights.push({
        type: 'success',
        title: 'Amazing Consistency!',
        description: `You're on a ${summary.currentStreak}-day streak. Keep it going!`,
        icon: Flame,
      });
    }

    if (summary.todayFocusTime > 180) {
      insights.push({
        type: 'success',
        title: 'Deep Work Champion',
        description: `${Math.floor(summary.todayFocusTime / 60)}h ${summary.todayFocusTime % 60}m of focused work today!`,
        icon: Trophy,
      });
    } else if (summary.todayFocusTime < 30 && new Date().getHours() > 14) {
      insights.push({
        type: 'warning',
        title: 'Low Activity Today',
        description: 'Consider starting a focus session to boost productivity.',
        icon: Lightning,
      });
    }

    const todayTodos = allTodos.filter(t => t.status === 'today');
    const completedToday = todayTodos.filter(t => t.status === 'done').length;
    const completionRate = todayTodos.length > 0 ? (completedToday / todayTodos.length) * 100 : 0;
    
    if (completionRate >= 80 && todayTodos.length >= 3) {
      insights.push({
        type: 'success',
        title: 'Task Master',
        description: `${Math.round(completionRate)}% task completion rate today!`,
        icon: CheckCircle,
      });
    }

    if (summary.mostProductiveHour >= 0) {
      const hourFormatted = summary.mostProductiveHour === 0 
        ? '12 AM' 
        : summary.mostProductiveHour < 12 
          ? `${summary.mostProductiveHour} AM` 
          : summary.mostProductiveHour === 12 
            ? '12 PM' 
            : `${summary.mostProductiveHour - 12} PM`;
      
      insights.push({
        type: 'info',
        title: 'Peak Performance Time',
        description: `You're most productive around ${hourFormatted}`,
        icon: TrendUp,
      });
    }

    return insights;
  }

  function formatDuration(minutes: number): string {
    const hours = Math.floor(minutes / 60);
    const mins = Math.floor(minutes % 60);
    if (hours === 0) return `${mins}m`;
    return `${hours}h ${mins}m`;
  }

  if (!isLoading && stats && stats.totalFocusedTime === 0 && weeklyData.every(d => d.focusTime === 0)) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <ChartBar weight="thin" size={48} className="text-muted-foreground" />
        <h3 className="text-lg font-semibold">No data yet</h3>
        <p className="text-sm text-muted-foreground">Start tracking time to see insights</p>
      </div>
    );
  }

  if (isLoading || !stats) {
    return (
      <div className="flex items-center justify-center h-full">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="text-center"
        >
          <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading insights...</p>
        </motion.div>
      </div>
    );
  }

  const maxWeeklyTime = Math.max(...weeklyData.map(d => d.focusTime), 1);
  const maxHourlyTime = Math.max(...hourlyData.map(h => h.focusTime), 1);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="max-w-7xl mx-auto space-y-6"
    >
      <div>
        <h2 className="text-3xl font-semibold mb-2">Stats</h2>
        <p className="text-muted-foreground">Track your productivity patterns and time insights</p>
      </div>

      {insights.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2">
          <AnimatePresence mode="popLayout">
            {insights.map((insight, index) => {
              const Icon = insight.icon;
              return (
                <motion.div
                  key={insight.title}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  transition={{ delay: index * 0.1 }}
                >
                  <Card 
                    className={cn(
                      "p-4 border-l-4 transition-all hover:shadow-md",
                      insight.type === 'success' && "border-l-green-500 bg-green-500/5",
                      insight.type === 'warning' && "border-l-yellow-500 bg-yellow-500/5",
                      insight.type === 'info' && "border-l-blue-500 bg-blue-500/5"
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <div className={cn(
                        "p-2 rounded-lg",
                        insight.type === 'success' && "bg-green-500/10 text-green-600 dark:text-green-400",
                        insight.type === 'warning' && "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400",
                        insight.type === 'info' && "bg-blue-500/10 text-blue-600 dark:text-blue-400"
                      )}>
                        <Icon size={20} weight="duotone" />
                      </div>
                      <div className="flex-1">
                        <h3 className="font-semibold mb-1">{insight.title}</h3>
                        <p className="text-sm text-muted-foreground">{insight.description}</p>
                      </div>
                    </div>
                  </Card>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          <Card className="p-6 hover:shadow-lg transition-all">
            <div className="flex items-center gap-3 mb-3">
              <div className="p-2 bg-primary/10 rounded-lg">
                <Clock size={24} className="text-primary" weight="duotone" />
              </div>
              <h3 className="text-sm font-medium text-muted-foreground">Total Focus Time</h3>
            </div>
            <p className="text-3xl font-bold">{formatDuration(stats.totalFocusedTime)}</p>
            <p className="text-xs text-muted-foreground mt-2">All time tracked</p>
          </Card>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
        >
          <Card className="p-6 hover:shadow-lg transition-all">
            <div className="flex items-center gap-3 mb-3">
              <div className="p-2 bg-green-500/10 rounded-lg">
                <CheckCircle size={24} className="text-green-600 dark:text-green-400" weight="duotone" />
              </div>
              <h3 className="text-sm font-medium text-muted-foreground">Completed Tasks</h3>
            </div>
            <p className="text-3xl font-bold">{stats.completedTodos}</p>
            <p className="text-xs text-muted-foreground mt-2">Tasks finished</p>
          </Card>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          <Card className="p-6 hover:shadow-lg transition-all">
            <div className="flex items-center gap-3 mb-3">
              <div className="p-2 bg-orange-500/10 rounded-lg">
                <Flame size={24} className="text-orange-600 dark:text-orange-400" weight="duotone" />
              </div>
              <h3 className="text-sm font-medium text-muted-foreground">Current Streak</h3>
            </div>
            <p className="text-3xl font-bold">{stats.currentStreak}</p>
            <p className="text-xs text-muted-foreground mt-2">Days active</p>
          </Card>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25 }}
        >
          <Card className="p-6 hover:shadow-lg transition-all">
            <div className="flex items-center gap-3 mb-3">
              <div className="p-2 bg-purple-500/10 rounded-lg">
                <Timer size={24} className="text-purple-600 dark:text-purple-400" weight="duotone" />
              </div>
              <h3 className="text-sm font-medium text-muted-foreground">Avg Session</h3>
            </div>
            <p className="text-3xl font-bold">{formatDuration(stats.averageSessionLength)}</p>
            <p className="text-xs text-muted-foreground mt-2">Per focus session</p>
          </Card>
        </motion.div>
      </div>

      <Tabs value={selectedTab} onValueChange={(v) => setSelectedTab(v as 'overview' | 'tracker' | 'planned-vs-actual')} className="w-full">
        <TabsList className="grid w-full max-w-lg grid-cols-3">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="tracker">Tracker</TabsTrigger>
          <TabsTrigger value="planned-vs-actual">Planned vs Actual</TabsTrigger>
        </TabsList>

        {/* ── Overview ── */}
        <TabsContent value="overview" className="space-y-6 mt-6">
          {/* Trajectory section */}
          {trajectory && (
            trajectory.hasEnoughData ? (
              <Card className="p-6">
                <div className="mb-4">
                  <h3 className="text-lg font-semibold flex items-center gap-2">
                    <TrendUp size={20} className="text-primary" weight="duotone" />
                    Trajectory
                  </h3>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    How you're trending — recent 3 weeks vs prior 3 weeks
                  </p>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  {/* Focus trend */}
                  <div className="rounded-xl bg-muted/40 p-4 text-center">
                    {trajectory.focusTrend.direction === 'up' ? (
                      <ArrowUp size={28} className="text-green-500 mx-auto mb-1" weight="bold" />
                    ) : trajectory.focusTrend.direction === 'down' ? (
                      <ArrowDown size={28} className="text-red-500 mx-auto mb-1" weight="bold" />
                    ) : (
                      <Minus size={28} className="text-muted-foreground mx-auto mb-1" weight="bold" />
                    )}
                    <p className="text-sm font-medium">Focus Time</p>
                    <p className={cn(
                      "text-xs mt-1",
                      trajectory.focusTrend.direction === 'up' && "text-green-600 dark:text-green-400",
                      trajectory.focusTrend.direction === 'down' && "text-red-600 dark:text-red-400",
                      trajectory.focusTrend.direction === 'flat' && "text-muted-foreground",
                    )}>
                      {trajectory.focusTrend.direction === 'flat'
                        ? 'Holding steady'
                        : `${trajectory.focusTrend.direction === 'up' ? '+' : '-'}${trajectory.focusTrend.percentChange}% vs 3 wks ago`}
                    </p>
                  </div>
                  {/* Tasks trend */}
                  <div className="rounded-xl bg-muted/40 p-4 text-center">
                    {trajectory.tasksTrend.direction === 'up' ? (
                      <ArrowUp size={28} className="text-green-500 mx-auto mb-1" weight="bold" />
                    ) : trajectory.tasksTrend.direction === 'down' ? (
                      <ArrowDown size={28} className="text-red-500 mx-auto mb-1" weight="bold" />
                    ) : (
                      <Minus size={28} className="text-muted-foreground mx-auto mb-1" weight="bold" />
                    )}
                    <p className="text-sm font-medium">Tasks</p>
                    <p className={cn(
                      "text-xs mt-1",
                      trajectory.tasksTrend.direction === 'up' && "text-green-600 dark:text-green-400",
                      trajectory.tasksTrend.direction === 'down' && "text-red-600 dark:text-red-400",
                      trajectory.tasksTrend.direction === 'flat' && "text-muted-foreground",
                    )}>
                      {trajectory.tasksTrend.direction === 'flat'
                        ? 'Holding steady'
                        : `${trajectory.tasksTrend.direction === 'up' ? '+' : '-'}${trajectory.tasksTrend.percentChange}% vs 3 wks ago`}
                    </p>
                  </div>
                  {/* Personal best */}
                  <div className="rounded-xl bg-muted/40 p-4 text-center">
                    <Trophy size={28} className="text-yellow-500 mx-auto mb-1" weight="duotone" />
                    <p className="text-sm font-medium">Best Week</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {trajectory.personalBestWeek
                        ? formatDuration(trajectory.personalBestWeek.totalFocusMinutes)
                        : '—'}
                    </p>
                    {trajectory.personalBestWeek && (
                      <p className="text-xs text-muted-foreground">
                        wk of {format(parseISO(trajectory.personalBestWeek.weekStart), 'MMM d')}
                      </p>
                    )}
                  </div>
                </div>
              </Card>
            ) : (
              <Card className="p-5 flex items-center gap-3 text-muted-foreground">
                <TrendUp size={24} className="opacity-40 shrink-0" />
                <p className="text-sm">Track for 4 weeks to see your trajectory.</p>
              </Card>
            )
          )}

          <div className="flex gap-2">
            <Button size="sm" variant={selectedPeriod === 'week' ? 'default' : 'outline'} onClick={() => setSelectedPeriod('week')}>This Week</Button>
            <Button size="sm" variant={selectedPeriod === 'month' ? 'default' : 'outline'} onClick={() => setSelectedPeriod('month')}>This Month</Button>
          </div>

          <Card className="p-6">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="text-lg font-semibold">Focus Time Distribution</h3>
                <p className="text-sm text-muted-foreground">
                  {selectedPeriod === 'week' ? 'Daily breakdown for this week' : 'Daily breakdown for this month'}
                </p>
              </div>
              <div className="text-right">
                <p className="text-2xl font-bold">{formatDuration(selectedPeriod === 'week' ? stats.weekFocusTime : stats.monthFocusTime)}</p>
                <p className="text-xs text-muted-foreground">Total this {selectedPeriod}</p>
              </div>
            </div>

            <div className="space-y-2">
              {weeklyData.map((day, index) => {
                const percentage = (day.focusTime / maxWeeklyTime) * 100;
                const isCurrentDay = isToday(parseISO(day.date));
                
                return (
                  <motion.div
                    key={day.date}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: index * 0.05 }}
                    className="group"
                  >
                    <div className="flex items-center gap-4">
                      <div className="w-20 text-sm font-medium">
                        <span className={cn(isCurrentDay && "text-primary font-semibold")}>
                          {format(parseISO(day.date), 'EEE, MMM d')}
                        </span>
                      </div>
                      
                      <div className="flex-1 h-10 bg-muted rounded-lg overflow-hidden relative">
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${percentage}%` }}
                          transition={{ delay: index * 0.05 + 0.2, duration: 0.6, ease: 'easeOut' }}
                          className={cn(
                            "h-full rounded-lg transition-all",
                            isCurrentDay 
                              ? "bg-gradient-to-r from-primary to-primary/70" 
                              : "bg-gradient-to-r from-primary/70 to-primary/40"
                          )}
                        />
                        {day.focusTime > 0 && (
                          <div className="absolute inset-0 flex items-center px-3 text-sm font-medium">
                            <span className={cn(
                              "transition-colors",
                              percentage > 30 ? "text-primary-foreground" : "text-foreground"
                            )}>
                              {formatDuration(day.focusTime)}
                            </span>
                          </div>
                        )}
                      </div>
                      
                      <div className="w-24 text-right text-sm text-muted-foreground">
                        {day.sessions > 0 && (
                          <span>{day.sessions} session{day.sessions !== 1 ? 's' : ''}</span>
                        )}
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </Card>

          <Card className="p-6">
            <div className="mb-6">
              <h3 className="text-lg font-semibold">Hourly Activity Pattern</h3>
              <p className="text-sm text-muted-foreground">When you're most productive</p>
            </div>

            <div className="grid grid-cols-12 gap-2">
              {hourlyData.map((hour, index) => {
                const percentage = (hour.focusTime / maxHourlyTime) * 100;
                const isPeak = hour.hour === stats.mostProductiveHour && hour.focusTime > 0;
                
                return (
                  <motion.div
                    key={hour.hour}
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: index * 0.02 }}
                    className="flex flex-col items-center gap-2 group relative"
                  >
                    <div className="w-full h-32 bg-muted rounded-lg overflow-hidden flex flex-col justify-end relative">
                      <motion.div
                        initial={{ height: 0 }}
                        animate={{ height: `${percentage}%` }}
                        transition={{ delay: index * 0.02 + 0.3, duration: 0.5, ease: 'easeOut' }}
                        className={cn(
                          "w-full rounded-t-lg transition-all",
                          isPeak 
                            ? "bg-gradient-to-t from-primary to-primary/80" 
                            : "bg-gradient-to-t from-primary/60 to-primary/30"
                        )}
                      />
                      
                      {hour.focusTime > 0 && (
                        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                          <div className="bg-background/95 backdrop-blur-sm px-2 py-1 rounded text-xs font-medium shadow-lg">
                            {formatDuration(hour.focusTime)}
                          </div>
                        </div>
                      )}
                    </div>
                    
                    <div className="text-xs font-medium text-muted-foreground">
                      {hour.hour === 0 ? '12a' : hour.hour < 12 ? `${hour.hour}a` : hour.hour === 12 ? '12p' : `${hour.hour - 12}p`}
                    </div>
                    
                    {isPeak && (
                      <Badge variant="default" className="absolute -top-6 text-xs">
                        Peak
                      </Badge>
                    )}
                  </motion.div>
                );
              })}
            </div>
          </Card>
        </TabsContent>

        {/* ── Tracker ── */}
        <TabsContent value="tracker" className="space-y-4 mt-6">
          {/* Timer stat cards */}
          <div className="grid md:grid-cols-3 gap-4">
            <Card className="p-6">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-muted-foreground">Current Session</span>
                <Clock size={16} className="text-muted-foreground" />
              </div>
              <div className="text-3xl font-semibold font-mono tabular-nums">
                {formatDurationSeconds(timerElapsed)}
              </div>
            </Card>

            <Card className="p-6">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-muted-foreground">Today</span>
                <Clock size={16} className="text-muted-foreground" />
              </div>
              <div className="text-3xl font-semibold font-mono tabular-nums">
                {(() => {
                  const todayStart = startOfDay(new Date()).toISOString();
                  const todayEnd = endOfDay(new Date()).toISOString();
                  const todayTotal = timeEntries
                    .filter(e => e.startAt >= todayStart && e.startAt <= todayEnd && e.endAt)
                    .reduce((acc, e) => acc + differenceInSeconds(new Date(e.endAt!), new Date(e.startAt)), 0);
                  return formatDurationSeconds(todayTotal + (runningTimer ? timerElapsed : 0));
                })()}
              </div>
            </Card>

            <Card className="p-6">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-muted-foreground">This Week</span>
                <Clock size={16} className="text-muted-foreground" />
              </div>
              <div className="text-3xl font-semibold font-mono tabular-nums">
                {(() => {
                  const weekStart = startOfWeek(new Date()).toISOString();
                  const weekEnd = endOfWeek(new Date()).toISOString();
                  const weekTotal = timeEntries
                    .filter(e => e.startAt >= weekStart && e.startAt <= weekEnd && e.endAt)
                    .reduce((acc, e) => acc + differenceInSeconds(new Date(e.endAt!), new Date(e.startAt)), 0);
                  return formatDurationSeconds(weekTotal + (runningTimer ? timerElapsed : 0));
                })()}
              </div>
            </Card>
          </div>

          {/* Timer control */}
          <Card className="p-6">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="flex-1 w-full">
                {runningTimer ? (
                  <div>
                    <p className="text-sm text-muted-foreground mb-1">Timer running</p>
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                      <p className="font-medium">{runningTimer.note || 'No description'}</p>
                    </div>
                  </div>
                ) : (
                  <p className="text-muted-foreground">No timer running</p>
                )}
              </div>

              {runningTimer ? (
                <Button onClick={() => void handleTimerStop()} variant="destructive" className="gap-2 w-full sm:w-auto">
                  <Stop size={16} weight="fill" />
                  Stop Timer
                </Button>
              ) : (
                <Dialog open={isTimerDialogOpen} onOpenChange={setIsTimerDialogOpen}>
                  <DialogTrigger asChild>
                    <Button className="gap-2 w-full sm:w-auto">
                      <Play size={16} weight="fill" />
                      Start Timer
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Start New Timer</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4">
                      <div>
                        <Label htmlFor="tracker-todo">Link to Todo (optional)</Label>
                        <Select
                          value={timerFormData.todoId}
                          onValueChange={(val) => setTimerFormData({ ...timerFormData, todoId: val })}
                        >
                          <SelectTrigger id="tracker-todo">
                            <SelectValue placeholder="None" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">None</SelectItem>
                            {todos.filter(t => t.status !== 'done').map((todo) => (
                              <SelectItem key={todo.id} value={todo.id}>{todo.title}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label htmlFor="tracker-note">Description</Label>
                        <Textarea
                          id="tracker-note"
                          value={timerFormData.note}
                          onChange={(e) => setTimerFormData({ ...timerFormData, note: e.target.value })}
                          placeholder="What are you working on?"
                          rows={3}
                        />
                      </div>
                      <div className="flex justify-end gap-2 pt-4">
                        <Button variant="outline" onClick={() => setIsTimerDialogOpen(false)}>Cancel</Button>
                        <Button onClick={() => void handleTimerStart()}>Start Timer</Button>
                      </div>
                    </div>
                  </DialogContent>
                </Dialog>
              )}
            </div>
          </Card>

          {/* Recent entries */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">Recent Entries</h3>
            {timeEntries.length === 0 ? (
              <Card className="p-12 text-center">
                <Clock weight="thin" size={64} className="mx-auto mb-4 text-muted-foreground" />
                <h3 className="text-xl font-semibold mb-2">No Time Entries Yet</h3>
                <p className="text-muted-foreground mb-4">Start tracking your time to see entries here</p>
                <Button onClick={() => setIsTimerDialogOpen(true)} className="gap-2">
                  <Play size={16} weight="fill" />
                  Start Your First Timer
                </Button>
              </Card>
            ) : (
              <div className="space-y-2">
                <AnimatePresence mode="popLayout">
                  {timeEntries.slice().sort((a, b) => b.startAt.localeCompare(a.startAt)).map((entry) => {
                    const todo = entry.todoId ? todos.find(t => t.id === entry.todoId) : null;
                    const duration = getEntryDuration(entry);
                    const isRunning = !entry.endAt;

                    return (
                      <motion.div
                        key={entry.id}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, x: -100 }}
                        transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                      >
                        <Card className={cn(
                          "p-4 hover:shadow-sm transition-all duration-200 group",
                          isRunning && "border-green-500 bg-green-50/5"
                        )}>
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                {isRunning && <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />}
                                <p className="font-medium">{entry.note || 'No description'}</p>
                                {isRunning && <Badge variant="outline" className="text-xs">Running</Badge>}
                              </div>
                              <div className="flex items-center gap-3 text-sm text-muted-foreground flex-wrap">
                                <span>{format(new Date(entry.startAt), 'MMM d, h:mm a')}</span>
                                <span>•</span>
                                <span className="font-mono font-semibold">
                                  {isRunning ? formatDurationSeconds(timerElapsed) : formatDurationSeconds(duration)}
                                </span>
                                {todo && <><span>•</span><span className="truncate">{todo.title}</span></>}
                              </div>
                            </div>
                            {!isRunning && (
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={() => void handleTimerDelete(entry.id)}
                                className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-all text-destructive hover:text-destructive shrink-0"
                              >
                                <Trash size={16} />
                              </Button>
                            )}
                          </div>
                        </Card>
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
              </div>
            )}
          </div>

          <ConfirmDialog
            open={timerDeleteConfirmOpen}
            onOpenChange={(open) => {
              setTimerDeleteConfirmOpen(open);
              if (!open) setTimerEntryToDelete(null);
            }}
            title="Delete Time Entry?"
            description="Are you sure you want to delete this time entry? This action cannot be undone."
            actionType="delete"
            variant="destructive"
            confirmText="Delete"
            cancelText="Cancel"
            onConfirm={() => void handleTimerDeleteConfirm()}
          />
        </TabsContent>

        {/* ── Planned vs Actual ── */}
        <TabsContent value="planned-vs-actual" className="space-y-4 mt-6">
          <div className="grid gap-4 md:grid-cols-3">
            <Card className="p-6">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold">Today</h3>
                <CalendarBlank size={20} className="text-muted-foreground" />
              </div>
              <p className="text-3xl font-bold mb-2">{formatDuration(stats.todayFocusTime)}</p>
              <div className="flex items-center gap-2 text-sm">
                {stats.todayFocusTime > (stats.weekFocusTime / 7) ? (
                  <>
                    <ArrowUp size={16} className="text-green-600 dark:text-green-400" />
                    <span className="text-green-600 dark:text-green-400">Above average</span>
                  </>
                ) : stats.todayFocusTime < (stats.weekFocusTime / 7) ? (
                  <>
                    <ArrowDown size={16} className="text-yellow-600 dark:text-yellow-400" />
                    <span className="text-yellow-600 dark:text-yellow-400">Below average</span>
                  </>
                ) : (
                  <>
                    <Circle size={16} className="text-muted-foreground" />
                    <span className="text-muted-foreground">Average</span>
                  </>
                )}
              </div>
            </Card>

            <Card className="p-6">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold">This Week</h3>
                <ChartBar size={20} className="text-muted-foreground" />
              </div>
              <p className="text-3xl font-bold mb-2">{formatDuration(stats.weekFocusTime)}</p>
              <p className="text-sm text-muted-foreground">
                Avg {formatDuration(stats.weekFocusTime / 7)} per day
              </p>
            </Card>

            <Card className="p-6">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold">This Month</h3>
                <Target size={20} className="text-muted-foreground" />
              </div>
              <p className="text-3xl font-bold mb-2">{formatDuration(stats.monthFocusTime)}</p>
              <p className="text-sm text-muted-foreground">
                {Math.round((stats.monthFocusTime / 60) / (new Date().getDate()))}h avg per day
              </p>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </motion.div>
  );
}
