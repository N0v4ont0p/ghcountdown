import { useState, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { TimeBlock, TimeEntry, Todo, Event, Project } from '@/db/schema';
import { createTimeBlock, updateTimeBlock, deleteTimeBlock, getTimeBlocksByDate } from '@/db/repositories/timeBlocksRepo';
import { getAllTodos, updateTodo } from '@/db/repositories/todosRepo';
import { getAllEvents } from '@/db/repositories/eventsRepo';
import { getAllProjects } from '@/db/repositories/projectsRepo';
import { createTimeEntry, getRunningTimer, updateTimeEntry } from '@/db/repositories/timeRepo';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Plus, Play, Stop, Trash, Clock, CalendarBlank, CheckSquare, Lightning, Warning, CalendarDots, CaretLeft, CaretRight, MapPin, MagnifyingGlassPlus, MagnifyingGlassMinus } from '@phosphor-icons/react';
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
const TIMELINE_ZOOM_MIN = 0.75;
const TIMELINE_ZOOM_MAX = 2;
const TIMELINE_ZOOM_STEP = 0.25;
const MIN_VISUAL_BLOCK_MINUTES = 15;
const TIMELINE_COLUMN_GAP = 6;

const COGNITIVE_LOAD_COLORS = {
  high:   { bg: 'oklch(0.58 0.20 20)', text: 'oklch(0.50 0.20 20)' },
  medium: { bg: 'oklch(0.75 0.18 75)', text: 'oklch(0.58 0.18 75)' },
  low:    { bg: 'oklch(0.65 0.17 145)', text: 'oklch(0.48 0.17 145)' },
} as const;

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
  const [timelineZoom, setTimelineZoom] = useState(1);
  const timelineHourHeight = TIMELINE_HOUR_HEIGHT * timelineZoom;

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
    void checkAutoTracking();
    const checkInterval = setInterval(() => {
      void checkAutoTracking();
    }, 30000);
    return () => clearInterval(checkInterval);
  }, [currentDate]);

  useEffect(() => {
    const clockInterval = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(clockInterval);
  }, []);

  useEffect(() => {
    function onDataChange() { void loadData(); }
    window.addEventListener('ghc-data-changed', onDataChange);
    window.addEventListener('app:datachange', onDataChange);
    return () => {
      window.removeEventListener('ghc-data-changed', onDataChange);
      window.removeEventListener('app:datachange', onDataChange);
    };
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
      const scrollTo = Math.max(0, (currentHour - 2) * timelineHourHeight);
      timelineRef.current.scrollTop = scrollTo;
    }
  }, [timelineHourHeight]);

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

    if (formData.startTime > formData.endTime) {
      toast.error('End time cannot be earlier than start time');
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
    const visualEndMinutes = endMinutes <= startMinutes
      ? startMinutes + MIN_VISUAL_BLOCK_MINUTES
      : endMinutes;
    const duration = visualEndMinutes - startMinutes;
    
    const top = (startMinutes / 60) * timelineHourHeight;
    const height = (duration / 60) * timelineHourHeight;
    
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

    const items = blocks.map((block) => {
      const start = toMinutes(block.startTime);
      const rawEnd = toMinutes(block.endTime);
      const end = rawEnd <= start ? start + MIN_VISUAL_BLOCK_MINUTES : rawEnd;
      return {
      id: block.id,
      start,
      end,
    };
    }).sort((a, b) => a.start - b.start || a.end - b.end);

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
    return (totalMinutes / 60) * timelineHourHeight;
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
  const skeletonLayouts = useMemo(
    () => computeBlockLayouts(
      skeletonEntries.map((entry) => ({
        id: `skeleton-${entry.id}-${entry.startTime}`,
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
      }))
    ),
    [skeletonEntries, currentDate]
  );
  const todayEventLayouts = useMemo(() => {
    const proxyBlocks: TimeBlock[] = todayEvents.map((event) => {
      const start = new Date(event.startsAt);
      const end = new Date(start.getTime() + 20 * 60 * 1000);
      return {
        id: event.id,
        title: event.title,
        date: format(currentDate, 'yyyy-MM-dd'),
        startTime: format(start, 'HH:mm'),
        endTime: format(end, 'HH:mm'),
        todoId: null,
        projectId: null,
        locationId: null,
        color: `oklch(0.60 0.18 ${event.priority * 50})`,
        autoTrack: false,
        slotType: 'fixed',
        createdAt: '',
        updatedAt: '',
      };
    });
    return computeBlockLayouts(proxyBlocks);
  }, [todayEvents, currentDate]);

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
  const hasTimelineContent = timeBlocks.length > 0 || skeletonEntries.length > 0 || ghostSuggestions.length > 0;

  const activeTimelineBlock = useMemo(() => {
    const nowHHMM = format(currentTime, 'HH:mm');
    return timeBlocks.find((block) => block.startTime <= nowHHMM && nowHHMM < block.endTime) ?? null;
  }, [timeBlocks, currentTime]);

  const nextTimelineBlock = useMemo(() => {
    if (activeTimelineBlock) return null;
    const nowHHMM = format(currentTime, 'HH:mm');
    return timeBlocks.find((block) => block.startTime > nowHHMM) ?? null;
  }, [timeBlocks, currentTime, activeTimelineBlock]);

  function formatRemaining(seconds: number): string {
    const safe = Math.max(0, seconds);
    const h = Math.floor(safe / 3600);
    const m = Math.floor((safe % 3600) / 60);
    const s = safe % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  const activeRemainingSeconds = useMemo(() => {
    if (!activeTimelineBlock) return null;
    const [endHour, endMinute] = activeTimelineBlock.endTime.split(':').map(Number);
    return Math.max(
      0,
      (endHour * 3600 + endMinute * 60)
      - (currentTime.getHours() * 3600 + currentTime.getMinutes() * 60 + currentTime.getSeconds())
    );
  }, [activeTimelineBlock, currentTime]);

  return (
    <div className="max-w-7xl mx-auto flex flex-col gap-4 h-[calc(100vh-6rem)]">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-2 shrink-0">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          {/* Left: title + subtitle */}
          <div>
            <h2 className="text-2xl font-bold tracking-tight">Timeline</h2>
            <p className="text-sm text-muted-foreground flex items-center gap-1.5 mt-0.5">
              {format(currentDate, 'EEEE, MMMM d, yyyy')}
              {currentLocationLabel && (
                <span className="flex items-center gap-1 text-xs bg-muted px-2 py-0.5 rounded-full border border-border/60 ml-1">
                  <MapPin size={10} weight="fill" className="shrink-0" />
                  {currentLocationLabel}
                </span>
              )}
            </p>
          </div>

          {/* Right: toolbar */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Date navigator — unified pill */}
            <div className="flex items-center rounded-lg border bg-card shadow-sm overflow-hidden">
              <button
                onClick={() => { const d = new Date(currentDate); d.setDate(d.getDate() - 1); setCurrentDate(d); }}
                className="px-2.5 py-2 hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                aria-label="Previous day"
              >
                <CaretLeft size={14} />
              </button>
              <div
                className="px-3 py-2 min-w-[120px] text-center text-sm font-semibold border-x border-border/60 select-none"
                aria-label={`Currently viewing ${format(currentDate, 'EEEE, MMMM d, yyyy')}`}
              >
                {format(currentDate, 'EEE, MMM d')}
              </div>
              <button
                onClick={() => { const d = new Date(currentDate); d.setDate(d.getDate() + 1); setCurrentDate(d); }}
                className="px-2.5 py-2 hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                aria-label="Next day"
              >
                <CaretRight size={14} />
              </button>
            </div>

            {!isToday && (
              <Button variant="ghost" size="sm" onClick={() => setCurrentDate(new Date())} className="text-muted-foreground">
                Today
              </Button>
            )}

            <div className="flex items-center rounded-lg border bg-card shadow-sm overflow-hidden">
              <button
                onClick={() => setTimelineZoom((z) => Math.max(TIMELINE_ZOOM_MIN, Number((z - TIMELINE_ZOOM_STEP).toFixed(2))))}
                className="px-2.5 py-2 hover:bg-muted transition-colors text-muted-foreground hover:text-foreground disabled:opacity-40"
                aria-label="Zoom out timeline"
                disabled={timelineZoom <= TIMELINE_ZOOM_MIN}
              >
                <MagnifyingGlassMinus size={14} />
              </button>
              <button
                onClick={() => setTimelineZoom(1)}
                className="px-2.5 py-2 text-[11px] font-semibold tabular-nums border-x border-border/60 hover:bg-muted transition-colors"
                aria-label="Reset timeline zoom"
              >
                {Math.round(timelineZoom * 100)}%
              </button>
              <button
                onClick={() => setTimelineZoom((z) => Math.min(TIMELINE_ZOOM_MAX, Number((z + TIMELINE_ZOOM_STEP).toFixed(2))))}
                className="px-2.5 py-2 hover:bg-muted transition-colors text-muted-foreground hover:text-foreground disabled:opacity-40"
                aria-label="Zoom in timeline"
                disabled={timelineZoom >= TIMELINE_ZOOM_MAX}
              >
                <MagnifyingGlassPlus size={14} />
              </button>
            </div>

            <div className="h-4 w-px bg-border/60 hidden sm:block" />

            <Button variant="outline" size="sm" onClick={() => setIsRoutinePanelOpen(true)} className="gap-1.5">
              <CalendarDots size={14} />
              Routine
            </Button>

            {unscheduledTodayTodos.length > 0 && (
              <Button
                variant="secondary"
                size="sm"
                onClick={handleScheduleMyDay}
                disabled={isScheduling}
                className="gap-1.5"
              >
                <Lightning size={14} weight="bold" />
                {isScheduling ? 'Scheduling…' : 'Schedule Day'}
              </Button>
            )}

            <Button size="sm" onClick={() => setIsDialogOpen(true)} className="gap-1.5">
              <Plus size={14} weight="bold" />
              Add Block
            </Button>
          </div>
        </div>

        {/* Overload warning — inline under header */}
        {warningMessage && (
          <div className="flex items-center gap-2 rounded-lg px-3 py-2 bg-amber-500/10 border border-amber-500/25 text-amber-700 dark:text-amber-400">
            <Warning size={14} weight="fill" className="shrink-0" />
            <span className="text-xs font-medium">{warningMessage}</span>
          </div>
        )}
        {(activeTimelineBlock || nextTimelineBlock) && (
          <div className="flex items-center gap-2 rounded-lg px-3 py-2 bg-primary/5 border border-primary/20">
            <Clock size={13} className="text-primary shrink-0" />
            {activeTimelineBlock ? (
              <p className="text-xs font-medium min-w-0 truncate">
                <span className="text-primary tabular-nums">{formatRemaining(activeRemainingSeconds ?? 0)}</span>
                {' left · '}
                {activeTimelineBlock.title}
                <span className="text-muted-foreground"> ({activeTimelineBlock.startTime}–{activeTimelineBlock.endTime})</span>
              </p>
            ) : (
              <p className="text-xs font-medium min-w-0 truncate">
                Up next at <span className="tabular-nums">{nextTimelineBlock?.startTime}</span> · {nextTimelineBlock?.title}
              </p>
            )}
          </div>
        )}
      </div>

      {/* ── Body ────────────────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 grid grid-cols-1 xl:grid-cols-[1fr_272px] gap-4">

        {/* ── Timeline canvas ──────────────────────────────────────────── */}
        <div className="relative bg-card border border-border rounded-xl overflow-hidden shadow-sm">
          {/* Empty state */}
          {!hasTimelineContent && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 z-10 pointer-events-none">
              <div className="w-14 h-14 rounded-2xl bg-muted/80 flex items-center justify-center">
                <CalendarBlank weight="light" size={28} className="text-muted-foreground" />
              </div>
              <div className="text-center">
                <p className="text-sm font-semibold">Nothing planned</p>
                <p className="text-xs text-muted-foreground mt-0.5">Drag a task here or click Add Block</p>
              </div>
            </div>
          )}

          {/* Scrollable timeline */}
          <div
            ref={timelineRef}
            className="h-full overflow-y-auto overflow-x-hidden"
            style={{ scrollBehavior: 'smooth' }}
          >
            <div className="relative select-none" style={{ height: HOURS.length * timelineHourHeight }}>

              {/* ── Hour grid ── */}
              {HOURS.map((hour) => (
                <div
                  key={hour}
                  className={cn(
                    "absolute left-0 right-0 border-t border-border/40",
                    hour % 2 !== 0 ? "bg-muted/25" : "bg-transparent",
                    dragOverHour === hour && "bg-primary/5"
                  )}
                  style={{ top: hour * timelineHourHeight, height: timelineHourHeight }}
                  onDragOver={(e) => { e.preventDefault(); setDragOverHour(hour); }}
                  onDragLeave={() => setDragOverHour(null)}
                  onDrop={(e) => handleTodoDrop(hour, e)}
                >
                  {/* Time label */}
                  <div className="absolute left-0 top-0 w-14 flex items-start justify-end pr-2 pt-1.5 pointer-events-none">
                    <span className={cn(
                      "text-[10px] font-mono tabular-nums leading-none",
                      hour === 0 || hour % 6 === 0
                        ? "text-muted-foreground/90 font-semibold"
                        : "text-muted-foreground/50"
                    )}>
                      {format(new Date().setHours(hour, 0, 0, 0), 'h a')}
                    </span>
                  </div>
                  {/* Vertical divider */}
                  <div className={cn(
                    "absolute left-14 top-0 bottom-0 right-0 border-l border-border/30",
                    dragOverHour === hour && "border-primary/40 bg-primary/5 border-l-2"
                  )} />
                </div>
              ))}

              {/* ── Current time indicator ── */}
              {isToday && (
                <motion.div
                  className="absolute left-0 right-0 z-30 pointer-events-none"
                  style={{ top: getCurrentTimePosition() }}
                  animate={{ top: getCurrentTimePosition() }}
                  transition={{ type: 'tween', duration: 0.5 }}
                >
                  {/* Time readout */}
                  <div className="absolute left-0 w-14 flex justify-end pr-1.5">
                    <span className="text-[9px] font-mono tabular-nums text-red-500 bg-card px-0.5 rounded -translate-y-2/3 leading-none">
                      {format(currentTime, 'HH:mm')}
                    </span>
                  </div>
                  {/* Line + dot */}
                  <div className="absolute left-14 right-0 flex items-center">
                    <motion.div
                      className="w-2.5 h-2.5 rounded-full bg-red-500 shrink-0 -ml-[5px] shadow-[0_0_0_3px_oklch(0.58_0.20_20_/_0.25)]"
                      animate={{ scale: [1, 1.2, 1] }}
                      transition={{ duration: 2, repeat: Infinity }}
                    />
                    <div className="flex-1 h-px bg-red-500/75" />
                  </div>
                </motion.div>
              )}

              {/* ── Block rendering area ── */}
              <div className="absolute left-14 right-2 top-0 bottom-0">

                {/* Skeleton / routine entries */}
                {skeletonEntries.map((entry) => {
                  const skeletonId = `skeleton-${entry.id}-${entry.startTime}`;
                  const style = getBlockStyle({
                    id: skeletonId,
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
                  const layout = skeletonLayouts[skeletonId] ?? { colIndex: 0, colCount: 1 };
                  const leftPct = (layout.colIndex / layout.colCount) * 100;
                  const widthPct = 100 / layout.colCount;
                  const columnOffsetPx = (layout.colIndex * TIMELINE_COLUMN_GAP) / layout.colCount;
                  const columnWidthShrinkPx = (TIMELINE_COLUMN_GAP * (layout.colCount - 1)) / layout.colCount;
                  return (
                    <div
                      key={skeletonId}
                      className="absolute pointer-events-none overflow-hidden rounded-r-md"
                      style={{
                        top: style.top + 1,
                        height: Math.max(style.height - 2, 36),
                        left: `calc(${leftPct}% + ${columnOffsetPx}px)`,
                        width: `calc(${widthPct}% - ${columnWidthShrinkPx}px)`,
                        borderLeft: `3px ${entry.kind === 'flex' ? 'dashed' : 'solid'} ${entry.color}`,
                        backgroundColor: withColorAlpha(entry.color, 0.07),
                      }}
                    >
                      <div className="px-2 py-1.5">
                        <p className="text-[9px] text-muted-foreground/90 tabular-nums leading-tight mb-0.5">
                          {entry.startTime}–{entry.endTime}
                        </p>
                        <p className="text-[10px] font-medium truncate leading-tight" style={{ color: entry.color }}>
                          {entry.location ? `${entry.location.icon} ` : ''}{entry.title}
                          {entry.kind === 'flex' && <span className="opacity-50"> · flex</span>}
                        </p>
                      </div>
                    </div>
                  );
                })}

                {/* Ghost suggestions (habit predictions) */}
                <AnimatePresence initial={false}>
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
                      <motion.div
                        key={`ghost-${ghost.id}`}
                        className="absolute overflow-hidden rounded-r-md z-10"
                        style={{
                          top: style.top + 1,
                          height: Math.max(style.height - 2, 34),
                          left: 2,
                          right: 2,
                          borderLeft: `3px dashed ${withColorAlpha(ghost.color, 0.7)}`,
                          backgroundColor: withColorAlpha(ghost.color, 0.06),
                        }}
                        initial={{ opacity: 0, x: -4 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -4 }}
                      >
                        <div className="flex items-center justify-between gap-1 h-full px-2 py-1">
                          <div className="min-w-0 flex-1">
                            <p className="text-[11px] font-medium truncate leading-tight tabular-nums text-muted-foreground">
                              {ghost.startTime}–{ghost.endTime}
                            </p>
                            <p className="text-[11px] font-medium truncate leading-tight" style={{ color: ghost.color }}>
                              ✦ {ghost.title}
                            </p>
                            <p className="text-[10px] text-muted-foreground tabular-nums">
                              {Math.round(ghost.confidence * 100)}% likely
                            </p>
                          </div>
                          <div className="flex gap-0.5 shrink-0">
                            <button
                              onClick={() => void handleAcceptGhost(ghost)}
                              className="w-6 h-6 rounded flex items-center justify-center hover:bg-green-500/20 text-green-600 transition-colors"
                              aria-label="Accept suggestion"
                            >
                              <CheckSquare size={12} />
                            </button>
                            <button
                              onClick={() => handleDismissGhost(ghost)}
                              className="w-6 h-6 rounded flex items-center justify-center hover:bg-muted text-muted-foreground transition-colors text-[10px] font-medium"
                              aria-label="Dismiss suggestion"
                            >
                              ✕
                            </button>
                          </div>
                        </div>
                      </motion.div>
                    );
                  })}
                </AnimatePresence>

                {/* Actual time blocks */}
                <AnimatePresence initial={false}>
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
                    const columnOffsetPx = (layout.colIndex * TIMELINE_COLUMN_GAP) / layout.colCount;
                    const columnWidthShrinkPx = (TIMELINE_COLUMN_GAP * (layout.colCount - 1)) / layout.colCount;
                    const rawHeight = Math.max(style.height - 2, 20);
                    const visualHeight = Math.max(rawHeight, 34);
                    const isCompact = visualHeight < 56;
                    const isTiny = visualHeight < 44;

                    return (
                      <motion.div
                        key={block.id}
                        className={cn(
                          "absolute overflow-hidden cursor-pointer group z-20 rounded-r-lg",
                          "transition-shadow duration-150 hover:shadow-md",
                          isRunning && "shadow-[0_0_0_2px_var(--primary)] shadow-primary/20",
                          isConflicting && "shadow-[0_0_0_2px_oklch(0.58_0.20_20)]",
                        )}
                        style={{
                          top: style.top + 1,
                          height: visualHeight,
                          left: `calc(${leftPct}% + ${columnOffsetPx}px)`,
                          width: `calc(${widthPct}% - ${columnWidthShrinkPx}px)`,
                          backgroundColor: withColorAlpha(block.color, 0.11),
                          borderLeft: isFlex
                            ? `3px dashed ${block.color}`
                            : `3px solid ${block.color}`,
                        }}
                        initial={{ opacity: 0, scale: 0.97, y: 3 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: -2 }}
                        whileHover={{ y: -1 }}
                        transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                        onClick={() => handleEdit(block)}
                        title={`${block.startTime}–${block.endTime} · ${block.title}`}
                      >
                        {/* Running timer glow bar */}
                        {isRunning && (
                          <motion.div
                            className="absolute top-0 left-0 right-0 h-[2px] bg-green-500 origin-left"
                            animate={{ opacity: [1, 0.35, 1] }}
                            transition={{ duration: 1.8, repeat: Infinity }}
                          />
                        )}

                        <div className="flex items-start justify-between gap-1 px-2 py-1.5 h-full overflow-hidden">
                          {/* Content */}
                          <div className="flex-1 min-w-0 overflow-hidden">
                            {/* Title row */}
                            <div className="flex items-center gap-1 mb-0.5">
                              {isRunning && (
                                <span className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0 animate-pulse" />
                              )}
                              {isConflicting && (
                                <Warning size={10} className="text-red-500 shrink-0" weight="fill" />
                              )}
                              <span className="text-[10px] tabular-nums font-medium text-muted-foreground shrink-0">
                                {isTiny ? `${block.startTime}–${block.endTime}` : block.startTime}
                              </span>
                              {!isTiny && <span className="text-[10px] text-muted-foreground">–{block.endTime}</span>}
                              <h4 className="text-xs font-semibold truncate leading-tight min-w-0" style={{ color: block.color }}>
                                {isFlex ? '⚡ Flex' : block.title}
                              </h4>
                              {block.autoTrack && !isRunning && (
                                <span
                                  className="text-[8px] font-medium px-1 py-px rounded border shrink-0 leading-tight"
                                  style={{ borderColor: withColorAlpha(block.color, 0.35), color: withColorAlpha(block.color, 0.8) }}
                                >
                                  auto
                                </span>
                              )}
                            </div>

                            {/* Todo linked */}
                            {!isTiny && todo && (
                              <p className="text-[10px] truncate text-foreground/60 leading-tight">{todo.title}</p>
                            )}
                            {!isTiny && isFlex && !todo && (
                              <p className="text-[10px] truncate text-foreground/50 leading-tight italic">awaiting task</p>
                            )}

                            {/* Time range */}
                            {!isCompact && (
                              <p className="text-[10px] text-muted-foreground tabular-nums mt-0.5 leading-tight">
                                {block.startTime}–{block.endTime}
                              </p>
                            )}

                            {/* Project pill */}
                            {!isCompact && project && (
                              <span
                                className="inline-block mt-1 text-[9px] font-medium px-1.5 py-px rounded-full leading-tight"
                                style={{
                                  backgroundColor: withColorAlpha(block.color, 0.16),
                                  color: block.color,
                                }}
                              >
                                {project.name}
                              </span>
                            )}
                          </div>

                          {/* Hover actions */}
                          <div
                            className="flex flex-col gap-px opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {block.todoId && (
                              <button
                                onClick={() => handleCompleteBlock(block)}
                                className="w-5 h-5 rounded flex items-center justify-center hover:bg-green-500/20 text-green-600 transition-colors"
                                title="Mark as done"
                              >
                                <CheckSquare size={10} />
                              </button>
                            )}
                            <button
                              onClick={() => handleManualTimer(block)}
                              className="w-5 h-5 rounded flex items-center justify-center hover:bg-muted text-muted-foreground transition-colors"
                              title={isRunning ? 'Stop timer' : 'Start timer'}
                            >
                              {isRunning ? <Stop size={10} /> : <Play size={10} />}
                            </button>
                            <button
                              onClick={() => handleDelete(block.id)}
                              className="w-5 h-5 rounded flex items-center justify-center hover:bg-destructive/15 text-destructive transition-colors"
                              title="Delete block"
                            >
                              <Trash size={10} />
                            </button>
                          </div>
                        </div>
                      </motion.div>
                    );
                  })}
                </AnimatePresence>

                {/* Calendar events */}
                {todayEvents.map((event) => {
                  const eventDate = new Date(event.startsAt);
                  const hour = eventDate.getHours();
                  const minute = eventDate.getMinutes();
                  const top = (hour * 60 + minute) / 60 * timelineHourHeight;
                  const layout = todayEventLayouts[event.id] ?? { colIndex: 0, colCount: 1 };
                  const leftPct = (layout.colIndex / layout.colCount) * 100;
                  const widthPct = 100 / layout.colCount;
                  const columnOffsetPx = (layout.colIndex * TIMELINE_COLUMN_GAP) / layout.colCount;
                  const columnWidthShrinkPx = (TIMELINE_COLUMN_GAP * (layout.colCount - 1)) / layout.colCount;
                  return (
                    <motion.div
                      key={event.id}
                      className="absolute min-h-[28px] rounded overflow-hidden border-l-2 z-10"
                      style={{
                        top: top + 1,
                        left: `calc(${leftPct}% + ${columnOffsetPx}px)`,
                        width: `calc(${widthPct}% - ${columnWidthShrinkPx}px)`,
                        borderLeftColor: `oklch(0.60 0.18 ${event.priority * 50})`,
                        backgroundColor: `oklch(0.60 0.18 ${event.priority * 50} / 0.08)`,
                      }}
                      initial={{ opacity: 0, x: -6 }}
                      animate={{ opacity: 1, x: 0 }}
                    >
                      <div className="flex items-center gap-1.5 px-2 h-full">
                        <CalendarBlank size={9} weight="fill" className="text-muted-foreground shrink-0" />
                        <p className="text-[10px] font-medium truncate flex-1">{event.title}</p>
                        <p className="text-[10px] text-muted-foreground shrink-0 tabular-nums">{format(eventDate, 'h:mm a')}</p>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* ── Sidebar ──────────────────────────────────────────────────── */}
        <div className="flex flex-col gap-3 overflow-y-auto min-h-0">

          {/* Day overview */}
          <div className="bg-card border border-border rounded-xl shadow-sm p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Day Overview</span>
              <span className="text-xs text-muted-foreground">{isToday ? 'Today' : format(currentDate, 'MMM d')}</span>
            </div>

            {/* Progress bar */}
            <div className="space-y-1.5 mb-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Scheduled</span>
                <span className="text-xs font-semibold tabular-nums">
                  {todayTodos.length - unscheduledTodayTodos.length}
                  <span className="font-normal text-muted-foreground">/{todayTodos.length}</span>
                </span>
              </div>
              <div className="w-full bg-muted rounded-full h-1.5 overflow-hidden">
                <motion.div
                  className="h-full rounded-full bg-primary"
                  initial={{ width: 0 }}
                  animate={{
                    width: todayTodos.length > 0
                      ? `${((todayTodos.length - unscheduledTodayTodos.length) / todayTodos.length) * 100}%`
                      : '0%',
                  }}
                  transition={{ type: 'spring', stiffness: 180, damping: 28 }}
                />
              </div>
            </div>

            {/* Stats grid */}
            <div className="grid grid-cols-3 gap-2 pt-3 border-t border-border/50">
              <div className="text-center">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium">Blocks</p>
                <p className="text-xl font-bold tabular-nums mt-0.5">{timeBlocks.length}</p>
              </div>
              <div className="text-center">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium">Auto</p>
                <p className="text-xl font-bold tabular-nums mt-0.5">{timeBlocks.filter(b => b.autoTrack).length}</p>
              </div>
              <div className="text-center">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium">Load</p>
                <p className={cn("text-xl font-bold tabular-nums mt-0.5", isOverloaded && "text-amber-500")}>
                  {(totalWorkloadMinutes / 60).toFixed(1)}
                  <span className="text-[10px] font-normal text-muted-foreground">h</span>
                </p>
              </div>
            </div>
          </div>

          {/* Running timer */}
          <AnimatePresence>
            {runningTimer && (
              <motion.div
                initial={{ opacity: 0, y: -6, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -6, scale: 0.97 }}
                transition={{ type: 'spring', stiffness: 300, damping: 25 }}
              >
                <div className="bg-card border border-green-500/30 bg-green-500/5 rounded-xl shadow-sm px-3 py-2.5 flex items-center gap-2.5">
                  <motion.div
                    className="w-2 h-2 rounded-full bg-green-500 shrink-0"
                    animate={{ scale: [1, 1.35, 1], opacity: [1, 0.6, 1] }}
                    transition={{ duration: 1.6, repeat: Infinity }}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-green-700 dark:text-green-400 leading-tight">Timer running</p>
                    <p className="text-[10px] text-muted-foreground truncate leading-tight mt-0.5">{runningTimer.note}</p>
                  </div>
                  <button
                    onClick={async () => {
                      await updateTimeEntry(runningTimer.id, { endAt: new Date().toISOString() });
                      toast.success('Timer stopped');
                      loadData();
                    }}
                    className="shrink-0 h-6 px-2.5 rounded text-[10px] font-semibold bg-green-500/15 hover:bg-green-500/30 text-green-700 dark:text-green-400 transition-colors"
                  >
                    Stop
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Unscheduled todos */}
          <div className="bg-card border border-border rounded-xl shadow-sm p-3 flex-1 min-h-0 flex flex-col">
            <div className="flex items-center justify-between mb-2 shrink-0">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Unscheduled
              </span>
              {unscheduledTodayTodos.length > 0 && (
                <span className="text-[10px] font-medium text-muted-foreground tabular-nums bg-muted px-1.5 py-0.5 rounded-full">
                  {unscheduledTodayTodos.length}
                </span>
              )}
            </div>

            {todayTodos.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center py-4 text-center">
                <Clock size={22} weight="light" className="text-muted-foreground mb-1.5" />
                <p className="text-xs text-muted-foreground">No todos for today</p>
              </div>
            ) : unscheduledTodayTodos.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center py-4 text-center">
                <CheckSquare size={22} weight="fill" className="text-green-500 mb-1.5" />
                <p className="text-xs font-medium text-green-600 dark:text-green-400">All tasks scheduled</p>
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto min-h-0 flex flex-col gap-1.5">
                <p className="text-[10px] text-muted-foreground shrink-0">Drag onto the timeline →</p>
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
                    className={cn(
                      "flex items-center gap-2 rounded-lg px-2.5 py-2 cursor-grab active:cursor-grabbing select-none",
                      "border border-border/50 hover:border-border bg-background hover:bg-muted/40",
                      "focus:outline-none focus:ring-2 focus:ring-ring focus:bg-muted/50 transition-colors",
                    )}
                    initial={{ opacity: 0, x: 10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: index * 0.04 }}
                  >
                    {/* Priority dot */}
                    <div
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: PRIORITY_COLORS[todo.priority] ?? PRIORITY_COLORS[3] }}
                    />

                    {/* Title */}
                    <span className="text-xs truncate flex-1 font-medium leading-tight">{todo.title}</span>

                    {/* Estimated minutes */}
                    {todo.estimatedMinutes && (
                      <span className="text-[9px] text-muted-foreground shrink-0 tabular-nums">
                        {todo.estimatedMinutes}m
                      </span>
                    )}

                    {/* Cognitive load chip */}
                    {todo.cognitiveLoad && (
                      <span
                        className="text-[9px] font-semibold px-1.5 py-px rounded-full shrink-0 leading-tight"
                        style={{
                          backgroundColor: withColorAlpha(COGNITIVE_LOAD_COLORS[todo.cognitiveLoad].bg, 0.14),
                          color: COGNITIVE_LOAD_COLORS[todo.cognitiveLoad].text,
                        }}
                        title={
                          todo.cognitiveLoad === 'high' ? 'Deep work' :
                          todo.cognitiveLoad === 'medium' ? 'Medium effort' : 'Easy'
                        }
                        aria-label={`Cognitive load: ${todo.cognitiveLoad}`}
                      >
                        {todo.cognitiveLoad === 'high' ? '⚡' : todo.cognitiveLoad === 'medium' ? '◈' : '○'}
                      </span>
                    )}
                  </motion.div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Dialogs ─────────────────────────────────────────────────────── */}
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
                    <SelectItem key={todo.id} value={todo.id}>{todo.title}</SelectItem>
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
                      <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>
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
                      <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div>
              <Label>Block Color</Label>
              <div className="flex gap-2 mt-2 flex-wrap">
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
                      "w-8 h-8 rounded-full border-2 transition-all hover:scale-110",
                      formData.color === color
                        ? "border-foreground scale-110 shadow-md"
                        : "border-transparent opacity-70 hover:opacity-100"
                    )}
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>
            </div>

            <div className="flex items-center gap-3 py-1">
              <Switch
                id="autoTrack"
                checked={formData.autoTrack}
                onCheckedChange={(checked) => setFormData({ ...formData, autoTrack: checked })}
              />
              <Label htmlFor="autoTrack" className="cursor-pointer text-sm font-normal">
                Auto-start timer when block begins
              </Label>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => { setIsDialogOpen(false); resetForm(); }}
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
