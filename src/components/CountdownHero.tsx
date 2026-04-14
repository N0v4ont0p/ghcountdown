import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Event } from '@/db/schema';
import { Badge } from '@/components/ui/badge';
import { Calendar, Tag, Clock } from '@phosphor-icons/react';
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
  const digits = String(value).padStart(2, '0');
  
  return (
    <div className="inline-flex relative overflow-hidden">
      <AnimatePresence mode="popLayout">
        <motion.span
          key={value}
          initial={{ y: 20, opacity: 0, filter: 'blur(4px)' }}
          animate={{ y: 0, opacity: 1, filter: 'blur(0px)' }}
          exit={{ y: -20, opacity: 0, filter: 'blur(4px)' }}
          transition={{ 
            type: 'spring',
            damping: 20,
            stiffness: 300,
          }}
          className="inline-block tabular-nums font-bold"
        >
          {digits}
        </motion.span>
      </AnimatePresence>
    </div>
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
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass-card rounded-3xl p-12 text-center"
      >
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', damping: 15, stiffness: 200, delay: 0.1 }}
        >
          <Calendar weight="thin" size={64} className="mx-auto mb-4 text-muted-foreground" />
        </motion.div>
        <motion.h2
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="text-2xl font-semibold mb-2"
        >
          No Upcoming Events
        </motion.h2>
        <motion.p
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="text-muted-foreground"
        >
          Add your first important event to see the countdown
        </motion.p>
      </motion.div>
    );
  }

  if (!timeLeft) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass-card rounded-3xl p-12"
      >
        <div className="text-center mb-6">
          <Badge variant="secondary" className="mb-4">Completed</Badge>
          <h2 className="text-3xl font-semibold mb-2">{event.title}</h2>
          <p className="text-muted-foreground flex items-center justify-center gap-2">
            <Clock size={16} />
            {format(new Date(event.startsAt), 'MMMM d, yyyy • h:mm a')}
          </p>
        </div>
      </motion.div>
    );
  }

  const priorityColors = {
    5: 'from-[var(--priority-5)] to-[var(--priority-5)]',
    4: 'from-[var(--priority-4)] to-[var(--priority-4)]',
    3: 'from-[var(--priority-3)] to-[var(--priority-3)]',
    2: 'from-[var(--priority-2)] to-[var(--priority-2)]',
    1: 'from-[var(--priority-1)] to-[var(--priority-1)]',
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-card rounded-3xl p-8 md:p-12 relative overflow-hidden"
    >
      <motion.div
        initial={{ scaleX: 0 }}
        animate={{ scaleX: 1 }}
        transition={{ type: 'spring', damping: 20, stiffness: 200, delay: 0.2 }}
        className={`absolute top-0 left-0 right-0 h-1 bg-gradient-to-r ${priorityColors[event.priority]} origin-left`}
      />
      
      <div className="text-center mb-8">
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="flex items-center justify-center gap-2 mb-4 flex-wrap"
        >
          <Badge variant="outline" className="text-xs">Priority {event.priority}</Badge>
          {event.tags.length > 0 && (
            <div className="flex items-center gap-1 flex-wrap">
              {event.tags.map((tag, i) => (
                <motion.div
                  key={tag}
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: 0.2 + i * 0.05 }}
                >
                  <Badge variant="secondary" className="gap-1 text-xs">
                    <Tag size={12} weight="fill" />
                    {tag}
                  </Badge>
                </motion.div>
              ))}
            </div>
          )}
        </motion.div>
        <motion.h1
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="text-3xl md:text-5xl font-semibold mb-4 tracking-tight"
        >
          {event.title}
        </motion.h1>
        <motion.p
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="text-muted-foreground text-sm md:text-lg flex items-center justify-center gap-2"
        >
          <Clock size={18} className="hidden md:inline" />
          {format(new Date(event.startsAt), 'EEEE, MMMM d, yyyy • h:mm a')}
        </motion.p>
      </div>

      <div className="grid grid-cols-4 gap-3 md:gap-8">
        {[
          { label: 'Days', value: timeLeft.days },
          { label: 'Hours', value: timeLeft.hours },
          { label: 'Minutes', value: timeLeft.minutes },
          { label: 'Seconds', value: timeLeft.seconds },
        ].map(({ label, value }, i) => (
          <motion.div
            key={label}
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ 
              type: 'spring',
              damping: 15,
              stiffness: 200,
              delay: 0.3 + i * 0.05,
            }}
            className="text-center"
          >
            <div className="text-4xl md:text-7xl font-bold text-primary mb-1 md:mb-2 tracking-tighter">
              <AnimatedDigit value={value} />
            </div>
            <div className="text-xs md:text-base text-muted-foreground uppercase tracking-wide font-medium">
              {label}
            </div>
          </motion.div>
        ))}
      </div>

      {event.notes && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
          className="mt-8 p-4 bg-muted/30 rounded-xl border border-border/50"
        >
          <p className="text-sm text-muted-foreground leading-relaxed">{event.notes}</p>
        </motion.div>
      )}
    </motion.div>
  );
}