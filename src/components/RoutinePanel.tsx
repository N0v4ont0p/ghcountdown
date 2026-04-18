import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { PencilSimple, Trash, Sparkle } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { ScheduleSkeletonEntry } from '@/db/schema';
import {
  createScheduleSkeletonEntry,
  deleteScheduleSkeletonEntry,
  getAllScheduleSkeletonEntries,
  updateScheduleSkeletonEntry,
} from '@/db/repositories/scheduleSkeletonRepo';
import { generateActionPlan } from '@/lib/aiPlanner';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const DEFAULT_COLORS = [
  'oklch(0.58 0.20 260)',
  'oklch(0.62 0.18 160)',
  'oklch(0.65 0.18 30)',
  'oklch(0.60 0.18 320)',
  'oklch(0.62 0.15 200)',
];

interface RoutinePanelProps {
  onClose: () => void;
}

function detectDays(text: string): number[] {
  if (/weekday|mon.{0,3}fri|monday.*friday/i.test(text)) return [1, 2, 3, 4, 5];
  if (/weekend/i.test(text)) return [0, 6];
  if (/daily|every day/i.test(text)) return [0, 1, 2, 3, 4, 5, 6];

  const days: number[] = [];
  if (/\bmon/i.test(text)) days.push(1);
  if (/\btue/i.test(text)) days.push(2);
  if (/\bwed/i.test(text)) days.push(3);
  if (/\bthu/i.test(text)) days.push(4);
  if (/\bfri/i.test(text)) days.push(5);
  if (/\bsat/i.test(text)) days.push(6);
  if (/\bsun/i.test(text)) days.push(0);

  return days.length > 0 ? days.sort((a, b) => a - b) : [1, 2, 3, 4, 5];
}

function getDefaultForm() {
  return {
    title: '',
    daysOfWeek: [1, 2, 3, 4, 5] as number[],
    startTime: '09:00',
    endTime: '10:00',
    kind: 'fixed' as 'fixed' | 'flex',
    color: DEFAULT_COLORS[0],
  };
}

