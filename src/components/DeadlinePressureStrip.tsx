import { useMemo } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CalendarBlank } from '@phosphor-icons/react';
import { differenceInMinutes } from 'date-fns';
import { Event } from '@/db/schema';

export interface DeadlinePressureStripProps {
  events: Event[];
}

function getUrgencyColor(minutesUntil: number): { badge: string; dot: string } {
  const hours = minutesUntil / 60;
  if (hours < 24) {
    return { badge: 'bg-red-500/15 text-red-600 border-red-200 dark:text-red-400 dark:border-red-800', dot: 'bg-red-500' };
  }
  if (hours < 72) {
    return { badge: 'bg-orange-500/15 text-orange-600 border-orange-200 dark:text-orange-400 dark:border-orange-800', dot: 'bg-orange-500' };
  }
  if (hours < 7 * 24) {
    return { badge: 'bg-yellow-500/15 text-yellow-700 border-yellow-200 dark:text-yellow-400 dark:border-yellow-800', dot: 'bg-yellow-500' };
  }
  return { badge: 'bg-blue-500/15 text-blue-600 border-blue-200 dark:text-blue-400 dark:border-blue-800', dot: 'bg-blue-500' };
}

function formatTimeRemaining(minutesUntil: number): string {
  const days = Math.floor(minutesUntil / (60 * 24));
  const hours = Math.floor((minutesUntil % (60 * 24)) / 60);
  if (days > 0) {
    return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  }
  return `${hours}h`;
}

export function DeadlinePressureStrip({ events }: DeadlinePressureStripProps) {
  const fourteenDaysMs = 14 * 24 * 60 * 60 * 1000;

  const pressureEvents = useMemo(() => {
    const now = new Date();
    return events
      .filter(e => {
        if (e.priority < 4) return false;
        const eventTime = new Date(e.startsAt).getTime();
        const diff = eventTime - now.getTime();
        return diff > 0 && diff <= fourteenDaysMs;
      })
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  }, [events, fourteenDaysMs]);

  if (pressureEvents.length === 0) return null;

  return (
    <Card className="p-6">
      <div className="flex items-center gap-2 mb-4">
        <CalendarBlank size={18} className="text-muted-foreground" />
        <h3 className="text-lg font-semibold">Deadline Pressure</h3>
        <Badge variant="secondary" className="ml-auto text-xs">
          {pressureEvents.length} upcoming
        </Badge>
      </div>
      <div className="space-y-3">
        {pressureEvents.map(event => {
          const minutesUntil = differenceInMinutes(new Date(event.startsAt), new Date());
          const { badge, dot } = getUrgencyColor(minutesUntil);
          const timeLabel = formatTimeRemaining(minutesUntil);

          return (
            <div key={event.id} className="flex items-center gap-3">
              <div className={`w-2 h-2 rounded-full flex-shrink-0 ${dot}`} />
              <span className="flex-1 text-sm font-medium truncate">{event.title}</span>
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${badge} flex-shrink-0`}>
                {timeLabel}
              </span>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
