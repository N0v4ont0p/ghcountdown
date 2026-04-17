import { useEffect, useMemo, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Sparkle, Trash, PencilSimple } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { Location, ScheduleSkeletonEntry } from '@/db/schema';
import {
  createLocation,
  deleteLocation,
  getAllLocations,
  updateLocation,
} from '@/db/repositories/locationsRepo';
import {
  createScheduleSkeletonEntry,
  deleteScheduleSkeletonEntry,
  getAllScheduleSkeletonEntries,
  updateScheduleSkeletonEntry,
} from '@/db/repositories/scheduleSkeletonRepo';
import { getHabitModel } from '@/lib/habitModel';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function ScheduleSkeletonView() {
  const [locations, setLocations] = useState<Location[]>([]);
  const [entries, setEntries] = useState<ScheduleSkeletonEntry[]>([]);
  const [isBuilding, setIsBuilding] = useState(false);

  const [editingLocationId, setEditingLocationId] = useState<string | null>(null);
  const [locationForm, setLocationForm] = useState({ name: '', icon: '📍', color: 'oklch(0.62 0.15 250)' });

  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [entryForm, setEntryForm] = useState({
    title: '',
    locationId: 'none',
    daysOfWeek: [1, 2, 3, 4, 5] as number[],
    startTime: '09:00',
    endTime: '10:00',
    kind: 'fixed' as 'fixed' | 'flex',
    color: 'oklch(0.58 0.20 260)',
    notes: '',
    active: true,
  });

  const entriesByDay = useMemo(() => {
    const grouped: Record<number, ScheduleSkeletonEntry[]> = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
    for (const entry of entries) {
      for (const day of entry.daysOfWeek) {
        grouped[day].push(entry);
      }
    }
    for (let day = 0; day < 7; day++) {
      grouped[day] = grouped[day].sort((a, b) => a.startTime.localeCompare(b.startTime));
    }
    return grouped;
  }, [entries]);

  useEffect(() => {
    void loadData();
  }, []);

  async function loadData() {
    const [allLocations, allEntries] = await Promise.all([
      getAllLocations(),
      getAllScheduleSkeletonEntries(),
    ]);

    setLocations(allLocations.sort((a, b) => a.name.localeCompare(b.name)));
    setEntries(allEntries.sort((a, b) => a.startTime.localeCompare(b.startTime)));
  }

  function resetLocationForm() {
    setEditingLocationId(null);
    setLocationForm({ name: '', icon: '📍', color: 'oklch(0.62 0.15 250)' });
  }

  function resetEntryForm() {
    setEditingEntryId(null);
    setEntryForm({
      title: '',
      locationId: 'none',
      daysOfWeek: [1, 2, 3, 4, 5],
      startTime: '09:00',
      endTime: '10:00',
      kind: 'fixed',
      color: 'oklch(0.58 0.20 260)',
      notes: '',
      active: true,
    });
  }

  async function handleSaveLocation(e: React.FormEvent) {
    e.preventDefault();
    if (!locationForm.name.trim()) {
      toast.error('Location name is required');
      return;
    }

    if (editingLocationId) {
      await updateLocation(editingLocationId, {
        name: locationForm.name.trim(),
        icon: locationForm.icon || '📍',
        color: locationForm.color,
      });
      toast.success('Location updated');
    } else {
      await createLocation({
        name: locationForm.name.trim(),
        icon: locationForm.icon || '📍',
        color: locationForm.color,
      });
      toast.success('Location created');
    }

    resetLocationForm();
    await loadData();
  }

  async function handleDeleteLocation(id: string) {
    await deleteLocation(id);
    setEntries((prev) => prev.map((entry) => (entry.locationId === id ? { ...entry, locationId: null } : entry)));
    toast.success('Location deleted');
    await loadData();
  }

  async function handleSaveEntry(e: React.FormEvent) {
    e.preventDefault();
    if (!entryForm.title.trim()) {
      toast.error('Routine title is required');
      return;
    }
    if (entryForm.startTime >= entryForm.endTime) {
      toast.error('End time must be after start time');
      return;
    }
    if (entryForm.daysOfWeek.length === 0) {
      toast.error('Pick at least one day');
      return;
    }

    const payload = {
      title: entryForm.title.trim(),
      locationId: entryForm.locationId === 'none' ? null : entryForm.locationId,
      daysOfWeek: entryForm.daysOfWeek,
      startTime: entryForm.startTime,
      endTime: entryForm.endTime,
      kind: entryForm.kind,
      color: entryForm.color,
      notes: entryForm.notes,
      active: entryForm.active,
    };

    if (editingEntryId) {
      await updateScheduleSkeletonEntry(editingEntryId, payload);
      toast.success('Routine entry updated');
    } else {
      await createScheduleSkeletonEntry(payload);
      toast.success('Routine entry added');
    }

    resetEntryForm();
    await loadData();
  }

  async function handleDeleteEntry(id: string) {
    await deleteScheduleSkeletonEntry(id);
    toast.success('Routine entry removed');
    await loadData();
  }

  async function handleBuildRoutine() {
    setIsBuilding(true);
    try {
      const model = await getHabitModel();
      const peakHours = model.dailyRhythms.peakFocusHours.length ? model.dailyRhythms.peakFocusHours : [9, 14, 19];
      const topHours = peakHours.slice(0, 3);

      const generated: Array<Omit<ScheduleSkeletonEntry, 'id' | 'createdAt' | 'updatedAt'>> = topHours.map((hour, index) => ({
        title: index === 0 ? 'Deep Focus' : index === 1 ? 'Flex Work' : 'Review + Wrap',
        locationId: null,
        daysOfWeek: [1, 2, 3, 4, 5],
        startTime: `${String(hour).padStart(2, '0')}:00`,
        endTime: `${String((hour + 1) % 24).padStart(2, '0')}:00`,
        kind: index === 1 ? 'flex' : 'fixed',
        color: index === 1 ? 'oklch(0.70 0.14 220)' : 'oklch(0.58 0.20 260)',
        notes: 'AI-generated from habit model',
        active: true,
      }));

      for (const item of generated) {
        const exists = entries.some(
          (entry) =>
            entry.title === item.title &&
            entry.startTime === item.startTime &&
            entry.endTime === item.endTime &&
            entry.daysOfWeek.join(',') === item.daysOfWeek.join(',')
        );
        if (!exists) {
          await createScheduleSkeletonEntry(item);
        }
      }

      toast.success('AI routine built from your habit model');
      await loadData();
    } finally {
      setIsBuilding(false);
    }
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-semibold mb-1">Routine</h2>
          <p className="text-muted-foreground">Recurring weekly skeleton + location awareness.</p>
        </div>
        <Button onClick={handleBuildRoutine} disabled={isBuilding} className="gap-2">
          <Sparkle size={16} weight="fill" />
          {isBuilding ? 'Building…' : 'Build Routine'}
        </Button>
      </div>

      <Tabs defaultValue="skeleton" className="space-y-4">
        <TabsList>
          <TabsTrigger value="skeleton">Weekly Skeleton</TabsTrigger>
          <TabsTrigger value="locations">Locations</TabsTrigger>
        </TabsList>

        <TabsContent value="skeleton" className="space-y-4">
          <Card className="p-4">
            <form className="space-y-4" onSubmit={handleSaveEntry}>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <div className="md:col-span-2">
                  <Label htmlFor="routine-title">Title</Label>
                  <Input
                    id="routine-title"
                    value={entryForm.title}
                    onChange={(e) => setEntryForm((prev) => ({ ...prev, title: e.target.value }))}
                    placeholder="School, Rowing, Flex Work..."
                    required
                  />
                </div>

                <div>
                  <Label htmlFor="routine-start">Start</Label>
                  <Input
                    id="routine-start"
                    type="time"
                    value={entryForm.startTime}
                    onChange={(e) => setEntryForm((prev) => ({ ...prev, startTime: e.target.value }))}
                    required
                  />
                </div>

                <div>
                  <Label htmlFor="routine-end">End</Label>
                  <Input
                    id="routine-end"
                    type="time"
                    value={entryForm.endTime}
                    onChange={(e) => setEntryForm((prev) => ({ ...prev, endTime: e.target.value }))}
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <div>
                  <Label>Kind</Label>
                  <Select value={entryForm.kind} onValueChange={(value) => setEntryForm((prev) => ({ ...prev, kind: value as 'fixed' | 'flex' }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="fixed">Fixed</SelectItem>
                      <SelectItem value="flex">Flex</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label>Location</Label>
                  <Select value={entryForm.locationId} onValueChange={(value) => setEntryForm((prev) => ({ ...prev, locationId: value }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      {locations.map((location) => (
                        <SelectItem key={location.id} value={location.id}>{location.icon} {location.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label htmlFor="routine-color">Color</Label>
                  <Input
                    id="routine-color"
                    value={entryForm.color}
                    onChange={(e) => setEntryForm((prev) => ({ ...prev, color: e.target.value }))}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="routine-active">Active</Label>
                  <div className="h-10 flex items-center">
                    <Switch id="routine-active" checked={entryForm.active} onCheckedChange={(checked) => setEntryForm((prev) => ({ ...prev, active: checked }))} />
                  </div>
                </div>
              </div>

              <div>
                <Label>Days</Label>
                <div className="flex flex-wrap gap-2 mt-2">
                  {DAYS.map((day, index) => {
                    const selected = entryForm.daysOfWeek.includes(index);
                    return (
                      <Button
                        key={day}
                        type="button"
                        variant={selected ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => {
                          setEntryForm((prev) => ({
                            ...prev,
                            daysOfWeek: selected
                              ? prev.daysOfWeek.filter((d) => d !== index)
                              : [...prev.daysOfWeek, index].sort((a, b) => a - b),
                          }));
                        }}
                      >
                        {day}
                      </Button>
                    );
                  })}
                </div>
              </div>

              <div>
                <Label htmlFor="routine-notes">Notes</Label>
                <Textarea
                  id="routine-notes"
                  value={entryForm.notes}
                  onChange={(e) => setEntryForm((prev) => ({ ...prev, notes: e.target.value }))}
                  placeholder="Optional details"
                />
              </div>

              <div className="flex gap-2 justify-end">
                {editingEntryId && (
                  <Button type="button" variant="outline" onClick={resetEntryForm}>Cancel edit</Button>
                )}
                <Button type="submit">{editingEntryId ? 'Update Entry' : 'Add Entry'}</Button>
              </div>
            </form>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-7 gap-3">
            {DAYS.map((day, dayIndex) => (
              <Card key={day} className="p-3 space-y-2 min-h-56">
                <h3 className="font-semibold text-sm">{day}</h3>
                {entriesByDay[dayIndex]?.length ? entriesByDay[dayIndex].map((entry) => {
                  const location = entry.locationId ? locations.find((item) => item.id === entry.locationId) : null;
                  return (
                    <div
                      key={`${entry.id}-${dayIndex}`}
                      className="rounded-md border p-2 text-xs space-y-1"
                      style={{ borderColor: entry.color, backgroundColor: `${entry.color}18` }}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium truncate">{entry.title}</span>
                        <Badge variant="outline" className="h-4 px-1 text-[10px]">{entry.kind}</Badge>
                      </div>
                      <p className="text-muted-foreground">{entry.startTime} - {entry.endTime}</p>
                      {location && <p className="text-muted-foreground">{location.icon} {location.name}</p>}
                      <div className="flex justify-end gap-1 pt-1">
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="h-6 w-6"
                          onClick={() => {
                            setEditingEntryId(entry.id);
                            setEntryForm({
                              title: entry.title,
                              locationId: entry.locationId ?? 'none',
                              daysOfWeek: [...entry.daysOfWeek],
                              startTime: entry.startTime,
                              endTime: entry.endTime,
                              kind: entry.kind,
                              color: entry.color,
                              notes: entry.notes,
                              active: entry.active,
                            });
                          }}
                        >
                          <PencilSimple size={12} />
                        </Button>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="h-6 w-6 text-destructive"
                          onClick={() => void handleDeleteEntry(entry.id)}
                        >
                          <Trash size={12} />
                        </Button>
                      </div>
                    </div>
                  );
                }) : (
                  <p className="text-xs text-muted-foreground">No entries</p>
                )}
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="locations" className="space-y-4">
          <Card className="p-4">
            <form className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end" onSubmit={handleSaveLocation}>
              <div>
                <Label htmlFor="location-name">Name</Label>
                <Input
                  id="location-name"
                  value={locationForm.name}
                  onChange={(e) => setLocationForm((prev) => ({ ...prev, name: e.target.value }))}
                  placeholder="Library"
                  required
                />
              </div>
              <div>
                <Label htmlFor="location-icon">Icon</Label>
                <Input
                  id="location-icon"
                  value={locationForm.icon}
                  onChange={(e) => setLocationForm((prev) => ({ ...prev, icon: e.target.value }))}
                  placeholder="📚"
                />
              </div>
              <div>
                <Label htmlFor="location-color">Color</Label>
                <Input
                  id="location-color"
                  value={locationForm.color}
                  onChange={(e) => setLocationForm((prev) => ({ ...prev, color: e.target.value }))}
                />
              </div>
              <div className="flex gap-2 justify-end">
                {editingLocationId && (
                  <Button type="button" variant="outline" onClick={resetLocationForm}>Cancel</Button>
                )}
                <Button type="submit">{editingLocationId ? 'Update' : 'Add'}</Button>
              </div>
            </form>
          </Card>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {locations.map((location) => (
              <Card key={location.id} className="p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-base" aria-hidden="true">{location.icon}</span>
                    <span className="truncate font-medium">{location.name}</span>
                  </div>
                  <Badge variant="outline" style={{ borderColor: location.color }}>{location.color}</Badge>
                </div>
                <div className="flex justify-end gap-1 mt-3">
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    onClick={() => {
                      setEditingLocationId(location.id);
                      setLocationForm({ name: location.name, icon: location.icon, color: location.color });
                    }}
                  >
                    <PencilSimple size={14} />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 text-destructive"
                    onClick={() => void handleDeleteLocation(location.id)}
                  >
                    <Trash size={14} />
                  </Button>
                </div>
              </Card>
            ))}
            {locations.length === 0 && (
              <Card className="p-4 md:col-span-2 lg:col-span-3">
                <p className="text-sm text-muted-foreground">No locations yet. Add one to make routines location-aware.</p>
              </Card>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
