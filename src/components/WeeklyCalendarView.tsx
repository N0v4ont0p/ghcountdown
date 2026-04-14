import { useState, useEffect, useRef, DragEvent } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { TimeBlock, Todo, Event, Project } from '@/db/schema';
import { getAllTimeBlocks, createTimeBlock, updateTimeBlock, deleteTimeBlock, getTimeBlocksByDateRange } from '@/db/repositories/timeBlocksRepo';
import { getAllTodos } from '@/db/repositories/todosRepo';
import { getAllEvents } from '@/db/repositories/eventsRepo';
import { getAllProjects } from '@/db/repositories/projectsRepo';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Plus, CaretLeft, CaretRight, FloppyDisk, Copy, CalendarBlank, Sparkle } from '@phosphor-icons/react';
import { format, startOfWeek, addDays, addWeeks, parse, isToday, isSameDay } from 'date-fns';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

const HOURS = Array.from({ length: 19 }, (_, i) => i + 5);
const HOUR_HEIGHT = 60;
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

interface RecurringPreset {
  id: string;
  name: string;
  title: string;
  startTime: string;
  endTime: string;
  color: string;
  autoTrack: boolean;
  days: number[];
}

const DEFAULT_PRESETS: RecurringPreset[] = [
  {
    id: 'morning-routine',
    name: 'Morning Routine',
    title: 'Morning Routine',
    startTime: '06:00',
    endTime: '07:00',
    color: 'oklch(0.70 0.15 50)',
    autoTrack: false,
    days: [1, 2, 3, 4, 5],
  },
  {
    id: 'deep-work',
    name: 'Deep Work',
    title: 'Deep Work',
    startTime: '09:00',
    endTime: '11:00',
    color: 'oklch(0.55 0.22 260)',
    autoTrack: true,
    days: [1, 2, 3, 4, 5],
  },
  {
    id: 'lunch',
    name: 'Lunch Break',
    title: 'Lunch',
    startTime: '12:00',
    endTime: '13:00',
    color: 'oklch(0.65 0.18 120)',
    autoTrack: false,
    days: [1, 2, 3, 4, 5],
  },
  {
    id: 'afternoon-focus',
    name: 'Afternoon Focus',
    title: 'Focused Work',
    startTime: '14:00',
    endTime: '16:00',
    color: 'oklch(0.60 0.20 240)',
    autoTrack: true,
    days: [1, 2, 3, 4, 5],
  },
  {
    id: 'exercise',
    name: 'Exercise',
    title: 'Workout',
    startTime: '18:00',
    endTime: '19:00',
    color: 'oklch(0.60 0.22 30)',
    autoTrack: false,
    days: [1, 2, 3, 4, 5, 6],
  },
];

