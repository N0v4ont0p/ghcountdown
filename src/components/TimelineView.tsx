import { useState, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence, Reorder } from 'framer-motion';
import { TimeBlock, Todo, Event, Project } from '@/db/schema';
import { getAllTimeBlocks, createTimeBlock, updateTimeBlock, deleteTimeBlock, getTimeBlocksByDate } from '@/db/repositories/timeBlocksRepo';
import { getAllTodos, updateTodo } from '@/db/repositories/todosRepo';
import { getAllEvents } from '@/db/repositories/eventsRepo';
import { getAllProjects } from '@/db/repositories/projectsRepo';
import { createTimeEntry, getRunningTimer, updateTimeEntry } from '@/db/repositories/timeRepo';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Plus, Play, Stop, Trash, Pencil, Clock, CalendarBlank, CheckSquare, Lightning, Warning } from '@phosphor-icons/react';
import { format, startOfDay, endOfDay, parse, differenceInMinutes } from 'date-fns';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { scheduleMyDay, PRIORITY_COLORS, withColorAlpha } from '@/lib/scheduleDay';
import { detectBlockConflicts } from '@/lib/conflictDetection';

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const TIMELINE_HOUR_HEIGHT = 80;

export function TimelineView() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [timeBlocks, setTimeBlocks] = useState<TimeBlock[]>([]);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingBlock, setEditingBlock] = useState<TimeBlock | null>(null);
  const [runningTimer, setRunningTimer] = useState<any>(null);
  const [currentTime, setCurrentTime] = useState(new Date());
  const timelineRef = useRef<HTMLDivElement>(null);
  const [dragStart, setDragStart] = useState<{ hour: number; minute: number } | null>(null);
  const [dragOverHour, setDragOverHour] = useState<number | null>(null);
  const [isScheduling, setIsScheduling] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [blockToDelete, setBlockToDelete] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    title: '',
    startTime: '09:00',
    endTime: '10:00',
    todoId: 'none',
    projectId: 'none',
    color: 'oklch(0.60 0.19 250)',
    autoTrack: true,
    slotType: 'fixed' as 'fixed' | 'flex-todo' | 'flex-project',
  });

  useEffect(() => {
    loadData();
    const interval = setInterval(() => {
      setCurrentTime(new Date());
      checkAutoTracking();
    }, 30000);
    return () => clearInterval(interval);
  }, [currentDate]);

  useEffect(() => {
    if (timelineRef.current) {
      const now = new Date();
      const currentHour = now.getHours();
      const scrollTo = Math.max(0, (currentHour - 2) * TIMELINE_HOUR_HEIGHT);
      timelineRef.current.scrollTop = scrollTo;
    }
  }, []);

  async function loadData() {
    const dateStr = format(currentDate, 'yyyy-MM-dd');
    const [blocks, allTodos, allEvents, allProjects, timer] = await Promise.all([
      getTimeBlocksByDate(dateStr),
      getAllTodos(),
      getAllEvents(),
      getAllProjects(),
      getRunningTimer(),
    ]);
    
    setTimeBlocks(blocks.sort((a, b) => a.startTime.localeCompare(b.startTime)));
    setTodos(allTodos.filter(t => t.status !== 'done'));
    setEvents(allEvents);
    setProjects(allProjects);
    setRunningTimer(timer);
  }

  async function checkAutoTracking() {
    const now = new Date();
    const currentTimeStr = format(now, 'HH:mm');
    const dateStr = format(currentDate, 'yyyy-MM-dd');
    
    if (format(now, 'yyyy-MM-dd') !== dateStr) return;

    const blocks = await getTimeBlocksByDate(dateStr);
    const timer = await getRunningTimer();
    
    for (const block of blocks) {
      if (!block.autoTrack) continue;
      
      const isInBlock = currentTimeStr >= block.startTime && currentTimeStr < block.endTime;
      const isTimerForBlock = timer && timer.timeBlockId === block.id;

      if (isInBlock && !isTimerForBlock) {
        if (timer) {
          await updateTimeEntry(timer.id, { endAt: now.toISOString() });
        }
        
        await createTimeEntry({
          todoId: block.todoId,
          projectId: block.projectId,
          timeBlockId: block.id,
          startAt: now.toISOString(),
          endAt: null,
          note: `Auto-tracked: ${block.title}`,
        });
        
        toast.success(`Auto-started timer for "${block.title}"`);
        loadData();
        return;
      }

      if (!isInBlock && isTimerForBlock) {
        await updateTimeEntry(timer.id, { endAt: now.toISOString() });
        toast.success(`Auto-stopped timer for "${block.title}"`);
        loadData();
        return;
      }
    }

    // Auto-fill flex blocks whose start time is within 5 minutes
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const allTodos = await getAllTodos();
    const scheduledIds = new Set(blocks.filter(b => b.todoId).map(b => b.todoId as string));

    for (const block of blocks) {
      const slotType = block.slotType || 'fixed';
      if (slotType === 'fixed' || block.todoId) continue;
      const [bH, bM] = block.startTime.split(':').map(Number);
      const blockStartMinutes = bH * 60 + bM;
      if (Math.abs(nowMinutes - blockStartMinutes) <= 5) {
        await autoFillFlexBlock(block, allTodos, scheduledIds);
      }
    }
  }

  async function autoFillFlexBlock(block: TimeBlock, allTodos: Todo[], scheduledIds: Set<string>) {
    const candidates = allTodos.filter(t => t.status === 'today' && !scheduledIds.has(t.id));
    let pool = candidates;
    if ((block.slotType || 'fixed') === 'flex-project') {
      pool = candidates.filter(t => block.projectId && t.projectId === block.projectId);
    }
    const winner = pool.reduce<Todo | undefined>(
      (best, t) => (best === undefined || t.priority > best.priority ? t : best),
      undefined
    );
    if (winner) {
      await updateTimeBlock(block.id, { title: winner.title, todoId: winner.id });
      toast.success(`Auto-filled flex slot with "${winner.title}"`);
      loadData();
    }
  }

  function resetForm() {
    setFormData({
      title: '',
      startTime: '09:00',
      endTime: '10:00',
      todoId: 'none',
      projectId: 'none',
      color: 'oklch(0.60 0.19 250)',
      autoTrack: true,
      slotType: 'fixed',
    });
    setEditingBlock(null);
  }

  function handleEdit(block: TimeBlock) {
    setEditingBlock(block);
    setFormData({
      title: block.title,
      startTime: block.startTime,
      endTime: block.endTime,
      todoId: block.todoId || 'none',
      projectId: block.projectId || 'none',
      color: block.color,
      autoTrack: block.autoTrack,
      slotType: (block.slotType || 'fixed') as 'fixed' | 'flex-todo' | 'flex-project',
    });
    setIsDialogOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!formData.title || !formData.startTime || !formData.endTime) {
      toast.error('Please fill in all required fields');
      return;
    }

    if (formData.startTime >= formData.endTime) {
      toast.error('End time must be after start time');
      return;
    }

    const dateStr = format(currentDate, 'yyyy-MM-dd');

    // Conflict detection — warn but still allow save
    const previewId = editingBlock?.id || '__preview__';
    const wouldBeBlock: TimeBlock = {
      id: previewId,
      title: formData.title,
      date: dateStr,
      startTime: formData.startTime,
      endTime: formData.endTime,
      todoId: formData.todoId !== 'none' ? formData.todoId : null,
      projectId: formData.projectId !== 'none' ? formData.projectId : null,
      color: formData.color,
      autoTrack: formData.autoTrack,
      slotType: formData.slotType,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const otherBlocks = timeBlocks.filter(b => b.id !== previewId);
    const conflictPairs = detectBlockConflicts([...otherBlocks, wouldBeBlock], dateStr);
    const myConflict = conflictPairs.find(c => c.blockA.id === previewId || c.blockB.id === previewId);
    if (myConflict) {
      const other = myConflict.blockA.id === previewId ? myConflict.blockB : myConflict.blockA;
      toast.warning(`⚠ This overlaps with "${other.title}"`);
    }

    try {
      if (editingBlock) {
        await updateTimeBlock(editingBlock.id, {
          title: formData.title,
          startTime: formData.startTime,
          endTime: formData.endTime,
          todoId: formData.todoId !== 'none' ? formData.todoId : null,
          projectId: formData.projectId !== 'none' ? formData.projectId : null,
          color: formData.color,
          autoTrack: formData.autoTrack,
          slotType: formData.slotType,
        });
        toast.success('Time block updated!');
      } else {
        await createTimeBlock({
          title: formData.title,
          date: dateStr,
          startTime: formData.startTime,
          endTime: formData.endTime,
          todoId: formData.todoId !== 'none' ? formData.todoId : null,
          projectId: formData.projectId !== 'none' ? formData.projectId : null,
          color: formData.color,
          autoTrack: formData.autoTrack,
          slotType: formData.slotType,
        });
        toast.success('Time block created!');
      }
      
      setIsDialogOpen(false);
      resetForm();
      loadData();
    } catch (error) {
      toast.error('Failed to save time block');
    }
  }

  async function handleDelete(id: string) {
    setBlockToDelete(id);
    setDeleteConfirmOpen(true);
  }

  async function handleDeleteConfirm() {
    if (!blockToDelete) return;
    try {
      await deleteTimeBlock(blockToDelete);
      toast.success('Time block deleted');
      await loadData();
    } catch (error) {
      toast.error('Failed to delete time block');
    } finally {
      setBlockToDelete(null);
    }
  }

  async function handleCompleteBlock(block: TimeBlock) {
    if (!block.todoId) return;
    try {
      await updateTodo(block.todoId, { status: 'done' });
      toast.success('Todo marked as done!');
      loadData();
    } catch {
      toast.error('Failed to complete todo');
    }
  }

  async function handleTodoDrop(hour: number, e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOverHour(null);
    const todoId = e.dataTransfer.getData('todoId');
    const todoTitle = e.dataTransfer.getData('todoTitle');
    const todoPriority = parseInt(e.dataTransfer.getData('todoPriority') || '3', 10);

    if (todoId && todoTitle) {
      const dateStr = format(currentDate, 'yyyy-MM-dd');
      const startHour = String(hour).padStart(2, '0');
      const endHour = String(hour + 1).padStart(2, '0');
      const color = PRIORITY_COLORS[todoPriority] ?? PRIORITY_COLORS[3];

      try {
        await createTimeBlock({
          title: todoTitle,
          date: dateStr,
          startTime: `${startHour}:00`,
          endTime: `${endHour}:00`,
          todoId,
          projectId: null,
          color,
          autoTrack: true,
          slotType: 'fixed',
        });
        toast.success(`Scheduled "${todoTitle}"`);
        loadData();
      } catch {
        toast.error('Failed to schedule todo');
      }
    }
  }

  async function handleScheduleMyDay() {
    setIsScheduling(true);
    try {
      const dateStr = format(currentDate, 'yyyy-MM-dd');
      const count = await scheduleMyDay(dateStr, unscheduledTodayTodos, timeBlocks);
      if (count === 0) {
        toast.info('All todos are already scheduled!');
      } else {
        toast.success(`Scheduled ${count} todo${count !== 1 ? 's' : ''} for today`);
        loadData();
      }
    } catch {
      toast.error('Failed to schedule todos');
    } finally {
      setIsScheduling(false);
    }
  }

  async function handleChipKeyDown(e: React.KeyboardEvent, todo: Todo) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault(); // prevent page scroll on Space, form submit on Enter
    const dateStr = format(currentDate, 'yyyy-MM-dd');
    try {
      const count = await scheduleMyDay(dateStr, [todo], timeBlocks);
      if (count > 0) {
        toast.success(`Scheduled "${todo.title}"`);
        loadData();
      } else {
        toast.error('No available time slots for this todo');
      }
    } catch {
      toast.error('Failed to schedule todo');
    }
  }

  async function handleManualTimer(block: TimeBlock) {
    if (runningTimer) {
      await updateTimeEntry(runningTimer.id, { endAt: new Date().toISOString() });
      toast.success('Timer stopped');
    } else {
      await createTimeEntry({
        todoId: block.todoId,
        projectId: block.projectId,
        timeBlockId: block.id,
        startAt: new Date().toISOString(),
        endAt: null,
        note: block.title,
      });
      toast.success(`Timer started for "${block.title}"`);
    }
    loadData();
  }

  function getBlockStyle(block: TimeBlock) {
    const [startHour, startMin] = block.startTime.split(':').map(Number);
    const [endHour, endMin] = block.endTime.split(':').map(Number);
    
    const startMinutes = startHour * 60 + startMin;
    const endMinutes = endHour * 60 + endMin;
    const duration = endMinutes - startMinutes;
    
    const top = (startMinutes / 60) * TIMELINE_HOUR_HEIGHT;
    const height = (duration / 60) * TIMELINE_HOUR_HEIGHT;
    
    return { top, height };
  }

  function getCurrentTimePosition() {
    const hours = currentTime.getHours();
    const minutes = currentTime.getMinutes();
    const totalMinutes = hours * 60 + minutes;
    return (totalMinutes / 60) * TIMELINE_HOUR_HEIGHT;
  }

  const todayEvents = events.filter(e => {
    const eventDate = new Date(e.startsAt);
    return format(eventDate, 'yyyy-MM-dd') === format(currentDate, 'yyyy-MM-dd');
  });

  const isToday = format(currentDate, 'yyyy-MM-dd') === format(new Date(), 'yyyy-MM-dd');

  const scheduledTodoIds = new Set(timeBlocks.map(b => b.todoId).filter(Boolean) as string[]);
  const todayTodos = todos.filter(t => t.status === 'today');
  const unscheduledTodayTodos = todayTodos.filter(t => !scheduledTodoIds.has(t.id));

  const conflictingBlockIds = useMemo(() => {
    const dateStr = format(currentDate, 'yyyy-MM-dd');
    const pairs = detectBlockConflicts(timeBlocks, dateStr);
    const ids = new Set<string>();
    pairs.forEach(({ blockA, blockB }) => {
      ids.add(blockA.id);
      ids.add(blockB.id);
    });
    return ids;
  }, [timeBlocks, currentDate]);

  return (
    <div className="max-w-7xl mx-auto h-[calc(100vh-6rem)]">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-semibold mb-2">Timeline</h2>
          <p className="text-muted-foreground">Plan your day with time blocks and auto-tracking</p>
        </div>

        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            onClick={() => {
              const newDate = new Date(currentDate);
              newDate.setDate(newDate.getDate() - 1);
              setCurrentDate(newDate);
            }}
            className="hover:scale-105 active:scale-95 transition-transform"
          >
            Previous
          </Button>
          
          <div className="px-4 py-2 bg-card border rounded-lg">
            <p className="font-semibold">{format(currentDate, 'EEEE, MMM d')}</p>
          </div>

          <Button
            variant="outline"
            onClick={() => {
              const newDate = new Date(currentDate);
              newDate.setDate(newDate.getDate() + 1);
              setCurrentDate(newDate);
            }}
            className="hover:scale-105 active:scale-95 transition-transform"
          >
            Next
          </Button>

          {!isToday && (
            <Button
              variant="ghost"
              onClick={() => setCurrentDate(new Date())}
              className="hover:scale-105 active:scale-95 transition-transform"
            >
              Today
            </Button>
          )}

          <Button onClick={() => setIsDialogOpen(true)} className="gap-2">
            <Plus size={16} weight="bold" />
            Add Block
          </Button>

          {unscheduledTodayTodos.length > 0 && (
            <Button
              variant="secondary"
              onClick={handleScheduleMyDay}
              disabled={isScheduling}
              className="gap-2 hover:scale-105 active:scale-95 transition-transform"
            >
              <Lightning size={16} weight="bold" />
              {isScheduling ? 'Scheduling…' : 'Schedule My Day'}
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-[1fr_300px] gap-6 h-[calc(100%-5rem)]">
        <Card className="relative overflow-hidden">
          <div
            ref={timelineRef}
            className="h-full overflow-y-auto overflow-x-hidden relative"
            style={{ scrollBehavior: 'smooth' }}
          >
            <div className="relative" style={{ height: HOURS.length * TIMELINE_HOUR_HEIGHT }}>
              {HOURS.map((hour) => (
                <div
                  key={hour}
                  className={cn(
                    "absolute left-0 right-0 border-t border-border transition-colors",
                    dragOverHour === hour && "bg-primary/5"
                  )}
                  style={{ top: hour * TIMELINE_HOUR_HEIGHT, height: TIMELINE_HOUR_HEIGHT }}
                  onDragOver={(e) => { e.preventDefault(); setDragOverHour(hour); }}
                  onDragLeave={() => setDragOverHour(null)}
                  onDrop={(e) => handleTodoDrop(hour, e)}
                >
                  <div className="flex items-start gap-4 px-4 py-2">
                    <div className="w-20 text-sm text-muted-foreground font-medium z-20 bg-background/80 backdrop-blur-sm rounded px-2 py-0.5">
                      {format(new Date().setHours(hour, 0, 0, 0), 'h:mm a')}
                    </div>
                    <div className={cn(
                      "flex-1 h-full border-l border-border/50 relative",
                      dragOverHour === hour && "border-primary/50"
                    )}></div>
                  </div>
                </div>
              ))}

              {isToday && (
                <motion.div
                  className="absolute left-24 right-4 z-30 pointer-events-none"
                  style={{ top: getCurrentTimePosition() }}
                  animate={{ top: getCurrentTimePosition() }}
                  transition={{ type: 'tween', duration: 0.5 }}
                >
                  <div className="flex items-center relative">
                    <div className="absolute -left-1.5 w-4 h-4 rounded-full bg-red-500 shadow-lg shadow-red-500/50 border-2 border-background"></div>
                    <div className="flex-1 h-0.5 bg-red-500/80 shadow-sm"></div>
                  </div>
                </motion.div>
              )}

              <div className="absolute left-20 right-4 top-0 bottom-0">
                <AnimatePresence>
                  {timeBlocks.map((block) => {
                    const style = getBlockStyle(block);
                    const isRunning = runningTimer?.timeBlockId === block.id;
                    const todo = block.todoId ? todos.find(t => t.id === block.todoId) : null;
                    const project = block.projectId ? projects.find(p => p.id === block.projectId) : null;
                    const isFlex = (block.slotType || 'fixed') !== 'fixed';
                    const isConflicting = conflictingBlockIds.has(block.id);

                    return (
                      <motion.div
                        key={block.id}
                        className={cn(
                          "absolute left-2 right-2 rounded-xl p-3 cursor-pointer group shadow-md",
                          "hover:shadow-lg transition-all duration-200 border-2",
                          isRunning && "ring-2 ring-primary ring-offset-2 ring-offset-background",
                          isConflicting && "ring-2 ring-red-500 ring-offset-2 ring-offset-background"
                        )}
                        style={{
                          top: style.top,
                          height: style.height,
                          backgroundColor: block.color + '20',
                          borderColor: block.color,
                          borderStyle: isFlex ? 'dashed' : 'solid',
                        }}
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                        onClick={() => handleEdit(block)}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <h4 className="font-semibold text-sm truncate" style={{ color: block.color }}>
                                {isFlex ? (
                                  <><span aria-hidden="true">⚡</span> Flex slot</>
                                ) : block.title}
                              </h4>
                              {isConflicting && (
                                <Warning size={12} className="text-red-500 shrink-0" weight="fill" />
                              )}
                              {block.autoTrack && (
                                <Badge variant="outline" className="h-4 text-[10px] px-1">Auto</Badge>
                              )}
                            </div>
                            {isFlex && (
                              <p className="text-xs truncate text-foreground/70 mb-0.5">
                                {todo ? todo.title : block.title}
                              </p>
                            )}
                            <p className="text-xs text-muted-foreground">
                              {block.startTime} - {block.endTime}
                            </p>
                            {!isFlex && todo && (
                              <p className="text-xs mt-1 truncate text-foreground/70">{todo.title}</p>
                            )}
                            {project && (
                              <Badge variant="secondary" className="mt-1 h-4 text-[10px]">
                                {project.name}
                              </Badge>
                            )}
                          </div>

                          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {block.todoId && (
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={() => handleCompleteBlock(block)}
                                className="h-6 w-6 text-green-600 hover:scale-110 active:scale-95 transition-transform"
                                title="Mark todo as done"
                              >
                                <CheckSquare size={12} />
                              </Button>
                            )}
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => handleManualTimer(block)}
                              className="h-6 w-6 hover:scale-110 active:scale-95 transition-transform"
                            >
                              {isRunning ? <Stop size={12} /> : <Play size={12} />}
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => handleDelete(block.id)}
                              className="h-6 w-6 text-destructive hover:scale-110 active:scale-95 transition-transform"
                            >
                              <Trash size={12} />
                            </Button>
                          </div>
                        </div>
                      </motion.div>
                    );
                  })}
                </AnimatePresence>

                {todayEvents.map((event) => {
                  const eventDate = new Date(event.startsAt);
                  const hour = eventDate.getHours();
                  const minute = eventDate.getMinutes();
                  const top = (hour * 60 + minute) / 60 * TIMELINE_HOUR_HEIGHT;

                  return (
                    <motion.div
                      key={event.id}
                      className="absolute left-2 right-2 rounded-lg p-2 border-l-4 bg-accent/10"
                      style={{
                        top,
                        borderLeftColor: `var(--priority-${event.priority})`,
                      }}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                    >
                      <div className="flex items-center gap-2">
                        <CalendarBlank size={14} weight="fill" className="text-muted-foreground" />
                        <p className="text-xs font-medium">{event.title}</p>
                        <p className="text-xs text-muted-foreground">{format(eventDate, 'h:mm a')}</p>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            </div>
          </div>
        </Card>

        <div className="space-y-4 overflow-y-auto">
          <Card className="p-4">
            <h3 className="font-semibold mb-3 flex items-center gap-2">
              <Clock size={18} />
              Quick Stats
            </h3>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Time blocks:</span>
                <span className="font-semibold">{timeBlocks.length}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Auto-tracking:</span>
                <span className="font-semibold">{timeBlocks.filter(b => b.autoTrack).length}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Events today:</span>
                <span className="font-semibold">{todayEvents.length}</span>
              </div>
            </div>
          </Card>

          {runningTimer && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <Card className="p-4 border-primary bg-primary/5">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
                  <h3 className="font-semibold text-sm">Timer Running</h3>
                </div>
                <p className="text-xs text-muted-foreground">{runningTimer.note}</p>
              </Card>
            </motion.div>
          )}

          <Card className="p-4">
            <h3 className="font-semibold mb-1">Today's Todos</h3>
            {todayTodos.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">No todos for today</p>
            ) : unscheduledTodayTodos.length === 0 ? (
              <p className="text-sm text-green-500 text-center py-3 font-medium">All tasks scheduled ✓</p>
            ) : (
              <>
                <p className="text-xs text-muted-foreground mb-3">Drag to schedule →</p>
                <div className="space-y-2">
                  {unscheduledTodayTodos.map((todo, index) => (
                    <motion.div
                      key={todo.id}
                      draggable={true}
                      tabIndex={0}
                      role="button"
                      aria-label={`${todo.title}, Priority ${todo.priority}. Press Enter to schedule.`}
                      onDragStart={(e) => {
                        e.dataTransfer.setData('todoId', todo.id);
                        e.dataTransfer.setData('todoTitle', todo.title);
                        e.dataTransfer.setData('todoPriority', String(todo.priority));
                        e.dataTransfer.effectAllowed = 'copy';
                      }}
                      onKeyDown={(e) => handleChipKeyDown(e, todo)}
                      className="flex items-center gap-2 rounded-lg px-3 py-2 cursor-grab active:cursor-grabbing border border-border/50 select-none focus:outline-none focus:ring-2 focus:ring-primary"
                      style={{
                        backgroundColor: withColorAlpha(PRIORITY_COLORS[todo.priority] ?? PRIORITY_COLORS[3], 0.2),
                      }}
                      initial={{ opacity: 0, x: 20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: index * 0.05 }}
                    >
                      <Badge
                        variant="outline"
                        className="text-[10px] px-1 h-4 shrink-0"
                        aria-label={`Priority ${todo.priority}`}
                      >
                        P{todo.priority}
                      </Badge>
                      <span className="text-sm truncate flex-1">{todo.title}</span>
                    </motion.div>
                  ))}
                </div>
              </>
            )}
          </Card>
        </div>
      </div>

      <Dialog open={isDialogOpen} onOpenChange={(open) => {
        setIsDialogOpen(open);
        if (!open) resetForm();
      }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingBlock ? 'Edit Time Block' : 'Create Time Block'}</DialogTitle>
          </DialogHeader>
          
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label htmlFor="blockType">Block type</Label>
              <Select
                value={formData.slotType}
                onValueChange={(val) => setFormData({ ...formData, slotType: val as 'fixed' | 'flex-todo' | 'flex-project' })}
              >
                <SelectTrigger id="blockType">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="fixed">Fixed task</SelectItem>
                  <SelectItem value="flex-todo">Flex: auto-fill with top todo</SelectItem>
                  <SelectItem value="flex-project">Flex: auto-fill from project</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="title">Title *</Label>
              <Input
                id="title"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                placeholder="Deep work, Meeting, Break..."
                required
                autoFocus
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="startTime">Start Time *</Label>
                <Input
                  id="startTime"
                  type="time"
                  value={formData.startTime}
                  onChange={(e) => setFormData({ ...formData, startTime: e.target.value })}
                  required
                />
              </div>

              <div>
                <Label htmlFor="endTime">End Time *</Label>
                <Input
                  id="endTime"
                  type="time"
                  value={formData.endTime}
                  onChange={(e) => setFormData({ ...formData, endTime: e.target.value })}
                  required
                />
              </div>
            </div>

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
                  <SelectItem value="none">None</SelectItem>
                  {todos.map((todo) => (
                    <SelectItem key={todo.id} value={todo.id}>
                      {todo.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {formData.slotType !== 'flex-project' && (
            <div>
              <Label htmlFor="project">Project (optional)</Label>
              <Select
                value={formData.projectId}
                onValueChange={(val) => setFormData({ ...formData, projectId: val })}
              >
                <SelectTrigger id="project">
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {projects.map((project) => (
                    <SelectItem key={project.id} value={project.id}>
                      {project.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            )}

            {formData.slotType === 'flex-project' && (
            <div>
              <Label htmlFor="flexProject">Project to pull from *</Label>
              <Select
                value={formData.projectId}
                onValueChange={(val) => setFormData({ ...formData, projectId: val })}
              >
                <SelectTrigger id="flexProject">
                  <SelectValue placeholder="Select project" />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((project) => (
                    <SelectItem key={project.id} value={project.id}>
                      {project.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            )}

            <div>
              <Label>Block Color</Label>
              <div className="grid grid-cols-6 gap-2 mt-2">
                {[
                  'oklch(0.60 0.19 250)',
                  'oklch(0.65 0.20 150)',
                  'oklch(0.70 0.22 50)',
                  'oklch(0.65 0.20 350)',
                  'oklch(0.60 0.18 200)',
                  'oklch(0.68 0.19 100)',
                ].map((color) => (
                  <button
                    key={color}
                    type="button"
                    onClick={() => setFormData({ ...formData, color })}
                    className={cn(
                      "w-10 h-10 rounded-lg border-2 transition-all",
                      formData.color === color ? "border-foreground scale-110" : "border-transparent"
                    )}
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>
            </div>

            <div className="flex items-center space-x-2">
              <Switch
                id="autoTrack"
                checked={formData.autoTrack}
                onCheckedChange={(checked) => setFormData({ ...formData, autoTrack: checked })}
              />
              <Label htmlFor="autoTrack" className="cursor-pointer">
                Auto-start timer when time block begins
              </Label>
            </div>

            <div className="flex justify-end gap-2 pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setIsDialogOpen(false);
                  resetForm();
                }}
              >
                Cancel
              </Button>
              <Button type="submit">
                {editingBlock ? 'Update Block' : 'Create Block'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteConfirmOpen}
        onOpenChange={(open) => {
          setDeleteConfirmOpen(open);
          if (!open) setBlockToDelete(null);
        }}
        title="Delete Time Block?"
        description="Are you sure you want to delete this time block? This action cannot be undone."
        actionType="delete"
        confirmText="Delete"
        cancelText="Cancel"
        onConfirm={handleDeleteConfirm}
      />
    </div>
  );
}
