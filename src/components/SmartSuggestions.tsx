import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Warning, CalendarBlank, ListChecks } from '@phosphor-icons/react';
import { format } from 'date-fns';
import { getAllTodos } from '@/db/repositories/todosRepo';
import { getTimeBlocksByDate } from '@/db/repositories/timeBlocksRepo';
import { detectDrift } from '@/lib/habitModel';

interface Suggestion {
  icon: React.ReactNode;
  message: string;
  action: string;
  view: string;
}

export interface SmartSuggestionsProps {
  onNavigate: (view: string) => void;
}

export function SmartSuggestions({ onNavigate }: SmartSuggestionsProps) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);

  useEffect(() => {
    async function load() {
      const today = format(new Date(), 'yyyy-MM-dd');
      const now = Date.now();
      const [allTodos, todayBlocks] = await Promise.all([
        getAllTodos(),
        getTimeBlocksByDate(today),
      ]);

      const results: Suggestion[] = [];

      // Overdue todos
      const overdue = allTodos.filter(
        t => t.status !== 'done' && t.dueAt && new Date(t.dueAt).getTime() < now
      );
      if (overdue.length > 0) {
        results.push({
          icon: <Warning size={16} weight="fill" className="text-red-500 flex-shrink-0 mt-0.5" />,
          message: `${overdue.length} overdue todo${overdue.length !== 1 ? 's' : ''} need${overdue.length === 1 ? 's' : ''} attention`,
          action: 'View todos',
          view: 'todos',
        });
      }

      // Unscheduled today todos
      const scheduledTodoIds = new Set(todayBlocks.map(b => b.todoId).filter(Boolean) as string[]);
      const todayTodos = allTodos.filter(t => t.status === 'today');
      const unscheduled = todayTodos.filter(t => !scheduledTodoIds.has(t.id));
      if (unscheduled.length > 0) {
        results.push({
          icon: <ListChecks size={16} weight="bold" className="text-orange-500 flex-shrink-0 mt-0.5" />,
          message: `${unscheduled.length} today todo${unscheduled.length !== 1 ? 's' : ''} not yet on your timeline`,
          action: 'Open timeline',
          view: 'timeline',
        });
      }

      // No blocks scheduled today
      if (todayBlocks.length === 0) {
        results.push({
          icon: <CalendarBlank size={16} weight="bold" className="text-blue-500 flex-shrink-0 mt-0.5" />,
          message: 'No time blocks scheduled — plan your day',
          action: 'Plan day',
          view: 'timeline',
        });
      }

      const driftSignals = await detectDrift();
      driftSignals.forEach((signal) => {
        results.push({
          icon: <Warning size={16} weight="fill" className="text-purple-500 flex-shrink-0 mt-0.5" />,
          message: signal,
          action: 'Open Routine',
          view: 'routine',
        });
      });

      setSuggestions(results);
    }
    load();
  }, []);

  if (suggestions.length === 0) return null;

  return (
    <Card className="p-6">
      <h3 className="text-lg font-semibold mb-4">Suggestions</h3>
      <div className="space-y-3">
        {suggestions.map((s, i) => (
          <div key={i} className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-2 text-sm text-muted-foreground">
              {s.icon}
              <span>{s.message}</span>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="flex-shrink-0 text-xs h-7"
              onClick={() => onNavigate(s.view)}
            >
              {s.action}
            </Button>
          </div>
        ))}
      </div>
    </Card>
  );
}