export function WeeklyCalendarView() {
  const [currentWeekStart, setCurrentWeekStart] = useState(startOfWeek(new Date(), { weekStartsOn: 0 }));
  const [timeBlocks, setTimeBlocks] = useState<TimeBlock[]>([]);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isPresetDialogOpen, setIsPresetDialogOpen] = useState(false);
  const [editingBlock, setEditingBlock] = useState<TimeBlock | null>(null);
  const [draggedBlock, setDraggedBlock] = useState<TimeBlock | null>(null);
  const [currentTime, setCurrentTime] = useState(new Date());
  const gridRef = useRef<HTMLDivElement>(null);

  const [formData, setFormData] = useState({
    title: '',
    startTime: '09:00',
    endTime: '10:00',
    todoId: '',
    projectId: '',
    color: 'oklch(0.60 0.19 250)',
    autoTrack: true,
  });

  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(currentWeekStart, i));

  useEffect(() => {
    loadData();
    const interval = setInterval(() => setCurrentTime(new Date()), 60000);
    return () => clearInterval(interval);
  }, [currentWeekStart]);

  async function loadData() {
    const startDate = format(currentWeekStart, 'yyyy-MM-dd');
    const endDate = format(addDays(currentWeekStart, 6), 'yyyy-MM-dd');
    
    const [blocks, allTodos, allEvents, allProjects] = await Promise.all([
      getTimeBlocksByDateRange(startDate, endDate),
      getAllTodos(),
      getAllEvents(),
      getAllProjects(),
    ]);
    
    setTimeBlocks(blocks);
    setTodos(allTodos.filter((t: Todo) => t.status !== 'done'));
    setEvents(allEvents);
    setProjects(allProjects);
  }

  function resetForm() {
    setFormData({
      title: '',
      startTime: '09:00',
      endTime: '10:00',
      todoId: '',
      projectId: '',
      color: 'oklch(0.60 0.19 250)',
      autoTrack: true,
    });
    setEditingBlock(null);
  }

  async function handleDrop(dayIndex: number, hour: number, e: DragEvent) {
    e.preventDefault();
    
    if (!draggedBlock) return;

    const newDate = format(weekDays[dayIndex], 'yyyy-MM-dd');
    const hourStr = String(hour).padStart(2, '0');
    const startTime = `${hourStr}:00`;
    
    const [oldHour] = draggedBlock.startTime.split(':').map(Number);
    const [oldEndHour] = draggedBlock.endTime.split(':').map(Number);
    const duration = oldEndHour - oldHour;
    const endTime = `${String(hour + duration).padStart(2, '0')}:00`;

    await updateTimeBlock(draggedBlock.id, {
      date: newDate,
      startTime,
      endTime,
    });

    toast.success('Time block moved!');
    loadData();
    setDraggedBlock(null);
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

    const dateStr = format(weekDays[new Date().getDay()], 'yyyy-MM-dd');

    try {
      if (editingBlock) {
        await updateTimeBlock(editingBlock.id, {
          title: formData.title,
          startTime: formData.startTime,
          endTime: formData.endTime,
          todoId: formData.todoId || null,
          projectId: formData.projectId || null,
          color: formData.color,
          autoTrack: formData.autoTrack,
        });
        toast.success('Time block updated!');
      } else {
        await createTimeBlock({
          title: formData.title,
          date: dateStr,
          startTime: formData.startTime,
          endTime: formData.endTime,
          todoId: formData.todoId || null,
          projectId: formData.projectId || null,
          color: formData.color,
          autoTrack: formData.autoTrack,
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

  async function applyPreset(preset: RecurringPreset) {
    const blocksToCreate = [];
    
    for (const dayIndex of preset.days) {
      const date = weekDays[dayIndex];
      const dateStr = format(date, 'yyyy-MM-dd');
      
      const exists = timeBlocks.some(
        block => block.date === dateStr && 
        block.startTime === preset.startTime && 
        block.title === preset.title
      );
      
      if (!exists) {
        blocksToCreate.push(createTimeBlock({
          title: preset.title,
          date: dateStr,
          startTime: preset.startTime,
          endTime: preset.endTime,
          todoId: null,
          projectId: null,
          color: preset.color,
          autoTrack: preset.autoTrack,
        }));
      }
    }
    
    await Promise.all(blocksToCreate);
    toast.success(`Applied "${preset.name}" to ${blocksToCreate.length} days`);
    setIsPresetDialogOpen(false);
    loadData();
  }

  function getBlocksForDay(dayIndex: number) {
    const dayDate = format(weekDays[dayIndex], 'yyyy-MM-dd');
    return timeBlocks.filter(block => block.date === dayDate);
  }

  function getEventsForDay(dayIndex: number) {
    const dayDate = weekDays[dayIndex];
    return events.filter(e => {
      const eventDate = new Date(e.startsAt);
      return isSameDay(eventDate, dayDate);
    });
  }

  function getBlockPosition(block: TimeBlock) {
    const [startHour, startMin] = block.startTime.split(':').map(Number);
    const [endHour, endMin] = block.endTime.split(':').map(Number);
    
    const startIndex = HOURS.indexOf(startHour);
    const endIndex = HOURS.indexOf(endHour);
    
    const top = startIndex * HOUR_HEIGHT + (startMin / 60) * HOUR_HEIGHT;
    const height = (endIndex - startIndex) * HOUR_HEIGHT + ((endMin - startMin) / 60) * HOUR_HEIGHT;
    
    return { top, height };
  }

  function getCurrentTimePosition() {
    const hours = currentTime.getHours();
    const minutes = currentTime.getMinutes();
    
    if (hours < 5 || hours >= 24) return null;
    
    const hourIndex = HOURS.indexOf(hours);
    if (hourIndex === -1) return null;
    
    return hourIndex * HOUR_HEIGHT + (minutes / 60) * HOUR_HEIGHT;
  }

  const todayDayIndex = weekDays.findIndex(day => isToday(day));
  const currentTimePos = getCurrentTimePosition();

  return (
    <div className="h-[calc(100vh-4rem)] flex flex-col">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-semibold mb-1">Weekly Calendar</h2>
          <p className="text-muted-foreground">
            {format(currentWeekStart, 'MMM d')} - {format(addDays(currentWeekStart, 6), 'MMM d, yyyy')}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={() => setCurrentWeekStart(addWeeks(currentWeekStart, -1))}
          >
            <CaretLeft size={20} />
          </Button>
          
          <Button
            variant="outline"
            onClick={() => setCurrentWeekStart(startOfWeek(new Date(), { weekStartsOn: 0 }))}
          >
            This Week
          </Button>

          <Button
            variant="outline"
            size="icon"
            onClick={() => setCurrentWeekStart(addWeeks(currentWeekStart, 1))}
          >
            <CaretRight size={20} />
          </Button>

          <div className="w-px h-6 bg-border mx-2"></div>

          <Button
            variant="outline"
            onClick={() => setIsPresetDialogOpen(true)}
            className="gap-2"
          >
            <Sparkle size={16} weight="fill" />
            Presets
          </Button>

          <Button onClick={() => setIsDialogOpen(true)} className="gap-2">
            <Plus size={16} weight="bold" />
            Add Block
          </Button>
        </div>
      </div>

      <Card className="flex-1 overflow-hidden">
        <div className="grid grid-cols-[60px_repeat(7,1fr)] h-full">
          <div className="border-r bg-muted/30">
            <div className="h-12 border-b flex items-center justify-center text-xs font-semibold text-muted-foreground">
              Time
            </div>
            <ScrollArea className="h-[calc(100%-3rem)]">
              <div style={{ height: HOURS.length * HOUR_HEIGHT }}>
                {HOURS.map((hour) => (
                  <div
                    key={hour}
                    className="border-b border-border/50 flex items-start justify-center pt-1"
                    style={{ height: HOUR_HEIGHT }}
                  >
                    <span className="text-xs font-medium text-muted-foreground">
                      {format(new Date().setHours(hour, 0, 0, 0), 'h a')}
                    </span>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>

          {weekDays.map((day, dayIndex) => {
            const dayBlocks = getBlocksForDay(dayIndex);
            const dayEvents = getEventsForDay(dayIndex);
            const isDayToday = isToday(day);

            return (
              <div
                key={dayIndex}
                className={cn(
                  "border-r relative",
                  isDayToday && "bg-primary/5"
                )}
              >
                <div className={cn(
                  "h-12 border-b flex flex-col items-center justify-center",
                  isDayToday && "bg-primary text-primary-foreground"
                )}>
                  <span className="text-xs font-semibold uppercase">
                    {format(day, 'EEE')}
                  </span>
                  <span className={cn(
                    "text-lg font-bold",
                    isDayToday && "text-primary-foreground"
                  )}>
                    {format(day, 'd')}
                  </span>
                </div>

                <ScrollArea className="h-[calc(100%-3rem)]">
                  <div
                    ref={gridRef}
                    className="relative"
                    style={{ height: HOURS.length * HOUR_HEIGHT }}
                    onDragOver={(e) => e.preventDefault()}
                  >
                    {HOURS.map((hour, hourIndex) => (
                      <div
                        key={hour}
                        className="absolute left-0 right-0 border-b border-border/30 hover:bg-accent/10 transition-colors cursor-pointer"
                        style={{
                          top: hourIndex * HOUR_HEIGHT,
                          height: HOUR_HEIGHT,
                        }}
                        onDrop={(e) => handleDrop(dayIndex, hour, e)}
                        onClick={() => {
                          setFormData({
                            ...formData,
                            startTime: `${String(hour).padStart(2, '0')}:00`,
                            endTime: `${String(hour + 1).padStart(2, '0')}:00`,
                          });
                          setIsDialogOpen(true);
                        }}
                      />
                    ))}

                    {isDayToday && currentTimePos !== null && (
                      <motion.div
                        className="absolute left-0 right-0 z-30 pointer-events-none"
                        style={{ top: currentTimePos }}
                        animate={{ top: currentTimePos }}
                        transition={{ type: 'tween', duration: 0.5 }}
                      >
                        <div className="flex items-center">
                          <div className="w-2 h-2 rounded-full bg-red-500 shadow-lg shadow-red-500/50 -ml-1"></div>
                          <div className="flex-1 h-0.5 bg-red-500/70"></div>
                        </div>
                      </motion.div>
                    )}

                    <AnimatePresence>
                      {dayBlocks.map((block) => {
                        const { top, height } = getBlockPosition(block);
                        const todo = block.todoId ? todos.find(t => t.id === block.todoId) : null;
                        const project = block.projectId ? projects.find(p => p.id === block.projectId) : null;

                        return (
                          <motion.div
                            key={block.id}
                            className={cn(
                              "absolute left-1 right-1 rounded-lg p-2 cursor-move group border-2 shadow-sm",
                              "hover:shadow-md hover:z-20 transition-all duration-200"
                            )}
                            style={{
                              top,
                              height: Math.max(height, 40),
                              backgroundColor: block.color + '25',
                              borderColor: block.color,
                            }}
                            draggable
                            onDragStart={() => setDraggedBlock(block)}
                            onDragEnd={() => setDraggedBlock(null)}
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingBlock(block);
                              setFormData({
                                title: block.title,
                                startTime: block.startTime,
                                endTime: block.endTime,
                                todoId: block.todoId || '',
                                projectId: block.projectId || '',
                                color: block.color,
                                autoTrack: block.autoTrack,
                              });
                              setIsDialogOpen(true);
                            }}
                            initial={{ opacity: 0, scale: 0.9 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.9 }}
                            transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                          >
                            <div className="text-xs font-semibold truncate" style={{ color: block.color }}>
                              {block.title}
                            </div>
                            <div className="text-[10px] text-foreground/60">
                              {block.startTime} - {block.endTime}
                            </div>
                            {block.autoTrack && (
                              <Badge variant="outline" className="h-3 text-[9px] px-1 mt-1">Auto</Badge>
                            )}
                          </motion.div>
                        );
                      })}

                      {dayEvents.map((event) => {
                        const eventDate = new Date(event.startsAt);
                        const hour = eventDate.getHours();
                        const minute = eventDate.getMinutes();
                        const hourIndex = HOURS.indexOf(hour);
                        
                        if (hourIndex === -1) return null;
                        
                        const top = hourIndex * HOUR_HEIGHT + (minute / 60) * HOUR_HEIGHT;

                        return (
                          <motion.div
                            key={event.id}
                            className="absolute left-1 right-1 rounded border-l-4 bg-accent/20 p-2 z-10"
                            style={{
                              top,
                              borderLeftColor: `var(--priority-${event.priority})`,
                            }}
                            initial={{ opacity: 0, x: -10 }}
                            animate={{ opacity: 1, x: 0 }}
                          >
                            <div className="flex items-center gap-1">
                              <CalendarBlank size={10} weight="fill" className="text-muted-foreground flex-shrink-0" />
                              <span className="text-[10px] font-medium truncate">{event.title}</span>
                            </div>
                          </motion.div>
                        );
                      })}
                    </AnimatePresence>
                  </div>
                </ScrollArea>
              </div>
            );
          })}
        </div>
      </Card>

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
              <Label htmlFor="project">Project (optional)</Label>
              <Select
                value={formData.projectId}
                onValueChange={(val) => setFormData({ ...formData, projectId: val })}
              >
                <SelectTrigger id="project">
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">None</SelectItem>
                  {projects.map((project) => (
                    <SelectItem key={project.id} value={project.id}>
                      {project.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

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
                      "w-10 h-10 rounded-lg border-2 transition-all hover:scale-110",
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

      <Dialog open={isPresetDialogOpen} onOpenChange={setIsPresetDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Apply Recurring Presets</DialogTitle>
          </DialogHeader>
          
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Choose a preset to quickly add recurring time blocks to your week
            </p>
            
            <div className="grid gap-3">
              {DEFAULT_PRESETS.map((preset) => (
                <motion.div
                  key={preset.id}
                  className="p-4 rounded-lg border bg-card hover:bg-accent/5 transition-colors cursor-pointer group"
                  onClick={() => applyPreset(preset)}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <div
                          className="w-4 h-4 rounded-full"
                          style={{ backgroundColor: preset.color }}
                        />
                        <h4 className="font-semibold">{preset.name}</h4>
                        {preset.autoTrack && (
                          <Badge variant="outline" className="h-5 text-xs">Auto-track</Badge>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground mb-1">
                        {preset.startTime} - {preset.endTime}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Applies to: {preset.days.map(d => DAY_NAMES[d].slice(0, 3)).join(', ')}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={(e) => {
                        e.stopPropagation();
                        applyPreset(preset);
                      }}
                    >
                      <Copy size={16} />
                    </Button>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
