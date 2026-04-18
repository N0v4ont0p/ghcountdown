import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Card } from '@/components/ui/card';
import { Target } from '@phosphor-icons/react';
import { Goal, Todo } from '@/db/schema';
import { getActiveGoals } from '@/db/repositories/goalsRepo';
import { getAllTodos } from '@/db/repositories/todosRepo';
import { differenceInCalendarDays } from 'date-fns';

interface GoalProgress {
  goal: Goal;
  total: number;
  done: number;
  daysLeft: number | null;
}

export function GoalsProgressCard() {
  const [goalProgresses, setGoalProgresses] = useState<GoalProgress[]>([]);

  useEffect(() => {
    async function load() {
      const [goals, todos] = await Promise.all([getActiveGoals(), getAllTodos()]);
      if (goals.length === 0) {
        setGoalProgresses([]);
        return;
      }

      const now = new Date();
      const progresses: GoalProgress[] = goals.map((goal) => {
        const linked: Todo[] = todos.filter((t) => t.goalId === goal.id);
        const done = linked.filter((t) => t.status === 'done').length;
        const total = linked.length;
        const daysLeft = goal.targetDate
          ? differenceInCalendarDays(new Date(goal.targetDate), now)
          : null;
        return { goal, total, done, daysLeft };
      });

      setGoalProgresses(progresses);
    }
    load();
  }, []);

  if (goalProgresses.length === 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
    >
      <Card className="p-4">
        <h3 className="font-semibold mb-3 flex items-center gap-2 text-sm">
          <Target size={16} />
          Goals Progress
        </h3>
        <div className="space-y-4">
          {goalProgresses.map(({ goal, total, done, daysLeft }) => {
            const pct = total > 0 ? Math.round((done / total) * 100) : 0;
            return (
              <div key={goal.id} className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <div
                      className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                      style={{ backgroundColor: goal.color }}
                    />
                    <span className="font-medium text-sm truncate">{goal.title}</span>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0 text-xs text-muted-foreground">
                    {daysLeft !== null && (
                      <span>{daysLeft >= 0 ? `${daysLeft}d left` : `${Math.abs(daysLeft)}d overdue`}</span>
                    )}
                    <span>{done}/{total}</span>
                  </div>
                </div>

                <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                  <motion.div
                    className="h-full rounded-full"
                    style={{ backgroundColor: goal.color }}
                    initial={{ width: 0 }}
                    animate={{ width: `${pct}%` }}
                    transition={{ duration: 0.6, ease: 'easeOut' }}
                  />
                </div>

                {goal.why && (
                  <p className="text-xs text-muted-foreground italic leading-tight">{goal.why}</p>
                )}
              </div>
            );
          })}
        </div>
      </Card>
    </motion.div>
  );
}
