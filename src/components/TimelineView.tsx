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
import { pickFlexFillCandidate, explainAutoFill } from '@/lib/flexFill';
import { getPeakFocusHours } from '@/lib/energyHours';
import { detectBlockConflicts } from '@/lib/conflictDetection';
import { EffectiveScheduleEntry, getCurrentLocation, getEffectiveScheduleForDate, getFreeSlotsForDate } from '@/lib/effectiveSchedule';
import { predictActivity } from '@/lib/habitModel';
import {
  ALL_DAY_STATUSES,
  STATUS_META,
  getDayStatus,
  setDayStatus,
  suppressesRoutine,
} from '@/db/repositories/dayStatusRepo';
import { DayStatusKind } from '@/db/schema';

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const TIMELINE_HOUR_HEIGHT = 80;
const AUTO_FILL_THRESHOLD_MINUTES = 5;
const TIMELINE_ZOOM_MIN = 0.75;
const TIMELINE_ZOOM_MAX = 2;
const TIMELINE_ZOOM_STEP = 0.25;
const MIN_VISUAL_BLOCK_MINUTES = 15;
const EVENT_PROXY_DURATION_MINUTES = 20;

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
  /** Per-day status for the date currently shown in the header.  Defaults to
   *  'active' until loaded from IndexedDB so the UI never flashes a banner
   *  for the wrong day. */
  const [dayStatus, setDayStatusState] = useState<DayStatusKind>('active');
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);

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
      // Ghost activity predictions are part of "the routine".  When the user
      // marks a day as vacation/off they don't want the model nagging them
      // with predicted activities, so silence them entirely.
      if (suppressesRoutine(dayStatus)) {
        if (active) setGhostSuggestions([]);
        return;
      }
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
  }, [currentDate, timeBlocks, ghostDismissedIds, dayStatus]);

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
    const [blocks, allTodos, allEvents, allProjects, timer, effectiveSchedule, currentLocation, status] = await Promise.all([
      getTimeBlocksByDate(dateStr),
      getAllTodos(),
      getAllEvents(),
      getAllProjects(),
      getRunningTimer(),
      getEffectiveScheduleForDate(dateStr),
      getCurrentLocation(),
      getDayStatus(dateStr),
    ]);
    
    setTimeBlocks(blocks.sort((a, b) => a.startTime.localeCompare(b.startTime)));
    setTodos(allTodos.filter(t => t.status !== 'done'));
    setEvents(allEvents);
    setProjects(allProjects);
    setRunningTimer(timer);
    setSkeletonEntries(effectiveSchedule);
    setCurrentLocationLabel(currentLocation ? `${currentLocation.icon} ${currentLocation.name}` : null);
    setDayStatusState(status);
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

    // Auto-fill flex blocks whose start time is within 5 minutes.
    // Skip entirely on vacation/off — the user explicitly opted out of the
    // routine for the day, and silently filling slots would surprise them.
    if (suppressesRoutine(dayStatus)) return;
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const allTodos = await getAllTodos();
    const peakHours = await getPeakFocusHours();
    // Track scheduledIds locally so multiple flex blocks filled in the same
    // pass don't pick the same todo twice (avoids duplicates).
    const scheduledIds = new Set(blocks.filter(b => b.todoId).map(b => b.todoId as string));

    for (const block of blocks) {
      const slotType = block.slotType || 'fixed';
      if (slotType === 'fixed' || block.todoId) continue;
      const [bH, bM] = block.startTime.split(':').map(Number);
      const blockStartMinutes = bH * 60 + bM;
      if (Math.abs(nowMinutes - blockStartMinutes) <= AUTO_FILL_THRESHOLD_MINUTES) {
        await autoFillFlexBlock(block, allTodos, scheduledIds, peakHours, now);
      }
    }
  }

  async function autoFillFlexBlock(
    block: TimeBlock,
    allTodos: Todo[],
    scheduledIds: Set<string>,
    peakHours: number[],
    now: Date,
  ): Promise<void> {
    const result = pickFlexFillCandidate(block, allTodos, scheduledIds, dayStatus, {
      peakHours,
      now,
    });
    if (!result) return;
    await updateTimeBlock(block.id, { title: result.todo.title, todoId: result.todo.id });
    // Mutate the caller's set so subsequent flex blocks in the same pass
    // can't pick the same todo (avoids duplicate scheduling).
    scheduledIds.add(result.todo.id);
    toast.success(`⚡ Auto-filled: ${explainAutoFill(result)}`);
    loadData();
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

  async function handleStatusChange(next: DayStatusKind) {
    const dateStr = format(currentDate, 'yyyy-MM-dd');
    setIsUpdatingStatus(true);
    // Optimistic — the IndexedDB write usually completes in <5ms, but the
    // Select's controlled `value` prop should track the user's choice
    // immediately for snappiness.
    const previous = dayStatus;
    setDayStatusState(next);
    try {
      await setDayStatus(dateStr, next);
      const meta = STATUS_META[next];
      if (next === 'active') {
        toast.success('Day set to Active — normal routine resumes');
      } else {
        toast.success(`Day set to ${meta.label}`);
      }
      window.dispatchEvent(new CustomEvent('ghc-data-changed'));
      await loadData();
    } catch (err) {
      console.error('[timeline] failed to set day status:', err);
      const detail = err instanceof Error && err.message ? err.message : String(err);
      toast.error(`Failed to update day status: ${detail}`);
      setDayStatusState(previous);
    } finally {
      setIsUpdatingStatus(false);
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

    const result: Record<string, { colIndex: number; colCount: number }> = {};

    let i = 0;
    while (i < items.length) {
      const group: typeof items = [items[i]];
      let groupEnd = items[i].end;
      i += 1;

      while (i < items.length && items[i].start < groupEnd) {
        group.push(items[i]);
        groupEnd = Math.max(groupEnd, items[i].end);
        i += 1;
      }

      const columns: number[] = [];
      const colAssignment: Record<string, number> = {};

      for (const item of group) {
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

      const colCount = Math.max(1, columns.length);
      for (const item of group) {
        result[item.id] = { colIndex: colAssignment[item.id], colCount };
      }
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
    return !e.allDay && format(eventDate, 'yyyy-MM-dd') === format(currentDate, 'yyyy-MM-dd');
  });

  const isToday = format(currentDate, 'yyyy-MM-dd') === format(new Date(), 'yyyy-MM-dd');

  const scheduledTodoIds = new Set(timeBlocks.map(b => b.todoId).filter(Boolean) as string[]);
  const todayTodos = todos.filter(t => t.status === 'today');
  const unscheduledTodayTodos = todayTodos.filter(t => !scheduledTodoIds.has(t.id));

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
      const end = new Date(start.getTime() + EVENT_PROXY_DURATION_MINUTES * 60 * 1000);
      return {
        id: `event-${event.id}`,
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
    return computeBlockLayouts([...timeBlocks, ...proxyBlocks]);
  }, [todayEvents, currentDate, timeBlocks]);

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

  // Column gap for collision layout (px between side-by-side blocks)
  const COL_GAP = 4;

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
            {/* Date navigator */}
            <div className="flex items-center rounded-xl border border-border/60 bg-card shadow-sm overflow-hidden">
              <button
                onClick={() => { const d = new Date(currentDate); d.setDate(d.getDate() - 1); setCurrentDate(d); }}
                className="px-2.5 py-2 hover:bg-muted/70 transition-colors text-muted-foreground hover:text-foreground"
                aria-label="Previous day"
              >
                <CaretLeft size={14} />
              </button>
              <div
                className="px-3 py-2 min-w-[120px] text-center text-sm font-semibold border-x border-border/50 select-none"
                aria-label={`Currently viewing ${format(currentDate, 'EEEE, MMMM d, yyyy')}`}
              >
                {format(currentDate, 'EEE, MMM d')}
              </div>
              <button
                onClick={() => { const d = new Date(currentDate); d.setDate(d.getDate() + 1); setCurrentDate(d); }}
                className="px-2.5 py-2 hover:bg-muted/70 transition-colors text-muted-foreground hover:text-foreground"
                aria-label="Next day"
              >
                <CaretRight size={14} />
              </button>
            </div>

            <AnimatePresence>
              {!isToday && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.92, width: 0 }}
                  animate={{ opacity: 1, scale: 1, width: 'auto' }}
                  exit={{ opacity: 0, scale: 0.92, width: 0 }}
                  transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                >
                  <Button variant="ghost" size="sm" onClick={() => setCurrentDate(new Date())} className="text-muted-foreground whitespace-nowrap">
                    Today
                  </Button>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Zoom control */}
            <div className="flex items-center rounded-xl border border-border/60 bg-card shadow-sm overflow-hidden">
              <button
                onClick={() => setTimelineZoom((z) => Math.max(TIMELINE_ZOOM_MIN, Number((z - TIMELINE_ZOOM_STEP).toFixed(2))))}
                className="px-2.5 py-2 hover:bg-muted/70 transition-colors text-muted-foreground hover:text-foreground disabled:opacity-40"
                aria-label="Zoom out timeline"
                disabled={timelineZoom <= TIMELINE_ZOOM_MIN}
              >
                <MagnifyingGlassMinus size={14} />
              </button>
              <button
                onClick={() => setTimelineZoom(1)}
                className="px-2.5 py-2 text-[11px] font-semibold tabular-nums border-x border-border/50 hover:bg-muted/70 transition-colors"
                aria-label="Reset timeline zoom"
              >
                {Math.round(timelineZoom * 100)}%
              </button>
              <button
                onClick={() => setTimelineZoom((z) => Math.min(TIMELINE_ZOOM_MAX, Number((z + TIMELINE_ZOOM_STEP).toFixed(2))))}
                className="px-2.5 py-2 hover:bg-muted/70 transition-colors text-muted-foreground hover:text-foreground disabled:opacity-40"
                aria-label="Zoom in timeline"
                disabled={timelineZoom >= TIMELINE_ZOOM_MAX}
              >
                <MagnifyingGlassPlus size={14} />
              </button>
            </div>

            <div className="h-4 w-px bg-border/50 hidden sm:block" />

            <Button variant="outline" size="sm" onClick={() => setIsRoutinePanelOpen(true)} className="gap-1.5 rounded-xl">
              <CalendarDots size={14} />
              Routine
            </Button>

            {/* Day status selector — controls whether routine / auto-fill / suggestions apply. */}
            <Select
              value={dayStatus}
              onValueChange={(v) => void handleStatusChange(v as DayStatusKind)}
              disabled={isUpdatingStatus}
            >
              <SelectTrigger
                className={cn(
                  'h-9 rounded-xl gap-1.5 px-3 text-xs font-semibold border min-w-[120px]',
                  STATUS_META[dayStatus].pill,
                )}
                aria-label={`Day status (currently ${STATUS_META[dayStatus].label})`}
                title={STATUS_META[dayStatus].description}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-current opacity-80" aria-hidden />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ALL_DAY_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    <span className="flex flex-col items-start gap-0.5 py-0.5">
                      <span className="font-medium">{STATUS_META[s].label}</span>
                      <span className="text-[10.5px] text-muted-foreground leading-tight">
                        {STATUS_META[s].description}
                      </span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {unscheduledTodayTodos.length > 0 && (
              <Button
                variant="secondary"
                size="sm"
                onClick={handleScheduleMyDay}
                disabled={isScheduling}
                className="gap-1.5 rounded-xl"
              >
                <Lightning size={14} weight="bold" />
                {isScheduling ? 'Scheduling…' : 'Schedule Day'}
              </Button>
            )}

            <Button size="sm" onClick={() => setIsDialogOpen(true)} className="gap-1.5 rounded-xl">
              <Plus size={14} weight="bold" />
              Add Block
            </Button>
          </div>
        </div>

        {/* Status banners */}
        <AnimatePresence>
          {dayStatus !== 'active' && (
            <motion.div
              key="day-status-banner"
              initial={{ opacity: 0, y: -6, height: 0 }}
              animate={{ opacity: 1, y: 0, height: 'auto' }}
              exit={{ opacity: 0, y: -6, height: 0 }}
              className={cn(
                'flex items-start gap-2 rounded-xl px-3 py-2 border',
                STATUS_META[dayStatus].banner,
              )}
              role="status"
            >
              <span
                className="w-2 h-2 mt-1.5 rounded-full bg-current shrink-0"
                aria-hidden
              />
              <div className="text-xs min-w-0 flex-1">
                <span className="font-semibold">{STATUS_META[dayStatus].label} day.</span>{' '}
                <span className="opacity-90">{STATUS_META[dayStatus].description}</span>
              </div>
              <button
                type="button"
                onClick={() => void handleStatusChange('active')}
                disabled={isUpdatingStatus}
                className="text-[11px] font-medium underline-offset-2 hover:underline opacity-90 hover:opacity-100 disabled:opacity-50 shrink-0"
              >
                Resume normal
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {warningMessage && (
            <motion.div
              key="overload"
              initial={{ opacity: 0, y: -6, height: 0 }}
              animate={{ opacity: 1, y: 0, height: 'auto' }}
              exit={{ opacity: 0, y: -6, height: 0 }}
              className="flex items-center gap-2 rounded-xl px-3 py-2 bg-amber-500/10 border border-amber-500/25 text-amber-700 dark:text-amber-400"
            >
              <Warning size={13} weight="fill" className="shrink-0" />
              <span className="text-xs font-medium">{warningMessage}</span>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {(activeTimelineBlock || nextTimelineBlock) && (
            <motion.div
              key="now-banner"
              initial={{ opacity: 0, y: -6, height: 0 }}
              animate={{ opacity: 1, y: 0, height: 'auto' }}
              exit={{ opacity: 0, y: -6, height: 0 }}
              className="flex items-center gap-2.5 rounded-xl px-3 py-2 bg-primary/5 border border-primary/20"
            >
              <Clock size={13} className="text-primary shrink-0" />
              {activeTimelineBlock ? (
                <p className="text-xs font-medium min-w-0 truncate">
                  <span className="text-primary tabular-nums font-bold">{formatRemaining(activeRemainingSeconds ?? 0)}</span>
                  <span className="text-muted-foreground"> left · </span>
                  <span className="font-semibold">{activeTimelineBlock.title}</span>
                  <span className="text-muted-foreground"> ({activeTimelineBlock.startTime}–{activeTimelineBlock.endTime})</span>
                </p>
              ) : (
                <p className="text-xs font-medium min-w-0 truncate">
                  Up next at <span className="tabular-nums font-bold">{nextTimelineBlock?.startTime}</span>
                  <span className="text-muted-foreground"> · </span>
                  {nextTimelineBlock?.title}
                </p>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ── Body ────────────────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 grid grid-cols-1 xl:grid-cols-[1fr_280px] gap-4">

        {/* ── Timeline canvas ──────────────────────────────────────────── */}
        <div className="relative bg-card border border-border/60 rounded-2xl overflow-hidden shadow-sm">

          {/* Empty state overlay */}
          <AnimatePresence>
            {!hasTimelineContent && (
              <motion.div
                key="empty"
                className="absolute inset-0 flex flex-col items-center justify-center gap-3 z-10 pointer-events-none"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <motion.div
                  className="w-16 h-16 rounded-2xl bg-muted/80 flex items-center justify-center"
                  animate={{ y: [0, -4, 0] }}
                  transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
                >
                  <CalendarBlank weight="light" size={30} className="text-muted-foreground" />
                </motion.div>
                <div className="text-center">
                  <p className="text-sm font-semibold">Nothing planned</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Drag a task here or click Add Block</p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Scrollable timeline */}
          <div
            ref={timelineRef}
            className="h-full overflow-y-auto overflow-x-hidden"
            style={{ scrollBehavior: 'smooth' }}
          >
            {/* Inner canvas — height = 24 hours × hourHeight */}
            <div className="relative select-none" style={{ height: HOURS.length * timelineHourHeight }}>

              {/* ── Hour rows ── */}
              {HOURS.map((hour) => (
                <div
                  key={hour}
                  className={cn(
                    "absolute left-0 right-0 border-t border-border/30",
                    hour % 2 !== 0 ? "bg-muted/20" : "bg-transparent",
                    dragOverHour === hour && "bg-primary/5"
                  )}
                  style={{ top: hour * timelineHourHeight, height: timelineHourHeight }}
                  onDragOver={(e) => { e.preventDefault(); setDragOverHour(hour); }}
                  onDragLeave={() => setDragOverHour(null)}
                  onDrop={(e) => handleTodoDrop(hour, e)}
                >
                  {/* Hour label */}
                  <div className="absolute left-0 top-0 w-16 flex items-start justify-end pr-3 pt-1.5 pointer-events-none">
                    <span className={cn(
                      "text-[10px] font-mono tabular-nums leading-none",
                      hour === 0 || hour % 6 === 0
                        ? "text-foreground/60 font-bold"
                        : "text-muted-foreground/40"
                    )}>
                      {format(new Date().setHours(hour, 0, 0, 0), 'h a')}
                    </span>
                  </div>

                  {/* Half-hour dashed line */}
                  <div
                    className="absolute left-16 right-0 border-t border-dashed border-border/20"
                    style={{ top: timelineHourHeight / 2 }}
                  />

                  {/* Vertical divider (column start) */}
                  <div className={cn(
                    "absolute left-16 top-0 bottom-0 right-0 border-l border-border/25",
                    dragOverHour === hour && "border-primary/50 bg-primary/4 border-l-2"
                  )} />
                </div>
              ))}

              {/* ── Current-time indicator (FIXED: always start at correct position) ── */}
              {isToday && (
                <motion.div
                  className="absolute left-0 right-0 z-30 pointer-events-none"
                  initial={{ top: getCurrentTimePosition() }}
                  animate={{ top: getCurrentTimePosition() }}
                  transition={{ type: 'tween', duration: 0.8, ease: 'linear' }}
                >
                  {/* Time label */}
                  <div className="absolute left-0 w-16 flex justify-end pr-2.5">
                    <span className="text-[9px] font-mono tabular-nums text-rose-500 dark:text-rose-400 bg-card px-1 py-0.5 rounded -translate-y-1/2 leading-none font-semibold shadow-sm border border-rose-500/20">
                      {format(currentTime, 'HH:mm')}
                    </span>
                  </div>
                  {/* Dot + line */}
                  <div className="absolute left-16 right-0 flex items-center">
                    <motion.div
                      className="w-3 h-3 rounded-full bg-rose-500 dark:bg-rose-400 shrink-0 -ml-1.5 shadow-[0_0_0_3px_oklch(0.58_0.22_15_/_0.22)]"
                      animate={{ scale: [1, 1.25, 1] }}
                      transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
                    />
                    <div className="flex-1 h-px bg-gradient-to-r from-rose-500 dark:from-rose-400 to-rose-400/0 dark:to-rose-300/0" />
                  </div>
                </motion.div>
              )}

              {/* ── Block rendering area ── */}
              <div className="absolute left-16 right-2 top-0 bottom-0">

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
                  const colW = `calc(${100 / layout.colCount}% - ${(COL_GAP * (layout.colCount - 1)) / layout.colCount}px)`;
                  const colL = `calc(${(layout.colIndex / layout.colCount) * 100}% + ${(layout.colIndex * COL_GAP) / layout.colCount}px)`;
                  return (
                    <div
                      key={skeletonId}
                      className="absolute pointer-events-none overflow-hidden rounded-lg"
                      style={{
                        top: style.top + 1,
                        height: Math.max(style.height - 2, 36),
                        left: colL,
                        width: colW,
                        borderLeft: `3px ${entry.kind === 'flex' ? 'dashed' : 'solid'} ${entry.color}`,
                        backgroundColor: withColorAlpha(entry.color, 0.06),
                      }}
                    >
                      <div className="px-2 py-1.5">
                        <p className="text-[9px] text-muted-foreground/80 tabular-nums leading-tight mb-0.5">
                          {entry.startTime}–{entry.endTime}
                        </p>
                        <p className="text-[10px] font-medium truncate leading-tight" style={{ color: withColorAlpha(entry.color, 0.75) }}>
                          {entry.location ? `${entry.location.icon} ` : ''}{entry.title}
                          {entry.kind === 'flex' && <span className="opacity-40"> · flex</span>}
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
                        className="absolute overflow-hidden rounded-xl z-10"
                        style={{
                          top: style.top + 1,
                          height: Math.max(style.height - 2, 40),
                          left: 2,
                          right: 2,
                          borderLeft: `3px dashed ${withColorAlpha(ghost.color, 0.6)}`,
                          backgroundColor: withColorAlpha(ghost.color, 0.05),
                          backdropFilter: 'blur(4px)',
                        }}
                        initial={{ opacity: 0, x: -8, scale: 0.97 }}
                        animate={{ opacity: 1, x: 0, scale: 1 }}
                        exit={{ opacity: 0, x: -8, scale: 0.97 }}
                        transition={{ type: 'spring', stiffness: 340, damping: 28 }}
                      >
                        <div className="flex items-center justify-between gap-1 h-full px-2.5 py-1.5">
                          <div className="min-w-0 flex-1">
                            <p className="text-[10px] font-medium truncate leading-tight tabular-nums text-muted-foreground">
                              {ghost.startTime}–{ghost.endTime}
                            </p>
                            <p className="text-[11px] font-semibold truncate leading-tight" style={{ color: ghost.color }}>
                              ✦ {ghost.title}
                            </p>
                            <p className="text-[9px] text-muted-foreground tabular-nums">
                              {Math.round(ghost.confidence * 100)}% likely
                            </p>
                          </div>
                          <div className="flex gap-1 shrink-0">
                            <button
                              onClick={() => void handleAcceptGhost(ghost)}
                              className="w-6 h-6 rounded-lg flex items-center justify-center hover:bg-green-500/20 text-green-600 transition-colors"
                              aria-label="Accept suggestion"
                            >
                              <CheckSquare size={12} />
                            </button>
                            <button
                              onClick={() => handleDismissGhost(ghost)}
                              className="w-6 h-6 rounded-lg flex items-center justify-center hover:bg-muted text-muted-foreground transition-colors text-[10px] font-bold"
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
                    const layout = blockLayouts[block.id] ?? { colIndex: 0, colCount: 1 };
                    const colW = `calc(${100 / layout.colCount}% - ${(COL_GAP * (layout.colCount - 1)) / layout.colCount}px)`;
                    const colL = `calc(${(layout.colIndex / layout.colCount) * 100}% + ${(layout.colIndex * COL_GAP) / layout.colCount}px)`;
                    const rawHeight = Math.max(style.height - 2, 20);
                    const visualHeight = Math.max(rawHeight, 36);
                    const isCompact = visualHeight < 60;
                    const isTiny = visualHeight < 46;

                    return (
                      <motion.div
                        key={block.id}
                        className={cn(
                          "absolute overflow-hidden cursor-pointer group z-20 rounded-xl",
                          isRunning && "ring-2 ring-emerald-500/60 ring-offset-1 ring-offset-card",
                        )}
                        style={{
                          top: style.top + 1,
                          height: visualHeight,
                          left: colL,
                          width: colW,
                          backgroundColor: withColorAlpha(block.color, 0.10 + layout.colIndex * 0.03),
                          borderLeft: isFlex
                            ? `3px dashed ${block.color}`
                            : `3px solid ${block.color}`,
                          boxShadow: `inset 0 0 0 1px ${withColorAlpha(block.color, 0.12)}`,
                        }}
                        initial={{ opacity: 0, scale: 0.96, y: 4 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.93, y: -3 }}
                        whileHover={{
                          y: -2,
                          boxShadow: `0 4px 16px ${withColorAlpha(block.color, 0.22)}, inset 0 0 0 1px ${withColorAlpha(block.color, 0.20)}`,
                        }}
                        transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                        onClick={() => handleEdit(block)}
                        title={`${block.startTime}–${block.endTime} · ${block.title}`}
                      >
                        {/* Running timer pulse bar */}
                        {isRunning && (
                          <motion.div
                            className="absolute top-0 left-0 right-0 h-0.5 bg-emerald-500 origin-left"
                            animate={{ opacity: [1, 0.3, 1] }}
                            transition={{ duration: 1.6, repeat: Infinity }}
                          />
                        )}

                        <div className="flex items-start gap-1.5 px-2.5 py-1.5 h-full overflow-hidden">
                          {/* Left content */}
                          <div className="flex-1 min-w-0 overflow-hidden">
                            {/* Time + title row */}
                            <div className="flex items-center gap-1 flex-wrap">
                              {isRunning && (
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0 animate-pulse" />
                              )}
                              <span className="text-[10px] tabular-nums text-muted-foreground/70 shrink-0 leading-none">
                                {block.startTime}–{block.endTime}
                              </span>
                            </div>
                            {/* Title */}
                            {!isTiny && (
                              <h4
                                className="text-[11px] font-semibold truncate leading-tight mt-0.5"
                                style={{ color: block.color }}
                              >
                                {isFlex ? '⚡ Flex slot' : block.title}
                              </h4>
                            )}
                            {isTiny && (
                              <h4
                                className="text-[10px] font-semibold truncate leading-none mt-0.5"
                                style={{ color: block.color }}
                              >
                                {isFlex ? '⚡' : block.title}
                              </h4>
                            )}

                            {/* Linked todo */}
                            {!isTiny && todo && (
                              <p className="text-[10px] truncate text-foreground/55 leading-tight mt-0.5">{todo.title}</p>
                            )}
                            {!isTiny && isFlex && !todo && (
                              <p className="text-[10px] truncate text-foreground/40 leading-tight mt-0.5 italic">awaiting task…</p>
                            )}

                            {/* Project pill + auto badge */}
                            {!isCompact && (
                              <div className="flex items-center gap-1 mt-1 flex-wrap">
                                {project && (
                                  <span
                                    className="text-[9px] font-medium px-1.5 py-0.5 rounded-full leading-none"
                                    style={{
                                      backgroundColor: withColorAlpha(block.color, 0.16),
                                      color: block.color,
                                    }}
                                  >
                                    {project.name}
                                  </span>
                                )}
                                {block.autoTrack && !isRunning && (
                                  <span
                                    className="text-[8px] font-semibold px-1 py-0.5 rounded border leading-none"
                                    style={{
                                      borderColor: withColorAlpha(block.color, 0.30),
                                      color: withColorAlpha(block.color, 0.75),
                                    }}
                                  >
                                    auto
                                  </span>
                                )}
                              </div>
                            )}
                          </div>

                          {/* Hover action buttons */}
                          <div
                            className="flex flex-col gap-0.5 opacity-0 group-hover:opacity-100 transition-all duration-150 shrink-0 translate-x-1 group-hover:translate-x-0"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {block.todoId && (
                              <button
                                onClick={() => handleCompleteBlock(block)}
                                className="w-5 h-5 rounded-md flex items-center justify-center hover:bg-emerald-500/20 text-emerald-600 transition-colors"
                                title="Mark as done"
                              >
                                <CheckSquare size={10} />
                              </button>
                            )}
                            <button
                              onClick={() => handleManualTimer(block)}
                              className="w-5 h-5 rounded-md flex items-center justify-center hover:bg-muted text-muted-foreground transition-colors"
                              title={isRunning ? 'Stop timer' : 'Start timer'}
                            >
                              {isRunning ? <Stop size={10} /> : <Play size={10} />}
                            </button>
                            <button
                              onClick={() => handleDelete(block.id)}
                              className="w-5 h-5 rounded-md flex items-center justify-center hover:bg-destructive/15 text-destructive transition-colors"
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
                  const layout = todayEventLayouts[`event-${event.id}`] ?? { colIndex: 0, colCount: 1 };
                  const colW = `calc(${100 / layout.colCount}% - ${(COL_GAP * (layout.colCount - 1)) / layout.colCount}px)`;
                  const colL = `calc(${(layout.colIndex / layout.colCount) * 100}% + ${(layout.colIndex * COL_GAP) / layout.colCount}px)`;
                  const eventColor = `oklch(0.60 0.18 ${event.priority * 50})`;
                  return (
                    <motion.div
                      key={event.id}
                      className="absolute min-h-[28px] rounded-lg overflow-hidden border-l-2 z-10"
                      style={{
                        top: top + 1,
                        left: colL,
                        width: colW,
                        borderLeftColor: eventColor,
                        backgroundColor: `oklch(0.60 0.18 ${event.priority * 50} / 0.07)`,
                        boxShadow: `inset 0 0 0 1px oklch(0.60 0.18 ${event.priority * 50} / 0.10)`,
                      }}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ type: 'spring', stiffness: 360, damping: 28 }}
                    >
                      <div className="flex items-center gap-1.5 px-2 h-full py-1">
                        <CalendarBlank size={9} weight="fill" className="text-muted-foreground/60 shrink-0" />
                        <p className="text-[10px] font-medium truncate flex-1">{event.title}</p>
                        <p className="text-[9px] text-muted-foreground/70 shrink-0 tabular-nums">{format(eventDate, 'h:mm a')}</p>
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

          {/* Day overview card */}
          <div className="bg-card border border-border/60 rounded-2xl shadow-sm p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/80">Day Overview</span>
              <span className="text-xs text-muted-foreground">{isToday ? 'Today' : format(currentDate, 'MMM d')}</span>
            </div>

            {/* Schedule progress */}
            <div className="space-y-1.5 mb-4">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Scheduled</span>
                <span className="text-xs font-bold tabular-nums">
                  {todayTodos.length - unscheduledTodayTodos.length}
                  <span className="font-normal text-muted-foreground">/{todayTodos.length}</span>
                </span>
              </div>
              <div className="w-full bg-muted/80 rounded-full h-1.5 overflow-hidden">
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

            {/* Stats */}
            <div className="grid grid-cols-3 gap-2 pt-3 border-t border-border/40">
              {[
                { label: 'Blocks', value: String(timeBlocks.length) },
                { label: 'Auto', value: String(timeBlocks.filter(b => b.autoTrack).length) },
                {
                  label: 'Load',
                  value: `${(totalWorkloadMinutes / 60).toFixed(1)}h`,
                  accent: isOverloaded,
                },
              ].map(({ label, value, accent }) => (
                <div key={label} className="text-center">
                  <p className="text-[10px] text-muted-foreground/70 uppercase tracking-wider font-medium">{label}</p>
                  <p className={cn("text-xl font-bold tabular-nums mt-0.5 leading-none", accent && "text-amber-500")}>
                    {value}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* Running timer card */}
          <AnimatePresence>
            {runningTimer && (
              <motion.div
                initial={{ opacity: 0, y: -8, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -8, scale: 0.96 }}
                transition={{ type: 'spring', stiffness: 360, damping: 26 }}
                className="bg-card border border-emerald-500/30 bg-emerald-500/5 rounded-2xl shadow-sm px-3.5 py-3 flex items-center gap-3"
              >
                <motion.div
                  className="w-2 h-2 rounded-full bg-emerald-500 shrink-0"
                  animate={{ scale: [1, 1.4, 1], opacity: [1, 0.5, 1] }}
                  transition={{ duration: 1.5, repeat: Infinity }}
                />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 leading-tight">Timer running</p>
                  <p className="text-[10px] text-muted-foreground truncate leading-tight mt-0.5">{runningTimer.note}</p>
                </div>
                <button
                  onClick={async () => {
                    await updateTimeEntry(runningTimer.id, { endAt: new Date().toISOString() });
                    toast.success('Timer stopped');
                    loadData();
                  }}
                  className="shrink-0 h-6 px-2.5 rounded-lg text-[10px] font-semibold bg-emerald-500/15 hover:bg-emerald-500/30 text-emerald-700 dark:text-emerald-400 transition-colors"
                >
                  Stop
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Unscheduled todos */}
          <div className="bg-card border border-border/60 rounded-2xl shadow-sm p-3 flex-1 min-h-0 flex flex-col">
            <div className="flex items-center justify-between mb-2.5 shrink-0">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/80">
                Unscheduled
              </span>
              <AnimatePresence>
                {unscheduledTodayTodos.length > 0 && (
                  <motion.span
                    key="count"
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.8, opacity: 0 }}
                    className="text-[10px] font-semibold text-muted-foreground tabular-nums bg-muted px-2 py-0.5 rounded-full"
                  >
                    {unscheduledTodayTodos.length}
                  </motion.span>
                )}
              </AnimatePresence>
            </div>

            {todayTodos.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center py-6 text-center">
                <Clock size={24} weight="light" className="text-muted-foreground/60 mb-2" />
                <p className="text-xs text-muted-foreground/70">No todos for today</p>
              </div>
            ) : unscheduledTodayTodos.length === 0 ? (
              <motion.div
                className="flex-1 flex flex-col items-center justify-center py-6 text-center"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
              >
                <CheckSquare size={24} weight="fill" className="text-emerald-500 mb-2" />
                <p className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">All tasks scheduled!</p>
              </motion.div>
            ) : (
              <div className="flex-1 overflow-y-auto min-h-0 flex flex-col gap-1.5">
                <p className="text-[10px] text-muted-foreground/60 shrink-0 mb-0.5">Drag onto the timeline →</p>
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
                      "flex items-center gap-2 rounded-xl px-2.5 py-2 cursor-grab active:cursor-grabbing select-none",
                      "border border-border/40 hover:border-border/70 bg-background hover:bg-muted/30",
                      "focus:outline-none focus:ring-2 focus:ring-ring focus:bg-muted/50 transition-all duration-150",
                    )}
                    initial={{ opacity: 0, x: 12 }}
                    animate={{ opacity: 1, x: 0 }}
                    whileHover={{ x: 2 }}
                    transition={{ delay: index * 0.035, type: 'spring', stiffness: 380, damping: 28 }}
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
                      <span className="text-[9px] text-muted-foreground/60 shrink-0 tabular-nums">
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
