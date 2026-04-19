import { useState, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { TimeBlock, TimeEntry, Todo, Event, Project } from '@/db/schema';
import { createTimeBlock, updateTimeBlock, deleteTimeBlock, getTimeBlocksByDate } from '@/db/repositories/timeBlocksRepo';
import { getAllTodos, updateTodo } from '@/db/repositories/todosRepo';
import { getAllEvents } from '@/db/repositories/eventsRepo';
import { getAllProjects } from '@/db/repositories/projectsRepo';
import { createTimeEntry, getRunningTimer, updateTimeEntry } from '@/db/repositories/timeRepo';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Plus, Play, Stop, Trash, Clock, CalendarBlank, CheckSquare, Lightning, Warning, CalendarDots } from '@phosphor-icons/react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { RoutinePanel } from '@/components/RoutinePanel';
import { PRIORITY_COLORS, withColorAlpha, scheduleMyDay, DAY_CAPACITY_MINUTES, DEFAULT_TODO_MINUTES } from '@/lib/schedulingUtils';
import { detectBlockConflicts } from '@/lib/conflictDetection';
import { EffectiveScheduleEntry, getCurrentLocation, getEffectiveScheduleForDate, getFreeSlotsForDate } from '@/lib/effectiveSchedule';
import { predictActivity } from '@/lib/habitModel';

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const TIMELINE_HOUR_HEIGHT = 80;
const AUTO_FILL_THRESHOLD_MINUTES = 5;

interface GhostSuggestion {
  id: string;
  title: string;
  confidence: number;
  startTime: string;
  endTime: string;
  color: string;
  locationId: string | null;
}

