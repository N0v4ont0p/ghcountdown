import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import {
  format,
  startOfWeek,
  endOfWeek,
  subWeeks,
  parseISO,
  differenceInMinutes,
} from 'date-fns';
import { getAllTimeEntries } from '@/db/repositories/timeRepo';
import { getAllTodos, updateTodo, deleteTodo } from '@/db/repositories/todosRepo';
import { getAllProjects } from '@/db/repositories/projectsRepo';
import { Todo, Project } from '@/db/schema';
import { Clock, CheckCircle, CalendarBlank, Folder, ArrowRight } from '@phosphor-icons/react';
import { weeklyReviewKey } from '@/lib/weeklyTrajectory';

interface Props {
  onDismiss: () => void;
}

interface WeekSummary {
  totalFocusMinutes: number;
  tasksCompleted: number;
  activeDays: number;
}

interface GoalCheck {
  project: Project;
  completedThisWeek: number;
  totalLinked: number;
}

function buildSummarySentence(summary: WeekSummary): string {
  const hours = Math.floor(summary.totalFocusMinutes / 60);
  const mins = summary.totalFocusMinutes % 60;
  const focusStr = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;

  if (summary.totalFocusMinutes >= 120) {
    return `A strong week — ${focusStr} of focused work and ${summary.tasksCompleted} task${summary.tasksCompleted !== 1 ? 's' : ''} completed across ${summary.activeDays} active day${summary.activeDays !== 1 ? 's' : ''}.`;
  }
  if (summary.totalFocusMinutes >= 30) {
    return `A steady week — ${summary.tasksCompleted} task${summary.tasksCompleted !== 1 ? 's' : ''} done and ${focusStr} of focused time over ${summary.activeDays} day${summary.activeDays !== 1 ? 's' : ''}.`;
  }
  if (summary.tasksCompleted > 0) {
    return `A lighter week — ${summary.tasksCompleted} task${summary.tasksCompleted !== 1 ? 's' : ''} completed. Fresh start next week.`;
  }
  return `A quiet week — nothing tracked. Next week is a fresh page.`;
}

