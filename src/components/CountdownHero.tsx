import { useEffect, useState } from 'react';
import { Event } from '@/db/schema';
import { Badge } from '@/components/ui/badge';
import { Calendar, Tag } from '@phosphor-icons/react';
import { format } from 'date-fns';

interface CountdownHeroProps {
  event: Event | null;
}

interface TimeLeft {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

function calculateTimeLeft(targetDate: string): TimeLeft | null {
  const difference = new Date(targetDate).getTime() - new Date().getTime();
  
  if (difference <= 0) {
    return null;
  }

  return {
    days: Math.floor(difference / (1000 * 60 * 60 * 24)),
    hours: Math.floor((difference / (1000 * 60 * 60)) % 24),
    minutes: Math.floor((difference / 1000 / 60) % 60),
    seconds: Math.floor((difference / 1000) % 60),
  };
}

function AnimatedDigit({ value }: { value: number }) {
  return (
    <span className="inline-block tabular-nums transition-all duration-300">
      {String(value).padStart(2, '0')}
    </span>
  );
}

export function CountdownHero({ event }: CountdownHeroProps) {
  const [timeLeft, setTimeLeft] = useState<TimeLeft | null>(
    event ? calculateTimeLeft(event.startsAt) : null
  );

  useEffect(() => {
    if (!event) return;

    const timer = setInterval(() => {
      const newTimeLeft = calculateTimeLeft(event.startsAt);
      setTimeLeft(newTimeLeft);
    }, 1000);

    return () => clearInterval(timer);
  }, [event]);

  if (!event) {
    return (
      <div className="glass-card rounded-3xl p-12 text-center">
        <Calendar weight="thin" size={64} className="mx-auto mb-4 text-muted-foreground" />
        <h2 className="text-2xl font-semibold mb-2">No Upcoming Events</h2>
        <p className="text-muted-foreground">
          Add your first important event to see the countdown
        </p>
      </div>
    );
  }

  if (!timeLeft) {
    return (
      <div className="glass-card rounded-3xl p-12">
        <div className="text-center mb-6">
          <Badge variant="secondary" className="mb-4">Completed</Badge>
          <h2 className="text-3xl font-semibold mb-2">{event.title}</h2>
          <p className="text-muted-foreground">
            {format(new Date(event.startsAt), 'MMMM d, yyyy • h:mm a')}
          </p>
        </div>
      </div>
    );
  }

  const priorityColors = {
    5: 'from-red-500 to-orange-500',
    4: 'from-orange-500 to-yellow-500',
    3: 'from-blue-500 to-cyan-500',
    2: 'from-green-500 to-emerald-500',
    1: 'from-gray-400 to-gray-500',
  };

  return (
    <div className="glass-card rounded-3xl p-12 relative overflow-hidden">
      <div
        className={`absolute top-0 left-0 right-0 h-1 bg-gradient-to-r ${priorityColors[event.priority]}`}
      />
      
      <div className="text-center mb-8">
        <div className="flex items-center justify-center gap-2 mb-4">
          <Badge variant="outline">Priority {event.priority}</Badge>
          {event.tags.length > 0 && (
            <div className="flex items-center gap-1">
              {event.tags.map((tag) => (
                <Badge key={tag} variant="secondary" className="gap-1">
                  <Tag size={12} weight="fill" />
                  {tag}
                </Badge>
              ))}
            </div>
          )}
        </div>
        <h1 className="text-4xl md:text-5xl font-semibold mb-4 tracking-tight">
          {event.title}
        </h1>
        <p className="text-muted-foreground text-lg">
          {format(new Date(event.startsAt), 'EEEE, MMMM d, yyyy • h:mm a')}
        </p>
      </div>

      <div className="grid grid-cols-4 gap-4 md:gap-8">
        {[
          { label: 'Days', value: timeLeft.days },
          { label: 'Hours', value: timeLeft.hours },
          { label: 'Minutes', value: timeLeft.minutes },
          { label: 'Seconds', value: timeLeft.seconds },
        ].map(({ label, value }) => (
          <div key={label} className="text-center">
            <div className="text-5xl md:text-7xl font-semibold text-primary mb-2 tracking-tighter">
              <AnimatedDigit value={value} />
            </div>
            <div className="text-sm md:text-base text-muted-foreground uppercase tracking-wide">
              {label}
            </div>
          </div>
        ))}
      </div>

      {event.notes && (
        <div className="mt-8 p-4 bg-muted/50 rounded-xl">
          <p className="text-sm text-muted-foreground">{event.notes}</p>
        </div>
      )}
    </div>
  );
}