export function TimelineView() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [timeBlocks, setTimeBlocks] = useState<TimeBlock[]>([]);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingBlock, setEditingBlock] = useState<TimeBlock | null>(null);
  const [runningTimer, setRunningTimer] = useState<TimeEntry | null>(null);
  const [currentTime, setCurrentTime] = useState(new Date());
  const timelineRef = useRef<HTMLDivElement>(null);
  const [dragOverHour, setDragOverHour] = useState<number | null>(null);
  const [isScheduling, setIsScheduling] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [blockToDelete, setBlockToDelete] = useState<string | null>(null);
  const [skeletonEntries, setSkeletonEntries] = useState<EffectiveScheduleEntry[]>([]);
  const [currentLocationLabel, setCurrentLocationLabel] = useState<string | null>(null);
  const [ghostDismissedIds, setGhostDismissedIds] = useState<Set<string>>(new Set());
  const [ghostSuggestions, setGhostSuggestions] = useState<GhostSuggestion[]>([]);
  const [isRoutinePanelOpen, setIsRoutinePanelOpen] = useState(false);

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
    function onDataChange() { void loadData(); }
    window.addEventListener('app:datachange', onDataChange);
    return () => window.removeEventListener('app:datachange', onDataChange);
  }, [currentDate]);

  useEffect(() => {
    let active = true;

    async function buildGhostSuggestions() {
      const dateStr = format(currentDate, 'yyyy-MM-dd');
      const flexSlots = await getFreeSlotsForDate(dateStr);
      const toMinutes = (timeValue: string) => {
        const [h, m] = timeValue.split(':').map(Number);
        return (h * 60) + m;
      };

      const suggestions = await Promise.all(
        flexSlots.map(async (slot) => {
          const predictionTime = new Date(`${dateStr}T${slot.startTime}:00`);
          const prediction = await predictActivity(predictionTime);
          if (!prediction) return null;

          const id = `${dateStr}:${slot.startTime}:${slot.endTime}:${prediction.label}`;
          if (ghostDismissedIds.has(id)) return null;

          const slotStart = toMinutes(slot.startTime);
          const slotEnd = toMinutes(slot.endTime);
          const occupied = timeBlocks.some((block) => {
            const blockStart = toMinutes(block.startTime);
            const blockEnd = toMinutes(block.endTime);
            return blockStart < slotEnd && blockEnd > slotStart;
          });
          if (occupied) return null;

          return {
            id,
            title: prediction.label,
            confidence: prediction.confidence,
            startTime: slot.startTime,
            endTime: slot.endTime,
            color: slot.color,
            locationId: slot.locationId,
          } satisfies GhostSuggestion;
        })
      );

      if (active) {
        setGhostSuggestions(suggestions.filter((item): item is GhostSuggestion => Boolean(item)));
      }
    }

    void buildGhostSuggestions();
    return () => {
      active = false;
    };
  }, [currentDate, timeBlocks, ghostDismissedIds]);

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
    const [blocks, allTodos, allEvents, allProjects, timer, effectiveSchedule, currentLocation] = await Promise.all([
      getTimeBlocksByDate(dateStr),
      getAllTodos(),
      getAllEvents(),
      getAllProjects(),
      getRunningTimer(),
      getEffectiveScheduleForDate(dateStr),
      getCurrentLocation(),
    ]);
    
    setTimeBlocks(blocks.sort((a, b) => a.startTime.localeCompare(b.startTime)));
    setTodos(allTodos.filter(t => t.status !== 'done'));
    setEvents(allEvents);
    setProjects(allProjects);
    setRunningTimer(timer);
    setSkeletonEntries(effectiveSchedule);
    setCurrentLocationLabel(currentLocation ? `${currentLocation.icon} ${currentLocation.name}` : null);
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
      if (Math.abs(nowMinutes - blockStartMinutes) <= AUTO_FILL_THRESHOLD_MINUTES) {
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
        toast.success('Time block updated');
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
        toast.success('Time block created');
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
      const { pushUndo } = await import('@/lib/undoHistory');
      const blockData = timeBlocks.find(b => b.id === blockToDelete);
      if (blockData) pushUndo({ type: 'deleteTimeBlock', data: blockData, ts: Date.now() });
      await deleteTimeBlock(blockToDelete);
      toast.success('Time block deleted', {
        duration: 5000,
        action: {
          label: 'Undo',
          onClick: async () => {
            const { canUndo, popUndo } = await import('@/lib/undoHistory');
            if (canUndo()) {
              const entry = popUndo()!;
              const { add } = await import('@/db/core');
              const { STORES } = await import('@/db/schema');
              await add(STORES.TIME_BLOCKS, entry.data);
              await loadData();
            }
          },
        },
      });
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
      toast.success('Todo marked as done');
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
      const created = await scheduleMyDay(dateStr, unscheduledTodayTodos, timeBlocks);
      if (created === 0) {
        toast.info('All todos are already scheduled!');
      } else {
        toast.success(`Scheduled ${created} todo${created !== 1 ? 's' : ''} for today`);
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
    e.preventDefault();
    const dateStr = format(currentDate, 'yyyy-MM-dd');
    try {
      const occupiedSet = new Set(timeBlocks.map(b => parseInt(b.startTime.split(':')[0])));
      const candidateHours = [9, 10, 14, 15, 11, 13, 16, 17, 8, 18];
      const slot = candidateHours.find(h => !occupiedSet.has(h));
      if (slot === undefined) {
        toast.error('No available time slots for this todo');
        return;
      }
      const startTime = `${String(slot).padStart(2, '0')}:00`;
      const endTime = `${String(slot + 1).padStart(2, '0')}:00`;
      await createTimeBlock({
        title: todo.title,
        date: dateStr,
        startTime,
        endTime,
        todoId: todo.id,
        projectId: todo.projectId ?? null,
        color: PRIORITY_COLORS[todo.priority] ?? PRIORITY_COLORS[3],
        autoTrack: todo.priority >= 4,
        slotType: 'fixed',
      });
      toast.success(`Scheduled "${todo.title}"`);
      loadData();
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

  async function handleAcceptGhost(ghost: GhostSuggestion) {
    const dateStr = format(currentDate, 'yyyy-MM-dd');
    try {
      await createTimeBlock({
        title: ghost.title,
        date: dateStr,
        startTime: ghost.startTime,
        endTime: ghost.endTime,
        todoId: null,
        projectId: null,
        locationId: ghost.locationId,
        color: ghost.color,
        autoTrack: true,
        slotType: 'fixed',
      });
      toast.success(`Added "${ghost.title}" to timeline`);
      setGhostDismissedIds((prev) => {
        const next = new Set(prev);
        next.add(ghost.id);
        return next;
      });
      await loadData();
    } catch {
      toast.error('Failed to add suggested habit');
    }
  }

  function handleDismissGhost(ghost: GhostSuggestion) {
    setGhostDismissedIds((prev) => {
      const next = new Set(prev);
      next.add(ghost.id);
      return next;
    });
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

  /**
   * Assigns each block a column index and column count so that overlapping
   * blocks are rendered side-by-side rather than stacked.
   *
   * Algorithm:
   *  1. Sort blocks by start time.
   *  2. Greedily assign each block to the first column whose last block ends
   *     at or before this block's start (interval scheduling).
   *  3. Walk the list a second time: for each block, the column count is the
   *     maximum column index among all blocks it overlaps, plus one.
   */
  function computeBlockLayouts(blocks: TimeBlock[]): Record<string, { colIndex: number; colCount: number }> {
    const toMinutes = (time: string) => {
      const [h, m] = time.split(':').map(Number);
      return h * 60 + m;
    };

    const items = blocks.map((block) => ({
      id: block.id,
      start: toMinutes(block.startTime),
      end: toMinutes(block.endTime),
    })).sort((a, b) => a.start - b.start || a.end - b.end);

    // columns[c] = end time of the last block placed in column c
    const columns: number[] = [];
    const colAssignment: Record<string, number> = {};

    for (const item of items) {
      let placed = false;
      for (let c = 0; c < columns.length; c++) {
        if (columns[c] <= item.start) {
          columns[c] = item.end;
          colAssignment[item.id] = c;
          placed = true;
          break;
        }
      }
      if (!placed) {
        colAssignment[item.id] = columns.length;
        columns.push(item.end);
      }
    }

    // Second pass: determine colCount for each block
    const result: Record<string, { colIndex: number; colCount: number }> = {};
    for (const item of items) {
      let maxCol = colAssignment[item.id];
      for (const other of items) {
        if (other.id === item.id) continue;
        if (item.start < other.end && item.end > other.start) {
          maxCol = Math.max(maxCol, colAssignment[other.id]);
        }
      }
      result[item.id] = { colIndex: colAssignment[item.id], colCount: maxCol + 1 };
    }

    return result;
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

  const blockLayouts = useMemo(() => computeBlockLayouts(timeBlocks), [timeBlocks]);

  // Daily workload estimate: sum block durations + DEFAULT_TODO_MINUTES per unscheduled todo
  const totalWorkloadMinutes = useMemo(() => {
    const blockMinutes = timeBlocks.reduce((sum, block) => {
      const [sH, sM] = block.startTime.split(':').map(Number);
      const [eH, eM] = block.endTime.split(':').map(Number);
      return sum + Math.max(0, (eH * 60 + eM) - (sH * 60 + sM));
    }, 0);
    const unscheduledMinutes = unscheduledTodayTodos.length * DEFAULT_TODO_MINUTES;
    return blockMinutes + unscheduledMinutes;
  }, [timeBlocks, unscheduledTodayTodos]);

  const isOverloaded = totalWorkloadMinutes > DAY_CAPACITY_MINUTES;
  const warningMessage = isOverloaded
    ? `${(totalWorkloadMinutes / 60).toFixed(1)} h of work planned — over the 8 h baseline`
    : null;

  return (
    <div className="max-w-7xl mx-auto h-[calc(100vh-6rem)]">
      {warningMessage && (
        <div className="mb-3 flex items-center gap-2 rounded-lg px-4 py-2 bg-yellow-500/15 border border-yellow-500/40 text-yellow-700 dark:text-yellow-400">
          <Warning size={16} weight="fill" />
          <span className="text-sm font-medium">
            {warningMessage}
          </span>
        </div>
      )}
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

          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsRoutinePanelOpen(true)}
            className="gap-2"
          >
            <CalendarDots size={16} />
            Routine
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

          {currentLocationLabel && (
            <Badge variant="secondary" className="h-8 px-3">
              Current location: {currentLocationLabel}
            </Badge>
          )}
        </div>
      </div>

      {warningMessage && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-yellow-400/60 bg-yellow-400/10 px-4 py-2 text-sm text-yellow-700 dark:text-yellow-300">
          <Warning size={16} weight="fill" className="shrink-0 text-yellow-500" />
          {warningMessage}
        </div>
      )}

      <div className="grid grid-cols-[1fr_300px] gap-6 h-[calc(100%-5rem)]">
        <Card className="relative overflow-hidden">
          {timeBlocks.length === 0 && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 z-10 pointer-events-none">
              <CalendarBlank weight="thin" size={48} className="text-muted-foreground" />
              <h3 className="text-lg font-semibold">No blocks today</h3>
              <p className="text-sm text-muted-foreground">Drag a task or add a block to get started</p>
            </div>
          )}
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
                {skeletonEntries.map((entry) => {
                  const style = getBlockStyle({
                    id: entry.id,
                    title: entry.title,
                    date: format(currentDate, 'yyyy-MM-dd'),
                    startTime: entry.startTime,
                    endTime: entry.endTime,
                    todoId: null,
                    projectId: null,
                    locationId: entry.locationId,
                    color: entry.color,
                    autoTrack: false,
                    slotType: entry.kind === 'flex' ? 'flex-todo' : 'fixed',
                    createdAt: '',
                    updatedAt: '',
                  });

                  return (
                    <div
                      key={`skeleton-${entry.id}-${entry.startTime}`}
                      className="absolute left-2 right-2 rounded-xl border p-2 pointer-events-none"
                      style={{
                        top: style.top,
                        height: style.height,
                        backgroundColor: withColorAlpha(entry.color, 0.08),
                        borderColor: entry.color,
                        opacity: 0.08,
                        borderStyle: entry.kind === 'flex' ? 'dashed' : 'solid',
                      }}
                    >
                      <p className="text-[11px] font-medium truncate" style={{ color: entry.color }}>
                        {entry.location ? `${entry.location.icon} ` : ''}{entry.title}
                      </p>
                    </div>
                  );
                })}

                {ghostSuggestions.map((ghost) => {
                  const style = getBlockStyle({
                    id: ghost.id,
                    title: ghost.title,
                    date: format(currentDate, 'yyyy-MM-dd'),
                    startTime: ghost.startTime,
                    endTime: ghost.endTime,
                    todoId: null,
                    projectId: null,
                    locationId: ghost.locationId,
                    color: ghost.color,
                    autoTrack: false,
                    slotType: 'flex-todo',
                    createdAt: '',
                    updatedAt: '',
                  });

                  return (
                    <div
                      key={`ghost-${ghost.id}`}
                      className="absolute left-2 right-2 rounded-xl border border-dashed p-2 z-10"
                      style={{
                        top: style.top,
                        height: style.height,
                        backgroundColor: withColorAlpha(ghost.color, 0.3),
                        borderColor: ghost.color,
                        opacity: 0.3,
                      }}
                    >
                      <div className="flex items-center justify-between gap-2 h-full">
                        <div className="min-w-0">
                          <p className="text-xs font-medium truncate">{ghost.title}</p>
                          <p className="text-[10px] text-muted-foreground">{ghost.startTime} - {ghost.endTime}</p>
                        </div>
                        <div className="flex gap-1">
                          <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => void handleAcceptGhost(ghost)} aria-label="Accept suggestion">+</Button>
                          <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => handleDismissGhost(ghost)} aria-label="Dismiss suggestion">✕</Button>
                        </div>
                      </div>
                    </div>
                  );
                })}

                <AnimatePresence>
                  {timeBlocks.map((block) => {
                    const style = getBlockStyle(block);
                    const isRunning = runningTimer?.timeBlockId === block.id;
                    const todo = block.todoId ? todos.find(t => t.id === block.todoId) : null;
                    const project = block.projectId ? projects.find(p => p.id === block.projectId) : null;
                    const isFlex = (block.slotType || 'fixed') !== 'fixed';
                    const isConflicting = conflictingBlockIds.has(block.id);
                    const layout = blockLayouts[block.id] ?? { colIndex: 0, colCount: 1 };
                    const leftPct = (layout.colIndex / layout.colCount) * 100;
                    const widthPct = 100 / layout.colCount;

                    return (
                      <motion.div
                        key={block.id}
                        className={cn(
                          "absolute rounded-xl p-3 cursor-pointer group shadow-md",
                          "hover:shadow-lg transition-all duration-200 border-2",
                          isRunning && "ring-2 ring-primary ring-offset-2 ring-offset-background",
                          isConflicting && "ring-2 ring-red-500 ring-offset-2 ring-offset-background"
                        )}
                        style={{
                          top: style.top,
                          height: style.height,
                          left: `calc(${leftPct}% + 4px)`,
                          width: `calc(${widthPct}% - 8px)`,
                          backgroundColor: withColorAlpha(block.color, 0.15),
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
                              <h4 className="font-semibold text-sm truncate">
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

        <div className="space-y-3 overflow-y-auto">
          {/* 1. Today's progress bar */}
          <Card className="p-3">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-medium">Today's Progress</span>
              <span className="text-xs text-muted-foreground">
                {todayTodos.length - unscheduledTodayTodos.length}/{todayTodos.length} scheduled
              </span>
            </div>
            <div className="w-full bg-muted rounded-full h-1.5">
              <div
                className="bg-primary rounded-full h-1.5 transition-all"
                style={{
                  width: todayTodos.length > 0
                    ? `${((todayTodos.length - unscheduledTodayTodos.length) / todayTodos.length) * 100}%`
                    : '0%',
                }}
              />
            </div>
          </Card>

          {/* 2. Current location badge */}
          {currentLocationLabel && (
            <div className="px-1">
              <Badge variant="secondary" className="h-7 px-3 text-xs w-full justify-center">
                📍 {currentLocationLabel}
              </Badge>
            </div>
          )}

          {/* 3. Drag to schedule chips */}
          <Card className="p-3">
            {todayTodos.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-3">No todos for today</p>
            ) : unscheduledTodayTodos.length === 0 ? (
              <p className="text-sm text-green-500 text-center py-3 font-medium">All tasks scheduled ✓</p>
            ) : (
              <>
                <p className="text-xs text-muted-foreground mb-2">Drag to schedule →</p>
                <div className="space-y-1.5">
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
                      {todo.cognitiveLoad && (
                        <span
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{
                            backgroundColor:
                              todo.cognitiveLoad === 'high'
                                ? 'oklch(0.58 0.20 20)'
                                : todo.cognitiveLoad === 'medium'
                                ? 'oklch(0.75 0.18 75)'
                                : 'oklch(0.65 0.17 145)',
                          }}
                          aria-label={`Cognitive load: ${todo.cognitiveLoad}`}
                          title={
                            todo.cognitiveLoad === 'high'
                              ? 'Deep work'
                              : todo.cognitiveLoad === 'medium'
                              ? 'Medium effort'
                              : 'Easy'
                          }
                        />
                      )}
                    </motion.div>
                  ))}
                </div>
              </>
            )}
          </Card>

          {/* 4. Quick stats */}
          <Card className="p-3">
            <h3 className="font-semibold mb-2 flex items-center gap-2 text-sm">
              <Clock size={16} />
              Quick Stats
            </h3>
            <div className="space-y-1.5">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Time blocks:</span>
                <span className="font-semibold">{timeBlocks.length}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Auto-tracking:</span>
                <span className="font-semibold">{timeBlocks.filter(b => b.autoTrack).length}</span>
              </div>
            </div>
          </Card>

          {/* 5. Running timer */}
          {runningTimer && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <Card className="p-3 border-primary bg-primary/5">
                <div className="flex items-center gap-2 mb-1">
                  <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
                  <h3 className="font-semibold text-sm">Timer Running</h3>
                </div>
                <p className="text-xs text-muted-foreground">{runningTimer.note}</p>
              </Card>
            </motion.div>
          )}
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

      <Dialog open={isRoutinePanelOpen} onOpenChange={setIsRoutinePanelOpen}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Weekly Routine</DialogTitle>
            <DialogDescription>
              Your normal week — Timeline uses this to suggest what goes in free slots
            </DialogDescription>
          </DialogHeader>
          <RoutinePanel onClose={() => setIsRoutinePanelOpen(false)} />
        </DialogContent>
      </Dialog>
    </div>
  );
}
