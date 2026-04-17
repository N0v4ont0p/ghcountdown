import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Clock, ArrowRight } from '@phosphor-icons/react';
import { format } from 'date-fns';
import { withColorAlpha } from '@/lib/scheduleDay';
import { TimeBlock } from '@/db/schema';

export interface RightNowCardProps {
  blocks: TimeBlock[];
  now: Date;
  onNavigateTimeline: () => void;
}

function formatTimeUntil(minutes: number): string {
  if (minutes >= 60) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m > 0 ? `in ${h}h ${m}m` : `in ${h}h`;
  }
  return `in ${minutes} min`;
}

export function RightNowCard({ blocks, now, onNavigateTimeline }: RightNowCardProps) {
  const currentHHMM = format(now, 'HH:mm');

  const activeBlock = blocks.find(
    b => b.startTime <= currentHHMM && currentHHMM < b.endTime
  ) ?? null;

  const nextBlock = !activeBlock
    ? blocks.find(b => b.startTime > currentHHMM) ?? null
    : null;

  let content: ReactNode;

  if (activeBlock) {
    const [endH, endM] = activeBlock.endTime.split(':').map(Number);
    const endTotal = endH * 60 + endM;
    const nowTotal = now.getHours() * 60 + now.getMinutes();
    const remainMin = endTotal - nowTotal;

    content = (
      <div className="flex items-start gap-4">
        <div
          className="w-1 self-stretch rounded-full flex-shrink-0"
          style={{ backgroundColor: activeBlock.color }}
        />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
            You're in
          </p>
          <h4 className="text-xl font-semibold truncate">{activeBlock.title}</h4>
          <p className="text-sm text-muted-foreground mt-1">
            {activeBlock.startTime}–{activeBlock.endTime}
            {remainMin > 0 && ` · ${remainMin} min remaining`}
          </p>
        </div>
        <div className="flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center"
          style={{ backgroundColor: withColorAlpha(activeBlock.color, 0.2) }}>
          <Clock size={20} style={{ color: activeBlock.color }} />
        </div>
      </div>
    );
  } else if (nextBlock) {
    const [startH, startM] = nextBlock.startTime.split(':').map(Number);
    const startTotal = startH * 60 + startM;
    const nowTotal = now.getHours() * 60 + now.getMinutes();
    const inMin = startTotal - nowTotal;
    const inText = formatTimeUntil(inMin);

    content = (
      <div className="flex items-start gap-4">
        <div
          className="w-1 self-stretch rounded-full flex-shrink-0 opacity-50"
          style={{ backgroundColor: nextBlock.color }}
        />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
            Up next
          </p>
          <h4 className="text-xl font-semibold truncate">{nextBlock.title}</h4>
          <p className="text-sm text-muted-foreground mt-1">
            {nextBlock.startTime} · starts {inText}
          </p>
        </div>
        <div className="flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center bg-muted">
          <ArrowRight size={20} className="text-muted-foreground" />
        </div>
      </div>
    );
  } else {
    content = (
      <div className="flex items-start gap-4">
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
            Right now
          </p>
          <h4 className="text-xl font-semibold">Free time</h4>
          <p className="text-sm text-muted-foreground mt-1">
            No more blocks scheduled today
          </p>
        </div>
      </div>
    );
  }

  return (
    <motion.div
      key={activeBlock?.id ?? nextBlock?.id ?? 'free'}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
    >
      <Card className="p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Clock size={18} />
            Right Now
          </h3>
          <Button
            size="sm"
            variant="ghost"
            onClick={onNavigateTimeline}
            className="gap-1 text-xs text-muted-foreground"
          >
            Timeline
            <ArrowRight size={14} />
          </Button>
        </div>
        {content}
      </Card>
    </motion.div>
  );
}
