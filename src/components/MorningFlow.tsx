import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { format } from 'date-fns';
import { getAllTodos } from '@/db/repositories/todosRepo';
import { getTimeBlocksByDate } from '@/db/repositories/timeBlocksRepo';
import { scheduleMyDay } from '@/lib/schedulingUtils';
import { Todo, TimeBlock } from '@/db/schema';
import { PRIORITY_COLORS } from '@/lib/scheduleDay';

interface Props {
  briefing: string | null;
  onDismiss: () => void;
}

const MAX_SECONDS = 30;

export function MorningFlow({ briefing, onDismiss }: Props) {
  const today = new Date().toISOString().split('T')[0];
  const [secondsLeft, setSecondsLeft] = useState(MAX_SECONDS);
  const [todayBlocks, setTodayBlocks] = useState<TimeBlock[]>([]);
  const [unscheduled, setUnscheduled] = useState<Todo[]>([]);
  const [isScheduling, setIsScheduling] = useState(false);
  const dismissed = useRef(false);

  function dismiss() {
    if (dismissed.current) return;
    dismissed.current = true;
    localStorage.setItem('morningFlowDate', today);
    onDismiss();
  }

  useEffect(() => {
    async function loadData() {
      const [blocks, allTodos] = await Promise.all([
        getTimeBlocksByDate(today),
        getAllTodos(),
      ]);
      const sorted = blocks.sort((a, b) => a.startTime.localeCompare(b.startTime));
      setTodayBlocks(sorted);
      const scheduledIds = new Set(sorted.map(b => b.todoId).filter(Boolean) as string[]);
      setUnscheduled(allTodos.filter(t => t.status === 'today' && !scheduledIds.has(t.id)));
    }
    loadData();
  }, [today]);

  useEffect(() => {
    if (secondsLeft <= 0) {
      dismiss();
      return;
    }
    const id = setTimeout(() => setSecondsLeft(s => s - 1), 1000);
    return () => clearTimeout(id);
  }, [secondsLeft]);

  async function handleScheduleMyDay() {
    setIsScheduling(true);
    try {
      await scheduleMyDay(today, unscheduled, todayBlocks);
    } finally {
      setIsScheduling(false);
      dismiss();
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96 }}
        transition={{ duration: 0.3 }}
        className="bg-background rounded-2xl shadow-2xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto"
      >
        <div className="p-8 space-y-6">
          <div className="flex items-start justify-between">
            <h1 className="text-3xl font-semibold text-amber-600 dark:text-amber-400">
              Good morning
            </h1>
            <span className="text-xs text-muted-foreground mt-2">{secondsLeft}s</span>
          </div>

          <p className="text-base leading-relaxed">
            {briefing ?? 'Here is your day.'}
          </p>

          {todayBlocks.length > 0 && (
            <div className="space-y-2">
              <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                Already scheduled
              </h2>
              <div className="space-y-1">
                {todayBlocks.map(block => (
                  <div key={block.id} className="flex gap-2 text-sm">
                    <span className="text-muted-foreground w-12 flex-shrink-0">{block.startTime}</span>
                    <span className="truncate">{block.title}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {unscheduled.length > 0 && (
            <div className="space-y-2">
              <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                Still to place
              </h2>
              <div className="space-y-1">
                {unscheduled.map(todo => (
                  <div key={todo.id} className="flex items-center gap-2 text-sm">
                    <div
                      className="w-2 h-2 rounded-full flex-shrink-0"
                      style={{ backgroundColor: PRIORITY_COLORS[todo.priority] }}
                    />
                    <span className="truncate">{todo.title}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <Button
            className="w-full"
            size="lg"
            onClick={handleScheduleMyDay}
            disabled={isScheduling}
          >
            {isScheduling ? 'Scheduling…' : 'Schedule My Day'}
          </Button>

          <button
            className="w-full text-sm text-muted-foreground hover:text-foreground transition-colors"
            onClick={dismiss}
          >
            I'll plan manually →
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
