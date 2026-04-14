import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { TimeEntry, Todo } from '@/db/schema';
import { getAllTimeEntries, createTimeEntry, updateTimeEntry, deleteTimeEntry, getRunningTimer } from '@/db/repositories/timeRepo';
import { getAllTodos } from '@/db/repositories/todosRepo';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Play, Stop, Clock, Trash } from '@phosphor-icons/react';
import { format, startOfDay, endOfDay, startOfWeek, endOfWeek, differenceInSeconds } from 'date-fns';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

export function TimeTrackingView() {
  const [timeEntries, setTimeEntries] = useState<TimeEntry[]>([]);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [runningTimer, setRunningTimer] = useState<TimeEntry | null>(null);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [entryToDelete, setEntryToDelete] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    todoId: '',
    note: '',
  });

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    if (runningTimer) {
      interval = setInterval(() => {
        const seconds = Math.floor((Date.now() - new Date(runningTimer.startAt).getTime()) / 1000);
        setElapsedTime(seconds);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [runningTimer]);

  async function loadData() {
    const [allEntries, allTodos, running] = await Promise.all([
      getAllTimeEntries(),
      getAllTodos(),
      getRunningTimer(),
    ]);
    
    setTimeEntries(allEntries.sort((a, b) => b.startAt.localeCompare(a.startAt)));
    setTodos(allTodos.filter(t => t.status !== 'done'));
    setRunningTimer(running);
    
    if (running) {
      const seconds = Math.floor((Date.now() - new Date(running.startAt).getTime()) / 1000);
      setElapsedTime(seconds);
    } else {
      setElapsedTime(0);
    }
  }

  async function handleStart() {
    if (runningTimer) return;

    try {
      await createTimeEntry({
        todoId: formData.todoId || null,
        projectId: null,
        timeBlockId: null,
        startAt: new Date().toISOString(),
        endAt: null,
        note: formData.note,
      });
      
      toast.success('Timer started!');
      setIsDialogOpen(false);
      setFormData({ todoId: '', note: '' });
      loadData();
    } catch (error) {
      toast.error('Failed to start timer');
    }
  }

  async function handleStop() {
    if (!runningTimer) return;

    try {
      await updateTimeEntry(runningTimer.id, {
        endAt: new Date().toISOString(),
      });
      
      toast.success(`Timer stopped! Duration: ${formatDuration(elapsedTime)}`);
      loadData();
    } catch (error) {
      toast.error('Failed to stop timer');
    }
  }

  async function handleDelete(id: string) {
    setEntryToDelete(id);
    setDeleteConfirmOpen(true);
  }

  async function handleDeleteConfirm() {
    if (entryToDelete) {
      await deleteTimeEntry(entryToDelete);
      toast.success('Time entry deleted');
      setEntryToDelete(null);
      loadData();
    }
  }

  function formatDuration(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }

  function getEntryDuration(entry: TimeEntry): number {
    const start = new Date(entry.startAt);
    const end = entry.endAt ? new Date(entry.endAt) : new Date();
    return differenceInSeconds(end, start);
  }

  const today = new Date();
  const todayStart = startOfDay(today).toISOString();
  const todayEnd = endOfDay(today).toISOString();
  const weekStart = startOfWeek(today).toISOString();
  const weekEnd = endOfWeek(today).toISOString();

  const todayEntries = timeEntries.filter(e => e.startAt >= todayStart && e.startAt <= todayEnd);
  const weekEntries = timeEntries.filter(e => e.startAt >= weekStart && e.startAt <= weekEnd);

  const todayTotal = todayEntries
    .filter(e => e.endAt)
    .reduce((acc, e) => acc + getEntryDuration(e), 0);

  const weekTotal = weekEntries
    .filter(e => e.endAt)
    .reduce((acc, e) => acc + getEntryDuration(e), 0);

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-6">
        <h2 className="text-3xl font-semibold mb-2">Time Tracking</h2>
        <p className="text-muted-foreground">Track time spent on tasks and projects</p>
      </div>

      <div className="grid md:grid-cols-3 gap-4 mb-6">
        <Card className="p-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-muted-foreground">Current Session</span>
            <Clock size={16} className="text-muted-foreground" />
          </div>
          <div className="text-3xl font-semibold font-mono tabular-nums">
            {formatDuration(elapsedTime)}
          </div>
        </Card>

        <Card className="p-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-muted-foreground">Today</span>
            <Clock size={16} className="text-muted-foreground" />
          </div>
          <div className="text-3xl font-semibold font-mono tabular-nums">
            {formatDuration(todayTotal + (runningTimer ? elapsedTime : 0))}
          </div>
        </Card>

        <Card className="p-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-muted-foreground">This Week</span>
            <Clock size={16} className="text-muted-foreground" />
          </div>
          <div className="text-3xl font-semibold font-mono tabular-nums">
            {formatDuration(weekTotal + (runningTimer ? elapsedTime : 0))}
          </div>
        </Card>
      </div>

      <Card className="p-6 mb-6">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex-1 w-full">
            {runningTimer ? (
              <div>
                <p className="text-sm text-muted-foreground mb-1">Timer running</p>
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                  <p className="font-medium">
                    {runningTimer.note || 'No description'}
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-muted-foreground">No timer running</p>
            )}
          </div>

          {runningTimer ? (
            <Button onClick={handleStop} variant="destructive" className="gap-2 w-full sm:w-auto">
              <Stop size={16} weight="fill" />
              Stop Timer
            </Button>
          ) : (
            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
              <DialogTrigger asChild>
                <Button className="gap-2 w-full sm:w-auto">
                  <Play size={16} weight="fill" />
                  Start Timer
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Start New Timer</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="todo">Link to Todo (optional)</Label>
                    <Select
                      value={formData.todoId}
                      onValueChange={(val) => setFormData({ ...formData, todoId: val })}
                    >
                      <SelectTrigger id="todo">
                        <SelectValue placeholder="None" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="">None</SelectItem>
                        {todos.map((todo) => (
                          <SelectItem key={todo.id} value={todo.id}>
                            {todo.title}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label htmlFor="note">Description</Label>
                    <Textarea
                      id="note"
                      value={formData.note}
                      onChange={(e) => setFormData({ ...formData, note: e.target.value })}
                      placeholder="What are you working on?"
                      rows={3}
                    />
                  </div>

                  <div className="flex justify-end gap-2 pt-4">
                    <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
                      Cancel
                    </Button>
                    <Button onClick={handleStart}>Start Timer</Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          )}
        </div>
      </Card>

      <div className="space-y-4">
        <h3 className="text-lg font-semibold">Recent Entries</h3>
        
        {timeEntries.length === 0 ? (
          <Card className="p-12 text-center">
            <Clock weight="thin" size={64} className="mx-auto mb-4 text-muted-foreground" />
            <h3 className="text-xl font-semibold mb-2">No Time Entries Yet</h3>
            <p className="text-muted-foreground mb-4">Start tracking your time to see entries here</p>
            <Button onClick={() => setIsDialogOpen(true)} className="gap-2">
              <Play size={16} weight="fill" />
              Start Your First Timer
            </Button>
          </Card>
        ) : (
          <div className="space-y-2">
            <AnimatePresence mode="popLayout">
              {timeEntries.map((entry) => {
                const todo = entry.todoId ? todos.find(t => t.id === entry.todoId) : null;
                const duration = getEntryDuration(entry);
                const isRunning = !entry.endAt;

                return (
                  <motion.div
                    key={entry.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, x: -100 }}
                    transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                  >
                    <Card className={cn(
                      "p-4 hover:shadow-sm transition-all duration-200 group",
                      isRunning && "border-green-500 bg-green-50/5"
                    )}>
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            {isRunning && (
                              <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                            )}
                            <p className="font-medium">
                              {entry.note || 'No description'}
                            </p>
                            {isRunning && (
                              <Badge variant="outline" className="text-xs">Running</Badge>
                            )}
                          </div>
                          
                          <div className="flex items-center gap-3 text-sm text-muted-foreground flex-wrap">
                            <span>{format(new Date(entry.startAt), 'MMM d, h:mm a')}</span>
                            <span>•</span>
                            <span className="font-mono font-semibold">
                              {isRunning ? formatDuration(elapsedTime) : formatDuration(duration)}
                            </span>
                            {todo && (
                              <>
                                <span>•</span>
                                <span className="truncate">{todo.title}</span>
                              </>
                            )}
                          </div>
                        </div>

                        {!isRunning && (
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => handleDelete(entry.id)}
                            className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-all text-destructive hover:text-destructive shrink-0 hover:scale-110 active:scale-95"
                          >
                            <Trash size={16} />
                          </Button>
                        )}
                      </div>
                    </Card>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={deleteConfirmOpen}
        onOpenChange={setDeleteConfirmOpen}
        title="Delete Time Entry?"
        description="Are you sure you want to delete this time entry? This action cannot be undone."
        variant="destructive"
        confirmText="Delete"
        cancelText="Cancel"
        onConfirm={handleDeleteConfirm}
      />
    </div>
  );
}
