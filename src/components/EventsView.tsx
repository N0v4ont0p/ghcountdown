import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Event } from '@/db/schema';
import { getAllEvents, createEvent, updateEvent, deleteEvent } from '@/db/repositories/eventsRepo';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Plus, CalendarBlank, Tag, Trash, Pencil } from '@phosphor-icons/react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

const ALL_DAY_EVENT_HOUR = 12;

function toLocalDateInputValue(isoString: string) {
  const date = new Date(isoString);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function toLocalDateTimeInputValue(isoString: string) {
  const date = new Date(isoString);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function toEventStartIso(startsAt: string, allDay: boolean): string | null {
  if (!startsAt) return null;

  if (allDay) {
    const datePart = startsAt.split('T')[0];
    const [year, month, day] = datePart.split('-').map(Number);
    const normalizedDate = new Date(year, month - 1, day, ALL_DAY_EVENT_HOUR, 0, 0, 0);
    return Number.isNaN(normalizedDate.getTime()) ? null : normalizedDate.toISOString();
  }

  const normalizedDateTime = new Date(
    startsAt.includes('T') ? startsAt : `${startsAt}T${String(ALL_DAY_EVENT_HOUR).padStart(2, '0')}:00`
  );
  return Number.isNaN(normalizedDateTime.getTime()) ? null : normalizedDateTime.toISOString();
}

function normalizeStartsAtForAllDayToggle(previousStartsAt: string, checked: boolean) {
  if (checked) {
    return previousStartsAt.split('T')[0];
  }

  if (previousStartsAt.includes('T')) {
    return previousStartsAt;
  }

  if (!previousStartsAt) {
    return '';
  }

  return `${previousStartsAt}T${String(ALL_DAY_EVENT_HOUR).padStart(2, '0')}:00`;
}

export function EventsView() {
  const [events, setEvents] = useState<Event[]>([]);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<Event | null>(null);
  const [filterPriority, setFilterPriority] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [eventToDelete, setEventToDelete] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    title: '',
    startsAt: '',
    allDay: false,
    priority: 3 as 1 | 2 | 3 | 4 | 5,
    tags: '',
    notes: '',
  });

  useEffect(() => {
    loadEvents();
  }, []);

  async function loadEvents() {
    const allEvents = await getAllEvents();
    setEvents(allEvents.sort((a, b) => a.startsAt.localeCompare(b.startsAt)));
  }

  function resetForm() {
    setFormData({
      title: '',
      startsAt: '',
      allDay: false,
      priority: 3,
      tags: '',
      notes: '',
    });
    setEditingEvent(null);
  }

  function handleEdit(event: Event) {
    setEditingEvent(event);
    setFormData({
      title: event.title,
      startsAt: event.allDay ? toLocalDateInputValue(event.startsAt) : toLocalDateTimeInputValue(event.startsAt),
      allDay: event.allDay,
      priority: event.priority,
      tags: event.tags.join(', '),
      notes: event.notes,
    });
    setIsDialogOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!formData.title || !formData.startsAt) {
      toast.error('Please fill in required fields');
      return;
    }

    const tags = formData.tags
      .split(',')
      .map(t => t.trim())
      .filter(Boolean);
    const startsAtIso = toEventStartIso(formData.startsAt, formData.allDay);

    if (!startsAtIso) {
      toast.error('Invalid date/time selected');
      return;
    }

    try {
      if (editingEvent) {
        await updateEvent(editingEvent.id, {
          title: formData.title,
          startsAt: startsAtIso,
          allDay: formData.allDay,
          priority: formData.priority,
          tags,
          notes: formData.notes,
        });
        toast.success('Event updated');
      } else {
        await createEvent({
          title: formData.title,
          startsAt: startsAtIso,
          allDay: formData.allDay,
          priority: formData.priority,
          tags,
          notes: formData.notes,
        });
        toast.success('Event created');
      }
      
      setIsDialogOpen(false);
      resetForm();
      loadEvents();
    } catch (error) {
      toast.error('Failed to save event');
    }
  }

  function handleDeleteClick(id: string) {
    setEventToDelete(id);
    setDeleteConfirmOpen(true);
  }

  async function handleDeleteConfirm() {
    if (!eventToDelete) return;
    try {
      await deleteEvent(eventToDelete);
      toast.success('Event deleted');
      await loadEvents();
    } catch (error) {
      toast.error('Failed to delete event');
    } finally {
      setEventToDelete(null);
    }
  }

  const filteredEvents = events.filter(event => {
    const matchesSearch = event.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      event.tags.some(tag => tag.toLowerCase().includes(searchQuery.toLowerCase()));
    const matchesPriority = filterPriority === 'all' || event.priority === parseInt(filterPriority);
    return matchesSearch && matchesPriority;
  });

  const upcomingEvents = filteredEvents.filter(e => new Date(e.startsAt) > new Date());
  const pastEvents = filteredEvents.filter(e => new Date(e.startsAt) <= new Date());

  const priorityColors: Record<1 | 2 | 3 | 4 | 5, string> = {
    5: 'border-l-[var(--priority-5)]',
    4: 'border-l-[var(--priority-4)]',
    3: 'border-l-[var(--priority-3)]',
    2: 'border-l-[var(--priority-2)]',
    1: 'border-l-[var(--priority-1)]',
  };

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-6">
        <h2 className="text-3xl font-semibold mb-2">Events</h2>
        <p className="text-muted-foreground">Manage your important deadlines and milestones</p>
      </div>

      <div className="flex flex-col sm:flex-row gap-4 mb-6">
        <div className="flex-1">
          <Input
            placeholder="Search events or tags..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full"
          />
        </div>
        
        <Select value={filterPriority} onValueChange={setFilterPriority}>
          <SelectTrigger className="w-full sm:w-48">
            <SelectValue placeholder="Filter by priority" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Priorities</SelectItem>
            <SelectItem value="5">Priority 5</SelectItem>
            <SelectItem value="4">Priority 4</SelectItem>
            <SelectItem value="3">Priority 3</SelectItem>
            <SelectItem value="2">Priority 2</SelectItem>
            <SelectItem value="1">Priority 1</SelectItem>
          </SelectContent>
        </Select>

        <Dialog open={isDialogOpen} onOpenChange={(open) => {
          setIsDialogOpen(open);
          if (!open) resetForm();
        }}>
          <DialogTrigger asChild>
            <Button className="gap-2">
              <Plus size={16} weight="bold" />
              Add Event
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>{editingEvent ? 'Edit Event' : 'Create New Event'}</DialogTitle>
            </DialogHeader>
            
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <Label htmlFor="title">Event Title *</Label>
                <Input
                  id="title"
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  placeholder="Product launch, team meeting..."
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="startsAt">{formData.allDay ? 'Date *' : 'Date & Time *'}</Label>
                  <Input
                    id="startsAt"
                    type={formData.allDay ? 'date' : 'datetime-local'}
                    value={formData.startsAt}
                    onChange={(e) => setFormData({ ...formData, startsAt: e.target.value })}
                    required
                  />
                </div>

                <div>
                  <Label htmlFor="priority">Priority</Label>
                  <Select
                    value={formData.priority.toString()}
                    onValueChange={(val) => setFormData({ ...formData, priority: parseInt(val) as 1 | 2 | 3 | 4 | 5 })}
                  >
                    <SelectTrigger id="priority">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="5">5 - Critical</SelectItem>
                      <SelectItem value="4">4 - High</SelectItem>
                      <SelectItem value="3">3 - Medium</SelectItem>
                      <SelectItem value="2">2 - Low</SelectItem>
                      <SelectItem value="1">1 - Minimal</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="flex items-center space-x-2">
                <Switch
                  id="allDay"
                  checked={formData.allDay}
                  onCheckedChange={(checked) => {
                    setFormData((previous) => {
                      const normalizedStartsAt = normalizeStartsAtForAllDayToggle(previous.startsAt, checked);
                      return { ...previous, allDay: checked, startsAt: normalizedStartsAt };
                    });
                  }}
                />
                <Label htmlFor="allDay">All-day event</Label>
              </div>

              <div>
                <Label htmlFor="tags">Tags</Label>
                <Input
                  id="tags"
                  value={formData.tags}
                  onChange={(e) => setFormData({ ...formData, tags: e.target.value })}
                  placeholder="work, milestone, client (comma-separated)"
                />
              </div>

              <div>
                <Label htmlFor="notes">Notes</Label>
                <Textarea
                  id="notes"
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  placeholder="Additional details..."
                  rows={3}
                />
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
                  {editingEvent ? 'Update Event' : 'Create Event'}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {filteredEvents.length === 0 ? (
        <Card className="p-12 text-center">
          <CalendarBlank weight="thin" size={48} className="mx-auto mb-4 text-muted-foreground" />
          <h3 className="text-lg font-semibold mb-2">No events yet</h3>
          <p className="text-sm text-muted-foreground mb-4">
            {searchQuery || filterPriority !== 'all'
              ? 'No events match your filters'
              : 'Add your first event to get started'}
          </p>
          {!searchQuery && filterPriority === 'all' && (
            <Button onClick={() => setIsDialogOpen(true)} className="gap-2">
              <Plus size={16} weight="bold" />
              Add Your First Event
            </Button>
          )}
        </Card>
      ) : (
        <div className="space-y-6">
          {upcomingEvents.length > 0 && (
            <div>
              <h3 className="text-lg font-semibold mb-3">Upcoming</h3>
              <div className="grid gap-3">
                <AnimatePresence mode="popLayout">
                  {upcomingEvents.map((event) => (
                    <motion.div
                      key={event.id}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, x: -100 }}
                      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                    >
                      <Card className={cn(
                        "p-4 hover:shadow-md transition-all duration-300 cursor-pointer border-l-4",
                        priorityColors[event.priority]
                      )}>
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                              <h4 className="font-semibold text-lg">{event.title}</h4>
                              <Badge variant="outline" className="text-xs">
                                P{event.priority}
                              </Badge>
                              {event.allDay && (
                                <Badge variant="secondary" className="text-xs">All Day</Badge>
                              )}
                            </div>
                            
                            <p className="text-sm text-muted-foreground mb-2">
                              {format(new Date(event.startsAt), 'EEEE, MMMM d, yyyy')}
                              {!event.allDay && ` • ${format(new Date(event.startsAt), 'h:mm a')}`}
                            </p>

                            {event.tags.length > 0 && (
                              <div className="flex gap-1 flex-wrap mb-2">
                                {event.tags.map((tag) => (
                                  <Badge key={tag} variant="secondary" className="text-xs gap-1">
                                    <Tag size={10} weight="fill" />
                                    {tag}
                                  </Badge>
                                ))}
                              </div>
                            )}

                            {event.notes && (
                              <p className="text-sm text-muted-foreground line-clamp-2 mt-2">
                                {event.notes}
                              </p>
                            )}
                          </div>

                          <div className="flex gap-1 shrink-0">
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => handleEdit(event)}
                              className="h-8 w-8"
                            >
                              <Pencil size={16} />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => handleDeleteClick(event.id)}
                              className="h-8 w-8 text-destructive hover:text-destructive hover:scale-110 active:scale-95 transition-transform"
                            >
                              <Trash size={16} />
                            </Button>
                          </div>
                        </div>
                      </Card>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            </div>
          )}

          {pastEvents.length > 0 && (
            <div>
              <h3 className="text-lg font-semibold mb-3 text-muted-foreground">Past Events</h3>
              <div className="grid gap-3">
                <AnimatePresence mode="popLayout">
                  {pastEvents.map((event) => (
                    <motion.div
                      key={event.id}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, x: -100 }}
                      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                    >
                      <Card className="p-4 opacity-60 hover:opacity-100 transition-all duration-300">
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                              <h4 className="font-medium">{event.title}</h4>
                              <Badge variant="outline" className="text-xs">P{event.priority}</Badge>
                            </div>
                            
                            <p className="text-sm text-muted-foreground">
                              {format(new Date(event.startsAt), 'MMM d, yyyy')}
                              {!event.allDay && ` • ${format(new Date(event.startsAt), 'h:mm a')}`}
                            </p>
                          </div>

                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => handleDeleteClick(event.id)}
                            className="h-8 w-8 text-destructive hover:text-destructive shrink-0 hover:scale-110 active:scale-95 transition-transform"
                          >
                            <Trash size={16} />
                          </Button>
                        </div>
                      </Card>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            </div>
          )}
        </div>
      )}

      <ConfirmDialog
        open={deleteConfirmOpen}
        onOpenChange={(open) => {
          setDeleteConfirmOpen(open);
          if (!open) setEventToDelete(null);
        }}
        title="Delete Event?"
        description="Are you sure you want to delete this event? This action cannot be undone."
        actionType="delete"
        confirmText="Delete"
        cancelText="Cancel"
        onConfirm={handleDeleteConfirm}
      />
    </div>
  );
}