export function RoutinePanel({ onClose: _onClose }: RoutinePanelProps) {
  const [entries, setEntries] = useState<ScheduleSkeletonEntry[]>([]);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<ScheduleSkeletonEntry | null>(null);
  const [isAIOpen, setIsAIOpen] = useState(false);
  const [aiPrompt, setAIPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [form, setForm] = useState(getDefaultForm());

  async function loadEntries() {
    const all = await getAllScheduleSkeletonEntries();
    setEntries(all.sort((a, b) => a.startTime.localeCompare(b.startTime)));
  }

  useEffect(() => {
    void loadEntries();
  }, []);

  const entriesByDay = useMemo(() => {
    const grouped: Record<number, ScheduleSkeletonEntry[]> = {
      0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [],
    };
    for (const entry of entries) {
      for (const day of entry.daysOfWeek) {
        grouped[day].push(entry);
      }
    }
    for (let d = 0; d < 7; d++) {
      grouped[d] = grouped[d].sort((a, b) => a.startTime.localeCompare(b.startTime));
    }
    return grouped;
  }, [entries]);

  function openAdd(preselectedDay?: number) {
    setEditingEntry(null);
    setForm({
      ...getDefaultForm(),
      daysOfWeek: preselectedDay !== undefined ? [preselectedDay] : [1, 2, 3, 4, 5],
    });
    setIsAddOpen(true);
  }

  function openEdit(entry: ScheduleSkeletonEntry) {
    setEditingEntry(entry);
    setForm({
      title: entry.title,
      daysOfWeek: [...entry.daysOfWeek],
      startTime: entry.startTime,
      endTime: entry.endTime,
      kind: entry.kind,
      color: entry.color,
    });
    setIsAddOpen(true);
  }

  async function handleSave() {
    if (!form.title.trim()) { toast.error('Title is required'); return; }
    if (form.startTime >= form.endTime) { toast.error('End time must be after start time'); return; }
    if (form.daysOfWeek.length === 0) { toast.error('Pick at least one day'); return; }

    const payload = {
      title: form.title.trim(),
      locationId: null,
      daysOfWeek: form.daysOfWeek,
      startTime: form.startTime,
      endTime: form.endTime,
      kind: form.kind,
      color: form.color,
      notes: '',
      active: true,
    };

    if (editingEntry) {
      await updateScheduleSkeletonEntry(editingEntry.id, payload);
      toast.success('Entry updated');
    } else {
      await createScheduleSkeletonEntry(payload);
      toast.success('Entry added');
    }
    setIsAddOpen(false);
    setEditingEntry(null);
    await loadEntries();
  }

  async function handleDelete(id: string) {
    if (!window.confirm('Delete this routine entry?')) return;
    await deleteScheduleSkeletonEntry(id);
    toast.success('Entry removed');
    await loadEntries();
  }

  async function handleAIBuild() {
    if (!aiPrompt.trim()) return;
    setIsGenerating(true);
    try {
      const result = await generateActionPlan(
        'Create a weekly routine schedule. For each recurring activity produce a time block with the activity as the title, startTime and endTime in HH:mm 24-hour format. In the notes field write the days this activity happens as a comma separated list, for example: monday,wednesday,friday or weekdays or daily. User description: ' + aiPrompt,
        {
          todoTitles: [],
          upcomingEventTitles: [],
          recentBlockTitles: [],
          unscheduledTodayTodos: [],
          overdueTodos: [],
          currentStreak: 0,
          todayFocusMinutes: 0,
          nextEventDateTime: null,
          weeklySkeletonSummary: '',
          currentLocation: '',
          peakFocusHoursToday: [],
          typicalActivitiesNow: [],
        },
      );

      const timeBlocks = result.suggestions.filter(s => s.type === 'timeBlock');

      if (timeBlocks.length === 0) {
        throw new Error('empty response — no time blocks returned');
      }

      let created = 0;
      for (const suggestion of timeBlocks) {
        const days = detectDays(suggestion.notes ?? suggestion.title);
        const start = suggestion.startTime ?? '09:00';
        const end = suggestion.endTime ?? '10:00';
        await createScheduleSkeletonEntry({
          title: suggestion.title,
          locationId: null,
          daysOfWeek: days,
          startTime: start,
          endTime: end,
          kind: 'fixed',
          color: DEFAULT_COLORS[created % DEFAULT_COLORS.length],
          notes: suggestion.notes ?? '',
          active: true,
        });
        created++;
      }

      setIsAIOpen(false);
      setAIPrompt('');
      await loadEntries();
      toast.success('Routine built');
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (msg.toLowerCase().includes('empty')) {
        toast.error(
          'Try being more specific — e.g. "school 8am-3pm weekdays, rowing Mon Wed Fri 6-8pm, homework 4-6pm weekdays"'
        );
      } else {
        toast.error(msg || 'AI generation failed');
      }
    } finally {
      setIsGenerating(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Header row */}
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Define your normal week so Timeline can suggest what goes in free slots.
        </p>
        <div className="flex gap-2 shrink-0">
          <Button variant="outline" size="sm" className="gap-2" onClick={() => setIsAIOpen(true)}>
            <Sparkle size={14} weight="fill" />
            AI Build
          </Button>
          <Button size="sm" onClick={() => openAdd()}>+ Add Entry</Button>
        </div>
      </div>

      {/* 7-column day grid */}
      <div className="grid grid-cols-7 gap-2">
        {DAYS.map((day, dayIndex) => (
          <div key={day} className="space-y-1 min-h-[120px]">
            <p className="text-xs font-semibold text-center text-muted-foreground">{day}</p>
            {entriesByDay[dayIndex].map((entry) => (
              <div
                key={`${entry.id}-${dayIndex}`}
                className="group relative rounded border p-1.5 text-xs"
                style={{
                  borderColor: entry.color,
                  backgroundColor: `${entry.color}18`,
                  borderStyle: entry.kind === 'flex' ? 'dashed' : 'solid',
                }}
              >
                <p className="font-medium truncate leading-tight">{entry.title}</p>
                <p className="text-muted-foreground leading-tight">
                  {entry.startTime}–{entry.endTime}
                </p>
                <div className="absolute top-0.5 right-0.5 hidden group-hover:flex gap-0.5">
                  <button
                    type="button"
                    className="p-0.5 rounded bg-background/80 hover:bg-background"
                    onClick={() => openEdit(entry)}
                  >
                    <PencilSimple size={10} />
                  </button>
                  <button
                    type="button"
                    className="p-0.5 rounded bg-background/80 hover:bg-background text-destructive"
                    onClick={() => void handleDelete(entry.id)}
                  >
                    <Trash size={10} />
                  </button>
                </div>
              </div>
            ))}
            <button
              type="button"
              className="w-full text-xs text-muted-foreground hover:text-foreground py-1"
              onClick={() => openAdd(dayIndex)}
            >
              + Add
            </button>
          </div>
        ))}
      </div>

      {/* Add / Edit dialog */}
      <Dialog open={isAddOpen} onOpenChange={(open) => { setIsAddOpen(open); if (!open) setEditingEntry(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingEntry ? 'Edit Entry' : 'Add Routine Entry'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Title</Label>
              <Input
                value={form.title}
                onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))}
                placeholder="School, Gym, Deep Focus…"
              />
            </div>

            <div>
              <Label>Days</Label>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {DAYS.map((day, idx) => {
                  const selected = form.daysOfWeek.includes(idx);
                  return (
                    <Button
                      key={day}
                      type="button"
                      size="sm"
                      variant={selected ? 'default' : 'outline'}
                      className="h-7 px-2"
                      onClick={() =>
                        setForm((prev) => ({
                          ...prev,
                          daysOfWeek: selected
                            ? prev.daysOfWeek.filter((d) => d !== idx)
                            : [...prev.daysOfWeek, idx].sort((a, b) => a - b),
                        }))
                      }
                    >
                      {day}
                    </Button>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Start</Label>
                <Input
                  type="time"
                  value={form.startTime}
                  onChange={(e) => setForm((prev) => ({ ...prev, startTime: e.target.value }))}
                />
              </div>
              <div>
                <Label>End</Label>
                <Input
                  type="time"
                  value={form.endTime}
                  onChange={(e) => setForm((prev) => ({ ...prev, endTime: e.target.value }))}
                />
              </div>
            </div>

            <div>
              <Label>Kind</Label>
              <div className="flex gap-2 mt-1">
                {(['fixed', 'flex'] as const).map((k) => (
                  <Button
                    key={k}
                    type="button"
                    size="sm"
                    variant={form.kind === k ? 'default' : 'outline'}
                    onClick={() => setForm((prev) => ({ ...prev, kind: k }))}
                  >
                    {k === 'fixed' ? 'Fixed' : 'Flex'}
                  </Button>
                ))}
              </div>
            </div>

            <div>
              <Label>Color</Label>
              <div className="flex gap-2 mt-1 flex-wrap">
                {DEFAULT_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className="w-6 h-6 rounded-full border-2 transition-all"
                    style={{
                      backgroundColor: c,
                      borderColor: form.color === c ? 'white' : 'transparent',
                      outline: form.color === c ? `2px solid ${c}` : 'none',
                    }}
                    onClick={() => setForm((prev) => ({ ...prev, color: c }))}
                  />
                ))}
                <Input
                  value={form.color}
                  onChange={(e) => setForm((prev) => ({ ...prev, color: e.target.value }))}
                  className="h-6 w-40 text-xs px-2"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => { setIsAddOpen(false); setEditingEntry(null); }}>
                Cancel
              </Button>
              <Button onClick={() => void handleSave()}>
                {editingEntry ? 'Update' : 'Add'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* AI Build dialog */}
      <Dialog open={isAIOpen} onOpenChange={setIsAIOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>AI Build Routine</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Describe your typical week and AI will generate routine entries.
            </p>
            <Textarea
              value={aiPrompt}
              onChange={(e) => setAIPrompt(e.target.value)}
              placeholder="e.g. I go to school Mon–Fri 8–15, gym on Mon/Wed/Fri evenings, deep work block every morning…"
              rows={5}
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setIsAIOpen(false)}>Cancel</Button>
              <Button onClick={() => void handleAIBuild()} disabled={isGenerating || !aiPrompt.trim()} className="gap-2">
                <Sparkle size={14} weight="fill" />
                {isGenerating ? 'Generating…' : 'Generate'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {entries.length === 0 && (
        <Card className="p-6 text-center">
          <p className="text-sm text-muted-foreground">
            No routine entries yet. Add one manually or use AI Build.
          </p>
        </Card>
      )}

      {/* Summary badge */}
      {entries.length > 0 && (
        <div className="flex items-center gap-2 pt-1">
          <Badge variant="secondary">{entries.length} entries</Badge>
        </div>
      )}
    </div>
  );
}
