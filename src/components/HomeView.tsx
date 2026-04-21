import { memo, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Checkbox } from '@/components/ui/checkbox';
import { MomentumStrip } from '@/components/MomentumStrip';
import { Sparkle, X } from '@phosphor-icons/react';
import { format } from 'date-fns';
import { Event, Todo, TimeBlock, Goal } from '@/db/schema';

function AnimatedDigit({ value }: { value: number }) {
  const digits = String(value).padStart(2, '0');
  return (
    <div className="inline-flex overflow-hidden">
      <AnimatePresence mode="popLayout">
        <motion.span
          key={value}
          initial={{ y: 18, opacity: 0, filter: 'blur(4px)' }}
          animate={{ y: 0, opacity: 1, filter: 'blur(0px)' }}
          exit={{ y: -18, opacity: 0, filter: 'blur(4px)' }}
          transition={{ type: 'spring', damping: 22, stiffness: 300 }}
          className="inline-block tabular-nums font-bold"
        >
          {digits}
        </motion.span>
      </AnimatePresence>
    </div>
  );
}

interface HomeViewProps {
  nextEvent: Event | null;
  upcomingEvents: Event[];
  todos: Todo[];
  todayBlocks: TimeBlock[];
  activeGoals: Goal[];
  morningBriefing: string | null;
  aiNudges: string[];
  weeklyIntention: string;
  onNavigate: (view: string) => void;
  onCompleteTodo: (todoId: string) => Promise<void>;
  onDismissMorningBriefing: () => void;
  onShowWeeklyReview: () => void;
}