export function WeeklyReview({ onDismiss }: Props) {
  const [summary, setSummary] = useState<WeekSummary>({
    totalFocusMinutes: 0,
    tasksCompleted: 0,
    activeDays: 0,
  });
  const [weekRange, setWeekRange] = useState({ start: new Date(), end: new Date() });
  const [openLoops, setOpenLoops] = useState<Todo[]>([]);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  const [goalChecks, setGoalChecks] = useState<GoalCheck[]>([]);
  const [intention, setIntention] = useState(
    () => localStorage.getItem('weeklyIntention') ?? '',
  );
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const now = new Date();
    const lastWeekStart = startOfWeek(subWeeks(now, 1));
    const lastWeekEnd = endOfWeek(subWeeks(now, 1));
    setWeekRange({ start: lastWeekStart, end: lastWeekEnd });

    async function loadData() {
      try {
        const [entries, todos, projects] = await Promise.all([
          getAllTimeEntries(),
          getAllTodos(),
          getAllProjects(),
        ]);

        // --- Week summary ---
        const weekEntries = entries.filter(e => {
          if (!e.endAt) return false;
          const s = parseISO(e.startAt);
          return s >= lastWeekStart && s <= lastWeekEnd;
        });

        const totalFocusMinutes = Math.round(
          weekEntries.reduce((sum, e) => {
            if (e.endAt) {
              return sum + Math.max(0, differenceInMinutes(parseISO(e.endAt), parseISO(e.startAt)));
            }
            return sum;
          }, 0),
        );

        const completedLastWeek = todos.filter(t => {
          if (t.status !== 'done') return false;
          const updated = parseISO(t.updatedAt);
          return updated >= lastWeekStart && updated <= lastWeekEnd;
        });

        const activeDaySet = new Set([
          ...weekEntries.map(e => format(parseISO(e.startAt), 'yyyy-MM-dd')),
          ...completedLastWeek.map(t => format(parseISO(t.updatedAt), 'yyyy-MM-dd')),
        ]);

        setSummary({
          totalFocusMinutes,
          tasksCompleted: completedLastWeek.length,
          activeDays: activeDaySet.size,
        });

        // --- Open loops: today/inbox with a past due date ---
        const pastDue = todos.filter(t => {
          if (t.status !== 'today' && t.status !== 'inbox') return false;
          if (!t.dueAt) return false;
          return parseISO(t.dueAt) < now;
        });
        setOpenLoops(pastDue);

        // --- Goals check: projects with any linked todos ---
        const goalData: GoalCheck[] = projects
          .map(project => {
            const linked = todos.filter(t => t.projectId === project.id);
            const completedThisWeek = linked.filter(t => {
              if (t.status !== 'done') return false;
              const updated = parseISO(t.updatedAt);
              return updated >= lastWeekStart && updated <= lastWeekEnd;
            }).length;
            return { project, completedThisWeek, totalLinked: linked.length };
          })
          .filter(g => g.totalLinked > 0);

        setGoalChecks(goalData);
      } finally {
        setIsLoading(false);
      }
    }
    loadData();
  }, []);

  async function handleKeep(id: string) {
    setDismissedIds(prev => new Set(prev).add(id));
  }

  async function handleSomeday(id: string) {
    await updateTodo(id, { status: 'someday' });
    setDismissedIds(prev => new Set(prev).add(id));
  }

  async function handleDelete(id: string) {
    await deleteTodo(id);
    setDismissedIds(prev => new Set(prev).add(id));
  }

  function handleClose() {
    localStorage.setItem('weeklyIntention', intention);
    localStorage.setItem('weeklyReviewKey', weeklyReviewKey());
    onDismiss();
  }

  const visibleLoops = openLoops.filter(t => !dismissedIds.has(t.id));
  const summarySentence = buildSummarySentence(summary);

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
        className="bg-background rounded-2xl shadow-2xl w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto"
      >
        <div className="p-8 space-y-7">
          {/* Header */}
          <div>
            <h1 className="text-3xl font-semibold text-foreground">Weekly Review</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {format(weekRange.start, 'MMM d')} – {format(weekRange.end, 'MMM d, yyyy')}
            </p>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <>
              {/* Week summary */}
              <div className="space-y-3">
                <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                  Last week
                </h2>
                <div className="flex gap-3 flex-wrap">
                  <div className="flex-1 min-w-[110px] rounded-xl bg-muted/50 p-3 text-center">
                    <Clock size={18} className="mx-auto mb-1 text-primary" weight="duotone" />
                    <p className="text-2xl font-bold">
                      {Math.floor(summary.totalFocusMinutes / 60)}h{' '}
                      {summary.totalFocusMinutes % 60}m
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">focus time</p>
                  </div>
                  <div className="flex-1 min-w-[110px] rounded-xl bg-muted/50 p-3 text-center">
                    <CheckCircle
                      size={18}
                      className="mx-auto mb-1 text-green-500"
                      weight="duotone"
                    />
                    <p className="text-2xl font-bold">{summary.tasksCompleted}</p>
                    <p className="text-xs text-muted-foreground mt-1">tasks done</p>
                  </div>
                  <div className="flex-1 min-w-[110px] rounded-xl bg-muted/50 p-3 text-center">
                    <CalendarBlank
                      size={18}
                      className="mx-auto mb-1 text-blue-500"
                      weight="duotone"
                    />
                    <p className="text-2xl font-bold">{summary.activeDays}</p>
                    <p className="text-xs text-muted-foreground mt-1">active days</p>
                  </div>
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed italic">
                  {summarySentence}
                </p>
              </div>

              {/* Open loops */}
              <div className="space-y-3">
                <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                  Open loops
                </h2>
                {visibleLoops.length === 0 ? (
                  <p className="text-sm text-green-600 dark:text-green-400">
                    No overdue items — clean slate ✓
                  </p>
                ) : (
                  <div className="space-y-2">
                    {visibleLoops.map(todo => (
                      <div
                        key={todo.id}
                        className="flex items-center gap-2 py-1"
                      >
                        <span className="flex-1 text-sm truncate">{todo.title}</span>
                        {todo.dueAt && (
                          <span className="text-xs text-red-500 shrink-0">
                            due {format(parseISO(todo.dueAt), 'MMM d')}
                          </span>
                        )}
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-xs h-7 px-2 shrink-0"
                          onClick={() => void handleKeep(todo.id)}
                        >
                          Keep
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-xs h-7 px-2 shrink-0"
                          onClick={() => void handleSomeday(todo.id)}
                        >
                          Someday
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-xs h-7 px-2 shrink-0 text-destructive hover:text-destructive"
                          onClick={() => void handleDelete(todo.id)}
                        >
                          Delete
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Goals check */}
              {goalChecks.length > 0 && (
                <div className="space-y-3">
                  <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                    Goals
                  </h2>
                  <div className="space-y-2">
                    {goalChecks.map(g => (
                      <Card key={g.project.id} className="p-3 flex items-center gap-3">
                        <div
                          className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                          style={{ backgroundColor: g.project.color }}
                        />
                        <Folder size={14} className="text-muted-foreground shrink-0" />
                        <span className="flex-1 text-sm font-medium truncate">
                          {g.project.name}
                        </span>
                        <span className="text-sm text-muted-foreground shrink-0">
                          {g.completedThisWeek}/{g.totalLinked} done
                        </span>
                      </Card>
                    ))}
                  </div>
                </div>
              )}

              {/* Next week intention */}
              <div className="space-y-3">
                <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                  What matters most next week?
                </h2>
                <Textarea
                  value={intention}
                  onChange={e => setIntention(e.target.value)}
                  placeholder="One thing, or a few. Write it down."
                  rows={3}
                  className="resize-none"
                />
              </div>

              {/* Close button */}
              <Button className="w-full" size="lg" onClick={handleClose}>
                <ArrowRight size={16} className="mr-2" />
                Close the week
              </Button>
            </>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
