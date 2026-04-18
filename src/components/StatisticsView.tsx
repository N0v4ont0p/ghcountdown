import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
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
  Circle
} from '@phosphor-icons/react';
import { getAllTimeEntries } from '@/db/repositories/timeRepo';
import { getAllTodos } from '@/db/repositories/todosRepo';
import { getAllEvents } from '@/db/repositories/eventsRepo';
import { TimeEntry, Todo, Event } from '@/db/schema';
import { format, startOfWeek, endOfWeek, startOfMonth, endOfMonth, eachDayOfInterval, differenceInMinutes, isToday, parseISO, startOfDay, endOfDay } from 'date-fns';
import { cn } from '@/lib/utils';

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
  const [_timeEntries, setTimeEntries] = useState<TimeEntry[]>([]);
  const [_todos, setTodos] = useState<Todo[]>([]);
  const [_events, setEvents] = useState<Event[]>([]);
  const [stats, setStats] = useState<StatsSummary | null>(null);
  const [weeklyData, setWeeklyData] = useState<DayStats[]>([]);
  const [hourlyData, setHourlyData] = useState<HourlyStats[]>([]);
  const [insights, setInsights] = useState<ProductivityInsight[]>([]);
  const [selectedPeriod, setSelectedPeriod] = useState<'week' | 'month'>('week');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadStatistics();
  }, [selectedPeriod]);

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
    } catch (error) {
      console.error('Failed to load statistics:', error);
    } finally {
      setIsLoading(false);
    }
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
        <h2 className="text-3xl font-semibold mb-2">Statistics & Insights</h2>
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

      <Tabs value={selectedPeriod} onValueChange={(v) => setSelectedPeriod(v as 'week' | 'month')} className="w-full">
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="week">This Week</TabsTrigger>
          <TabsTrigger value="month">This Month</TabsTrigger>
        </TabsList>

        <TabsContent value={selectedPeriod} className="space-y-6 mt-6">
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
