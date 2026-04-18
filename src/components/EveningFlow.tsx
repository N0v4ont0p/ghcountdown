import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { format, addDays } from 'date-fns';
import { toast } from 'sonner';
import { getAllTimeEntries } from '@/db/repositories/timeRepo';
import { getAllTodos, updateTodo } from '@/db/repositories/todosRepo';
import { getTimeBlocksByDate } from '@/db/repositories/timeBlocksRepo';
import { getEffectiveScheduleForDate } from '@/lib/effectiveSchedule';
import { Todo } from '@/db/schema';
import { PRIORITY_COLORS } from '@/lib/scheduleDay';

interface Props {
  onDismiss: () => void;
}

interface DayStats {
  focusMinutes: number;
  tasksDone: number;
  blocksCompleted: number;
}

export function EveningFlow({ onDismiss }: Props) {
  const hour = new Date().getHours();
  const heading = hour >= 22 ? 'End of day' : 'Winding down';
  const today = new Date().toISOString().split('T')[0];
  const tomorrow = format(addDays(new Date(), 1), 'yyyy-MM-dd');

  const [stats, setStats] = useState<DayStats>({ focusMinutes: 0, tasksDone: 0, blocksCompleted: 0 });
  const [unfinished, setUnfinished] = useState<Todo[]>([]);
  const [tomorrowEntries, setTomorrowEntries] = useState<{ startTime: string; title: string }[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  useEffect(() => {
    async function loadData() {
      const [timeEntries, allTodos, todayBlocks, tomorrowSched] = await Promise.all([
        getAllTimeEntries(),
        getAllTodos(),
        getTimeBlocksByDate(today),
        getEffectiveScheduleForDate(tomorrow),
      ]);

      const focusMinutes = timeEntries
        .filter(e => e.endAt?.startsWith(today))
        .reduce((sum, e) => {
          if (!e.endAt) return sum;
          const mins = (new Date(e.endAt).getTime() - new Date(e.startAt).getTime()) / 60000;
          return sum + Math.max(0, mins);
        }, 0);

      const tasksDone = allTodos.filter(
        t => t.status === 'done' && t.updatedAt.startsWith(today)
      ).length;

      setStats({
        focusMinutes: Math.round(focusMinutes),
        tasksDone,
        blocksCompleted: todayBlocks.length,
      });
      setUnfinished(allTodos.filter(t => t.status === 'today'));
      setTomorrowEntries(tomorrowSched.map(e => ({ startTime: e.startTime, title: e.title })));
    }
    loadData();
  }, [today, tomorrow]);

  function handleDismiss() {
    localStorage.setItem('eveningFlowDate', today);
    onDismiss();
    toast.success('Good work. See you tomorrow.');
  }

  async function handleTomorrow(todoId: string) {
    setDismissed(prev => new Set(prev).add(todoId));
  }

  async function handleInbox(todoId: string) {
    await updateTodo(todoId, { status: 'inbox' });
    setDismissed(prev => new Set(prev).add(todoId));
  }

  const visibleUnfinished = unfinished.filter(t => !dismissed.has(t.id));
  const allZero = stats.focusMinutes === 0 && stats.tasksDone === 0 && stats.blocksCompleted === 0;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: 'rgba(0,0,0,0.75)' }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96 }}
        transition={{ duration: 0.3 }}
        className="bg-background rounded-2xl shadow-2xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto"
      >
        <div className="p-8 space-y-6">
          <h1 className="text-3xl font-semibold text-foreground">{heading}</h1>

          <div className="space-y-2">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              What you did today
            </h2>
            {allZero ? (
              <p className="text-sm text-muted-foreground">Nothing tracked today — that's okay.</p>
            ) : (
              <div className="flex gap-3 flex-wrap">
                <div className="flex-1 min-w-[100px] rounded-xl bg-muted/50 p-3 text-center">
                  <p className="text-2xl font-bold">{stats.focusMinutes}</p>
                  <p className="text-xs text-muted-foreground mt-1">min focused</p>
                </div>
                <div className="flex-1 min-w-[100px] rounded-xl bg-muted/50 p-3 text-center">
                  <p className="text-2xl font-bold">{stats.tasksDone}</p>
                  <p className="text-xs text-muted-foreground mt-1">tasks done</p>
                </div>
                <div className="flex-1 min-w-[100px] rounded-xl bg-muted/50 p-3 text-center">
                  <p className="text-2xl font-bold">{stats.blocksCompleted}</p>
                  <p className="text-xs text-muted-foreground mt-1">blocks completed</p>
                </div>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Unfinished — what should happen to these?
            </h2>
            {visibleUnfinished.length === 0 ? (
              <p className="text-sm text-green-600 dark:text-green-400">Everything done today ✓</p>
            ) : (
              <div className="space-y-2">
                {visibleUnfinished.map(todo => (
                  <div key={todo.id} className="flex items-center gap-2">
                    <div
                      className="w-2 h-2 rounded-full flex-shrink-0"
                      style={{ backgroundColor: PRIORITY_COLORS[todo.priority] }}
                    />
                    <span className="flex-1 text-sm truncate">{todo.title}</span>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-xs h-7 px-2"
                      onClick={() => handleTomorrow(todo.id)}
                    >
                      Tomorrow
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-xs h-7 px-2"
                      onClick={() => handleInbox(todo.id)}
                    >
                      Inbox
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Tomorrow looks like
            </h2>
            {tomorrowEntries.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing routine scheduled</p>
            ) : (
              <div className="space-y-1">
                {tomorrowEntries.map((entry, i) => (
                  <div key={i} className="flex gap-2 text-sm">
                    <span className="text-muted-foreground w-12 flex-shrink-0">{entry.startTime}</span>
                    <span>{entry.title}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <Button className="w-full" onClick={handleDismiss}>
            I'm done for today
          </Button>
        </div>
      </motion.div>
    </motion.div>
  );
}