function HomeViewInner({
  nextEvent,
  upcomingEvents,
  todos,
  todayBlocks,
  activeGoals,
  morningBriefing,
  aiNudges,
  weeklyIntention,
  onNavigate,
  onCompleteTodo,
  onDismissMorningBriefing,
  onShowWeeklyReview,
}: HomeViewProps) {
  // These tickers live here so App never re-renders from them
  const [nowTick, setNowTick] = useState(new Date());
  const [countdownTick, setCountdownTick] = useState(Date.now());

  useEffect(() => {
    const id = setInterval(() => setNowTick(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const id = setInterval(() => setCountdownTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const currentHHMM = format(nowTick, 'HH:mm');
  const activeBlock =
    todayBlocks.find(b => b.startTime <= currentHHMM && currentHHMM < b.endTime) ?? null;
  const nextUpcomingBlock = !activeBlock
    ? (todayBlocks.find(b => b.startTime > currentHHMM) ?? null)
    : null;
  const timelineCountdownTarget = activeBlock
    ? {
        title: activeBlock.title,
        startsAt: `${format(nowTick, 'yyyy-MM-dd')}T${activeBlock.endTime}:00`,
        color: activeBlock.color,
        label: 'Block ends in',
        whenText: `Today • ${activeBlock.endTime}`,
      }
    : nextUpcomingBlock
      ? {
          title: nextUpcomingBlock.title,
          startsAt: `${format(nowTick, 'yyyy-MM-dd')}T${nextUpcomingBlock.startTime}:00`,
          color: nextUpcomingBlock.color,
          label: 'Timeline starts in',
          whenText: `Today • ${nextUpcomingBlock.startTime}`,
        }
      : null;
  const countdownTarget = nextEvent
    ? {
        title: nextEvent.title,
        startsAt: nextEvent.startsAt,
        color: `var(--priority-${nextEvent.priority})`,
        label: 'Counting down to',
        whenText: format(new Date(nextEvent.startsAt), 'EEEE, MMMM d, yyyy • h:mm a'),
      }
    : timelineCountdownTarget;
  const countdownTimeLeft = countdownTarget
    ? (() => {
        const diff = new Date(countdownTarget.startsAt).getTime() - countdownTick;
        if (diff <= 0) return null;
        return {
          days: Math.floor(diff / (1000 * 60 * 60 * 24)),
          hours: Math.floor((diff / (1000 * 60 * 60)) % 24),
          minutes: Math.floor((diff / 1000 / 60) % 60),
          seconds: Math.floor((diff / 1000) % 60),
        };
      })()
    : null;

  return (
    <div className="max-w-6xl mx-auto flex flex-col gap-8">
      {/* ── COUNTDOWN HERO ── */}
      <div key="countdown-hero" className="glass-card rounded-3xl p-8 md:p-12 relative overflow-hidden">
        {countdownTarget ? (
          <>
            <div
              className="absolute top-0 left-0 right-0 h-1"
              style={{ backgroundColor: countdownTarget.color }}
            />
            <div className="text-center mb-8">
              <p className="text-xs uppercase tracking-widest text-muted-foreground mb-3">{countdownTarget.label}</p>
              <h1 className="text-3xl md:text-5xl font-bold tracking-tight mb-3">{countdownTarget.title}</h1>
              <p className="text-sm text-muted-foreground">
                {countdownTarget.whenText}
              </p>
            </div>
            {countdownTimeLeft ? (
              <div className="grid grid-cols-4 gap-4 md:gap-10">
                {[
                  { label: 'Days', value: countdownTimeLeft.days },
                  { label: 'Hours', value: countdownTimeLeft.hours },
                  { label: 'Minutes', value: countdownTimeLeft.minutes },
                  { label: 'Seconds', value: countdownTimeLeft.seconds },
                ].map(({ label, value }, i) => (
                  <motion.div
                    key={label}
                    initial={{ opacity: 0, scale: 0.85 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: 0.1 + i * 0.05 }}
                    className="text-center"
                  >
                    <div className="text-5xl md:text-7xl text-primary tracking-tighter">
                      <AnimatedDigit value={value} />
                    </div>
                    <div className="text-xs text-muted-foreground uppercase tracking-wide mt-1">
                      {label}
                    </div>
                  </motion.div>
                ))}
              </div>
            ) : (
              <p className="text-center text-muted-foreground py-4">This event has passed</p>
            )}
          </>
        ) : (
          <div className="text-center py-4">
            <h2 className="text-2xl font-semibold mb-2">No upcoming events</h2>
            <p className="text-muted-foreground text-sm">
              Add an important event to start counting down
            </p>
          </div>
        )}
      </div>

      {/* ── MAIN CONTENT: asymmetric two-column grid ── */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 lg:gap-8">

        {/* LEFT COLUMN — action-oriented */}
        <div className="lg:col-span-3 flex flex-col gap-6">

          {/* Right Now — no card border */}
          <motion.div
            key="right-now"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="rounded-2xl px-4 py-5 bg-muted/30"
          >
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">
              Right Now
            </p>
            {activeBlock ? (
              <div className="flex items-start gap-3">
                <span
                  className="animate-pulse w-2.5 h-2.5 rounded-full mt-1.5 flex-shrink-0"
                  style={{ backgroundColor: activeBlock.color }}
                />
                <div>
                  <p className="text-xl font-semibold leading-tight">{activeBlock.title}</p>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    {activeBlock.startTime}–{activeBlock.endTime}
                    {(() => {
                      const [eh, em] = activeBlock.endTime.split(':').map(Number);
                      const remain = (eh * 60 + em) - (nowTick.getHours() * 60 + nowTick.getMinutes());
                      return remain > 0 ? ` · ${remain} min remaining` : '';
                    })()}
                  </p>
                </div>
              </div>
            ) : nextUpcomingBlock ? (
              <div className="flex items-start gap-3">
                <span
                  className="w-2.5 h-2.5 rounded-full mt-1.5 flex-shrink-0 opacity-40"
                  style={{ backgroundColor: nextUpcomingBlock.color }}
                />
                <div>
                  <p className="text-sm text-muted-foreground">Up next</p>
                  <p className="text-xl font-semibold leading-tight">{nextUpcomingBlock.title}</p>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    {nextUpcomingBlock.startTime}
                    {' · '}
                    {(() => {
                      const [sh, sm] = nextUpcomingBlock.startTime.split(':').map(Number);
                      const inMin = (sh * 60 + sm) - (nowTick.getHours() * 60 + nowTick.getMinutes());
                      return inMin >= 60
                        ? `in ${Math.floor(inMin / 60)}h${inMin % 60 > 0 ? ` ${inMin % 60}m` : ''}`
                        : `in ${inMin}m`;
                    })()}
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-xl font-semibold">
                Free time
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  No more blocks today
                </span>
              </p>
            )}
          </motion.div>

          {/* Today's Schedule — colored pill timeline */}
          <motion.div
            key="todays-schedule"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
          >
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">
              Today's Schedule
            </p>
            {todayBlocks.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {todayBlocks.map(block => (
                  <button
                    key={block.id}
                    type="button"
                    onClick={() => onNavigate('timeline')}
                    className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-opacity hover:opacity-80"
                    style={{
                      backgroundColor: `${block.color}28`,
                      color: block.color,
                      border: `1px solid ${block.color}50`,
                    }}
                  >
                    <span className="tabular-nums">{block.startTime}</span>
                    <span>{block.title}</span>
                  </button>
                ))}
              </div>
            ) : (
              <button
                type="button"
                onClick={() => onNavigate('timeline')}
                className="text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                Nothing scheduled yet — Open Timeline →
              </button>
            )}
          </motion.div>

          {/* Focus Tasks — priority 4 & 5 only, max 4 */}
          <motion.div
            key="focus-tasks"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
          >
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">
              Focus Tasks
            </p>
            {todos.filter(t => t.status === 'today' && t.priority >= 4).length === 0 ? (
              <p className="text-sm text-muted-foreground">No high-priority tasks for today</p>
            ) : (
              <div className="flex flex-col gap-2">
                {todos.filter(t => t.status === 'today' && t.priority >= 4).slice(0, 4).map(todo => (
                  <div
                    key={todo.id}
                    className="flex items-center gap-3 rounded-lg px-3 py-2 bg-muted/20"
                    style={todo.priority === 5 ? { borderLeft: '3px solid var(--destructive)' } : {}}
                  >
                    <Checkbox
                      className="flex-shrink-0"
                      onCheckedChange={() => onCompleteTodo(todo.id)}
                    />
                    <span className="flex-1 text-sm truncate">{todo.title}</span>
                    <span className="text-xs text-muted-foreground shrink-0">P{todo.priority}</span>
                  </div>
                ))}
              </div>
            )}
            <button
              type="button"
              onClick={() => onNavigate('todos')}
              className="mt-3 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              See all tasks →
            </button>
          </motion.div>
        </div>

        {/* RIGHT COLUMN — context and insight */}
        <div className="lg:col-span-2 flex flex-col gap-5">

          {/* Morning briefing — blockquote style */}
          {morningBriefing && (
            <motion.div
              key="morning-briefing"
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.1 }}
              className="relative rounded-xl pl-4 pr-8 py-3 bg-primary/5 border-l-2 border-l-primary"
            >
              <Sparkle size={13} weight="fill" className="text-primary absolute top-3 right-3" />
              <p className="text-sm leading-relaxed">{morningBriefing}</p>
              <button
                type="button"
                onClick={onDismissMorningBriefing}
                className="absolute top-2 right-2 text-muted-foreground hover:text-foreground"
              >
                <X size={13} />
              </button>
            </motion.div>
          )}

          {/* Weekly intention */}
          {weeklyIntention && (
            <motion.div
              key="weekly-intention"
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.12 }}
              className="rounded-xl pl-4 py-3 pr-3 bg-muted/40 border-l-2 border-l-primary/40"
            >
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-1">
                This week
              </p>
              <p className="text-sm leading-relaxed">{weeklyIntention}</p>
              <button
                type="button"
                className="mt-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                onClick={onShowWeeklyReview}
              >
                Review →
              </button>
            </motion.div>
          )}

          {/* Goals progress — thin rows, no card border */}
          {activeGoals.length > 0 && (
            <motion.div
              key="goals-progress"
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.15 }}
              className="flex flex-col gap-3"
            >
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                Goals
              </p>
              {activeGoals.slice(0, 4).map(goal => {
                const linked = todos.filter(t => t.goalId === goal.id);
                const done = linked.filter(t => t.status === 'done').length;
                const pct = linked.length > 0 ? Math.round((done / linked.length) * 100) : 0;
                return (
                  <div key={goal.id}>
                    <div className="flex items-center gap-2 mb-1">
                      <span
                        className="w-2 h-2 rounded-full flex-shrink-0"
                        style={{ backgroundColor: goal.color }}
                      />
                      <span className="text-sm flex-1 truncate">{goal.title}</span>
                      <span className="text-xs text-muted-foreground">{pct}%</span>
                    </div>
                    <div className="w-full bg-muted rounded-full h-1 overflow-hidden">
                      <div
                        className="rounded-full h-1 transition-all duration-500"
                        style={{ width: `${pct}%`, backgroundColor: goal.color }}
                      />
                    </div>
                  </div>
                );
              })}
            </motion.div>
          )}

          {/* Upcoming events — max 3, minimal rows */}
          {upcomingEvents.length > 0 && (
            <motion.div
              key="upcoming-events"
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.2 }}
              className="flex flex-col gap-1"
            >
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-1">
                Upcoming
              </p>
              {upcomingEvents.slice(0, 3).map(evt => (
                <button
                  key={evt.id}
                  type="button"
                  onClick={() => onNavigate('events')}
                  className="flex items-center gap-2 text-sm text-left hover:bg-muted/40 rounded-lg px-2 py-1.5 transition-colors"
                >
                  <span
                    className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                    style={{ backgroundColor: `var(--priority-${evt.priority})` }}
                  />
                  <span className="flex-1 truncate">{evt.title}</span>
                  <span className="text-xs text-muted-foreground shrink-0">
                    {format(new Date(evt.startsAt), 'MMM d')}
                  </span>
                  {evt.priority >= 4 && (
                    <span className={`text-xs px-1.5 py-0.5 rounded font-medium shrink-0 ${evt.priority === 5 ? 'bg-destructive/15 text-destructive' : 'bg-yellow-500/15 text-yellow-600 dark:text-yellow-400'}`}>
                      P{evt.priority}
                    </span>
                  )}
                </button>
              ))}
            </motion.div>
          )}

          {/* AI nudges — max 2 */}
          {aiNudges.length > 0 && (
            <motion.div
              key="ai-nudges"
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.25 }}
              className="flex flex-col gap-1.5"
            >
              {aiNudges.slice(0, 2).map((nudge, i) => (
                <div key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                  <Sparkle size={12} weight="fill" className="text-yellow-500 mt-0.5 flex-shrink-0" />
                  <span>{nudge}</span>
                </div>
              ))}
            </motion.div>
          )}

          {/* Momentum — compact inline stats */}
          <motion.div
            key="momentum"
            initial={{ opacity: 0, x: 10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.28 }}
          >
            <MomentumStrip compact />
          </motion.div>
        </div>
      </div>
    </div>
  );
}

export const HomeView = memo(HomeViewInner);
