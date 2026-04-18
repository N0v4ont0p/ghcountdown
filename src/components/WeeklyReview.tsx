import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowUp, ArrowDown, Minus, TrendUp } from '@phosphor-icons/react';
import { getWeeklySnapshots, computeTrend, WeeklySnapshot, TrendResult } from '@/lib/growthMetrics';
import { format, parseISO } from 'date-fns';

interface WeeklyReviewProps {
  onClose?: () => void;
}

export function WeeklyReview({ onClose }: WeeklyReviewProps) {
  const [snapshots, setSnapshots] = useState<WeeklySnapshot[]>([]);
  const [completionTrend, setCompletionTrend] = useState<TrendResult | null>(null);
  const [focusTrend, setFocusTrend] = useState<TrendResult | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setIsLoading(true);
      try {
        const data = await getWeeklySnapshots(8);
        setSnapshots(data);
        setCompletionTrend(computeTrend(data.map((s) => s.todosCompleted)));
        setFocusTrend(computeTrend(data.map((s) => s.minutesTracked)));
      } finally {
        setIsLoading(false);
      }
    }
    void load();
  }, []);

  function TrendIcon({ trend }: { trend: TrendResult }) {
    if (trend.direction === 'up') return <ArrowUp className="text-green-500" size={16} weight="bold" />;
    if (trend.direction === 'down') return <ArrowDown className="text-red-500" size={16} weight="bold" />;
    return <Minus className="text-muted-foreground" size={16} />;
  }

  const lastWeek = snapshots[snapshots.length - 1];
  const prevWeek = snapshots[snapshots.length - 2];

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-4"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <TrendUp size={20} className="text-primary" />
          <h2 className="text-xl font-semibold">Weekly Review</h2>
        </div>
        {onClose && (
          <Button variant="ghost" size="sm" onClick={onClose}>
            Done
          </Button>
        )}
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <>
          {/* Last week summary */}
          {lastWeek && (
            <Card className="p-4">
              <h3 className="font-medium mb-3 text-sm text-muted-foreground">
                Last week ({format(parseISO(lastWeek.weekStart), 'MMM d')})
              </h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-2xl font-bold">{lastWeek.todosCompleted}</p>
                  <p className="text-xs text-muted-foreground">todos completed</p>
                  {prevWeek && (
                    <p className="text-xs text-muted-foreground mt-1">
                      vs {prevWeek.todosCompleted} prev week
                    </p>
                  )}
                </div>
                <div>
                  <p className="text-2xl font-bold">
                    {Math.round(lastWeek.minutesTracked / 60)}h
                  </p>
                  <p className="text-xs text-muted-foreground">focus time tracked</p>
                  {prevWeek && (
                    <p className="text-xs text-muted-foreground mt-1">
                      vs {Math.round(prevWeek.minutesTracked / 60)}h prev week
                    </p>
                  )}
                </div>
              </div>
            </Card>
          )}

          {/* Trend indicators */}
          {(completionTrend || focusTrend) && (
            <Card className="p-4">
              <h3 className="font-medium mb-3 text-sm">8-Week Trends</h3>
              <div className="space-y-2">
                {completionTrend && (
                  <div className="flex items-center justify-between">
                    <span className="text-sm">Task completion</span>
                    <div className="flex items-center gap-1.5">
                      <TrendIcon trend={completionTrend} />
                      <span className="text-sm font-medium">
                        {completionTrend.percentChange > 0 ? '+' : ''}
                        {completionTrend.percentChange}%
                      </span>
                    </div>
                  </div>
                )}
                {focusTrend && (
                  <div className="flex items-center justify-between">
                    <span className="text-sm">Focus time</span>
                    <div className="flex items-center gap-1.5">
                      <TrendIcon trend={focusTrend} />
                      <span className="text-sm font-medium">
                        {focusTrend.percentChange > 0 ? '+' : ''}
                        {focusTrend.percentChange}%
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </Card>
          )}

          {/* 8-week bar chart (simple) */}
          <Card className="p-4">
            <h3 className="font-medium mb-3 text-sm">Completed todos per week</h3>
            <div className="flex items-end gap-1 h-16">
              {snapshots.map((s, i) => {
                const max = Math.max(...snapshots.map((x) => x.todosCompleted), 1);
                const heightPct = (s.todosCompleted / max) * 100;
                const isLast = i === snapshots.length - 1;
                return (
                  <div key={s.weekStart} className="flex-1 flex flex-col items-center gap-1">
                    <div
                      className={`w-full rounded-sm transition-all ${isLast ? 'bg-primary' : 'bg-primary/30'}`}
                      style={{ height: `${Math.max(heightPct, 4)}%` }}
                      title={`${format(parseISO(s.weekStart), 'MMM d')}: ${s.todosCompleted} todos`}
                    />
                  </div>
                );
              })}
            </div>
            <div className="flex justify-between mt-1">
              <span className="text-[10px] text-muted-foreground">
                {snapshots[0] ? format(parseISO(snapshots[0].weekStart), 'MMM d') : ''}
              </span>
              <span className="text-[10px] text-muted-foreground">This week</span>
            </div>
          </Card>
        </>
      )}
    </motion.div>
  );
}
