import { motion } from 'framer-motion';
import { Event, TimeBlock } from '@/db/schema';
import { Button } from '@/components/ui/button';
import { Hourglass, CalendarBlank, ClockCountdown } from '@phosphor-icons/react';
import { format } from 'date-fns';

interface TimerViewProps {
  nextEvent: Event | null;
  activeBlock: TimeBlock | null;
  nextBlock: TimeBlock | null;
  activeRemainingSeconds: number | null;
  nextStartsInSeconds: number | null;
  onNavigate: (view: string) => void;
}

function formatCountdown(seconds: number): string {
  const safe = Math.max(0, seconds);
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
  return `${m}m ${String(s).padStart(2, '0')}s`;
}

export function TimerView({
  nextEvent,
  activeBlock,
  nextBlock,
  activeRemainingSeconds,
  nextStartsInSeconds,
  onNavigate,
}: TimerViewProps) {
  const timerHeadline = activeBlock
    ? {
        label: 'Current block ends in',
        title: activeBlock.title,
        time: formatCountdown(activeRemainingSeconds ?? 0),
        meta: `${activeBlock.startTime}–${activeBlock.endTime}`,
        color: activeBlock.color,
      }
    : nextBlock
      ? {
          label: 'Next block starts in',
          title: nextBlock.title,
          time: formatCountdown(nextStartsInSeconds ?? 0),
          meta: `${nextBlock.startTime}–${nextBlock.endTime}`,
          color: nextBlock.color,
        }
      : null;

  return (
    <div className="max-w-5xl mx-auto py-2">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="glass-card rounded-3xl p-8 md:p-10"
      >
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
            <ClockCountdown size={22} />
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Timer</p>
            <h2 className="text-2xl font-semibold tracking-tight">Focus clock</h2>
          </div>
        </div>

        {timerHeadline ? (
          <motion.div
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            className="rounded-2xl border bg-card/60 p-6 md:p-8"
            style={{ borderColor: `${timerHeadline.color}66` }}
          >
            <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground mb-2">{timerHeadline.label}</p>
            <h3 className="text-2xl md:text-3xl font-semibold leading-tight mb-2">{timerHeadline.title}</h3>
            <p className="text-muted-foreground mb-5">{timerHeadline.meta}</p>
            <p className="text-4xl md:text-6xl font-bold tabular-nums tracking-tight text-primary">
              {timerHeadline.time}
            </p>
          </motion.div>
        ) : (
          <div className="rounded-2xl border bg-card/40 p-6 text-center">
            <Hourglass size={34} className="mx-auto mb-3 text-muted-foreground" />
            <p className="text-lg font-semibold">No active timer targets</p>
            <p className="text-sm text-muted-foreground mt-1">Add blocks in Timeline to see live timers here.</p>
          </div>
        )}

        {nextEvent && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.08 }}
            className="mt-5 rounded-xl border bg-card/40 p-4 flex items-center justify-between gap-3"
          >
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-[0.12em] text-muted-foreground mb-1">Next important event</p>
              <p className="font-medium truncate">{nextEvent.title}</p>
              <p className="text-xs text-muted-foreground">{format(new Date(nextEvent.startsAt), 'EEEE, MMM d • h:mm a')}</p>
            </div>
            <CalendarBlank size={18} className="text-muted-foreground shrink-0" />
          </motion.div>
        )}

        <div className="mt-6 flex flex-wrap gap-2">
          <Button onClick={() => onNavigate('timeline')} className="rounded-full">Open Timeline</Button>
          <Button variant="outline" onClick={() => onNavigate('home')} className="rounded-full">Go Home</Button>
        </div>
      </motion.div>
    </div>
  );
}
