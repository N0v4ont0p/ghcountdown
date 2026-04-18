import { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Target, Plus, Trophy, Archive } from '@phosphor-icons/react';
import { Goal } from '@/db/schema';
import {
  getAllGoals,
  createGoal,
  updateGoal,
} from '@/db/repositories/goalsRepo';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';

const MAX_ACTIVE_GOALS = 5;

const GOAL_COLORS = [
  'oklch(0.60 0.19 250)',
  'oklch(0.65 0.20 150)',
  'oklch(0.70 0.22 50)',
  'oklch(0.65 0.20 350)',
  'oklch(0.60 0.18 200)',
  'oklch(0.68 0.19 100)',
];

const emptyForm = {
  title: '',
  why: '',
  targetDate: '',
  color: GOAL_COLORS[0],
};

export function GoalsSettingsCard() {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState(emptyForm);

  useEffect(() => {
    loadGoals();
  }, []);

  async function loadGoals() {
    const all = await getAllGoals();
    all.sort((a, b) => {
      const order: Record<Goal['status'], number> = { active: 0, achieved: 1, abandoned: 2 };
      return order[a.status] - order[b.status] || a.createdAt.localeCompare(b.createdAt);
    });
    setGoals(all);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!formData.title.trim()) {
      toast.error('Please enter a goal title');
      return;
    }

    const activeCount = goals.filter((g) => g.status === 'active').length;
    if (activeCount >= MAX_ACTIVE_GOALS) {
      toast.error(
        `You already have ${MAX_ACTIVE_GOALS} active goals. Archive or achieve one before adding a new one.`
      );
      return;
    }

    try {
      await createGoal({
        title: formData.title.trim(),
        why: formData.why.trim(),
        targetDate: formData.targetDate || null,
        status: 'active',
        color: formData.color,
      });
      toast.success('Goal created');
      setFormData(emptyForm);
      setShowForm(false);
      await loadGoals();
    } catch {
      toast.error('Failed to create goal');
    }
  }

  async function handleAchieve(goal: Goal) {
    await updateGoal(goal.id, { status: 'achieved' });
    toast.success(`"${goal.title}" marked as achieved 🎉`);
    await loadGoals();
  }

  async function handleArchive(goal: Goal) {
    await updateGoal(goal.id, { status: 'abandoned' });
    toast.success(`"${goal.title}" archived`);
    await loadGoals();
  }

  const activeGoals = goals.filter((g) => g.status === 'active');
  const archivedGoals = goals.filter((g) => g.status !== 'active');

  return (
    <Card className="p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-semibold flex items-center gap-2">
            <Target size={18} />
            Goals
          </h3>
          <p className="text-sm text-muted-foreground mt-0.5">
            What you're working toward — max {MAX_ACTIVE_GOALS} active at a time
          </p>
        </div>
        {!showForm && (
          <Button
            size="sm"
            variant="outline"
            className="gap-2"
            onClick={() => setShowForm(true)}
          >
            <Plus size={14} weight="bold" />
            Add Goal
          </Button>
        )}
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="space-y-3 mb-5 p-4 rounded-lg border bg-muted/30">
          <div>
            <Label htmlFor="goal-title">Title</Label>
            <Input
              id="goal-title"
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              placeholder="Launch side project, Get fit, Learn Spanish..."
              autoFocus
            />
          </div>
          <div>
            <Label htmlFor="goal-why">Why this matters</Label>
            <Input
              id="goal-why"
              value={formData.why}
              onChange={(e) => setFormData({ ...formData, why: e.target.value })}
              placeholder="Because..."
            />
          </div>
          <div>
            <Label htmlFor="goal-target">Target date (optional)</Label>
            <Input
              id="goal-target"
              type="date"
              value={formData.targetDate}
              onChange={(e) => setFormData({ ...formData, targetDate: e.target.value })}
            />
          </div>
          <div>
            <Label>Color</Label>
            <div className="flex gap-2 mt-1.5">
              {GOAL_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  onClick={() => setFormData({ ...formData, color })}
                  className={cn(
                    'w-8 h-8 rounded-full border-2 transition-all',
                    formData.color === color ? 'border-foreground scale-110' : 'border-transparent'
                  )}
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setShowForm(false);
                setFormData(emptyForm);
              }}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm">
              Create Goal
            </Button>
          </div>
        </form>
      )}

      {/* Active goals */}
      {activeGoals.length === 0 && !showForm ? (
        <p className="text-sm text-muted-foreground text-center py-6">
          No active goals yet. Add one to get started.
        </p>
      ) : (
        <div className="space-y-3">
          {activeGoals.map((goal) => (
            <GoalRow
              key={goal.id}
              goal={goal}
              onAchieve={handleAchieve}
              onArchive={handleArchive}
            />
          ))}
        </div>
      )}

      {/* Archived / achieved goals */}
      {archivedGoals.length > 0 && (
        <div className="mt-5 pt-4 border-t">
          <p className="text-xs font-medium text-muted-foreground mb-3">Past Goals</p>
          <div className="space-y-2">
            {archivedGoals.map((goal) => (
              <GoalRow key={goal.id} goal={goal} archived />
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

function GoalRow({
  goal,
  archived = false,
  onAchieve,
  onArchive,
}: {
  goal: Goal;
  archived?: boolean;
  onAchieve?: (g: Goal) => void;
  onArchive?: (g: Goal) => void;
}) {
  return (
    <div
      className={cn(
        'flex items-start gap-3 p-3 rounded-lg border',
        archived && 'opacity-60'
      )}
    >
      <div
        className="w-2.5 h-2.5 rounded-full flex-shrink-0 mt-1.5"
        style={{ backgroundColor: goal.color }}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-sm">{goal.title}</span>
          {goal.status === 'achieved' && (
            <Badge variant="outline" className="h-4 text-xs text-green-600 border-green-600">
              Achieved
            </Badge>
          )}
          {goal.status === 'abandoned' && (
            <Badge variant="outline" className="h-4 text-xs text-muted-foreground">
              Archived
            </Badge>
          )}
        </div>
        {goal.why && (
          <p className="text-xs text-muted-foreground italic mt-0.5 leading-snug">{goal.why}</p>
        )}
        {goal.targetDate && (
          <p className="text-xs text-muted-foreground mt-0.5">
            Target: {format(new Date(goal.targetDate), 'MMM d, yyyy')}
          </p>
        )}
      </div>
      {!archived && (
        <div className="flex gap-1 flex-shrink-0">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs text-green-600 hover:text-green-700 hover:bg-green-500/10"
            onClick={() => onAchieve?.(goal)}
            title="Mark as achieved"
          >
            <Trophy size={13} className="mr-1" />
            Achieved
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
            onClick={() => onArchive?.(goal)}
            title="Archive goal"
          >
            <Archive size={13} className="mr-1" />
            Archive
          </Button>
        </div>
      )}
    </div>
  );
}
