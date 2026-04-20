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
  deleteAllScheduleSkeletonEntries,
  deleteScheduleSkeletonEntry,
  getAllScheduleSkeletonEntries,
  updateScheduleSkeletonEntry,
} from '@/db/repositories/scheduleSkeletonRepo';
import { getAIConfiguration } from '@/lib/aiPlanner';
import { ConfirmDialog } from '@/components/ConfirmDialog';

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
  const [clearAllConfirmOpen, setClearAllConfirmOpen] = useState(false);
  const [deleteEntryConfirmOpen, setDeleteEntryConfirmOpen] = useState(false);
  const [entryToDelete, setEntryToDelete] = useState<string | null>(null);
  const [form, setForm] = useState(getDefaultForm());

  function dispatchDataChanged() {
    const detail = { types: ['routine'] };
    window.dispatchEvent(new CustomEvent('ghc-data-changed', { detail }));
    window.dispatchEvent(new CustomEvent('app:datachange', { detail }));
  }

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
    if (form.startTime > form.endTime) { toast.error('End time must be after start time or equal for a moment entry'); return; }
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
    dispatchDataChanged();
  }

  function handleDelete(id: string) {
    setEntryToDelete(id);
    setDeleteEntryConfirmOpen(true);
  }

  async function handleDeleteConfirm() {
    if (!entryToDelete) return;
    await deleteScheduleSkeletonEntry(entryToDelete);
    toast.success('Entry removed');
    setEntryToDelete(null);
    await loadEntries();
    dispatchDataChanged();
  }

  async function handleClearAll() {
    await deleteAllScheduleSkeletonEntries();
    toast.success('Routine cleared');
    await loadEntries();
    dispatchDataChanged();
  }

  async function handleAIBuild() {
    if (!aiPrompt.trim()) return;
    setIsGenerating(true);
    try {
      const config = getAIConfiguration();

      const systemPrompt =
        'You extract weekly schedule information and return it as a JSON object. ' +
        'Return ONLY a raw JSON object with a single key "entries" whose value is an array. ' +
        'Each item in the array has these exact fields:\n' +
        '- title: string, the activity name\n' +
        '- days: array of numbers (0=Sun,1=Mon,2=Tue,3=Wed,4=Thu,5=Fri,6=Sat)\n' +
        '- startTime: string in HH:mm format\n' +
        '- endTime: string in HH:mm format\n' +
        '- kind: either "fixed" or "flex"\n\n' +
        'Example output:\n' +
        '{"entries":[' +
        '{"title":"School","days":[1,2,3,4,5],"startTime":"08:00","endTime":"15:00","kind":"fixed"},' +
        '{"title":"Rowing","days":[1,3,5],"startTime":"18:00","endTime":"20:00","kind":"fixed"}' +
        ']}';

      const requestBody = JSON.stringify({
        model: 'openai/gpt-oss-120b:cerebras',
        temperature: 0.1,
        max_tokens: 2000,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: aiPrompt },
        ],
      });

      const requestHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      };

      const endpointUrl = 'https://router.huggingface.co/v1/chat/completions';

      let responseJson: unknown = null;

      const electronAPI = typeof window !== 'undefined' && (window as { electronAPI?: { aiRequest?: (opts: { url: string; method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; body: string }> } }).electronAPI;
      if (electronAPI?.aiRequest) {
        const raw: { ok: boolean; status: number; body: string } = await electronAPI.aiRequest({
          url: endpointUrl,
          method: 'POST',
          headers: requestHeaders,
          body: requestBody,
        });
        if (!raw.ok) {
          throw new Error(`AI request failed (HTTP ${raw.status})`);
        }
        try { responseJson = JSON.parse(raw.body); } catch { /* non-JSON */ }
      } else {
        const response = await fetch(endpointUrl, {
          method: 'POST',
          headers: requestHeaders,
          body: requestBody,
        });
        if (!response.ok) {
          throw new Error(`AI request failed (HTTP ${response.status})`);
        }
        try { responseJson = await response.json(); } catch { /* non-JSON */ }
      }

      const content: string =
        (responseJson as { choices?: Array<{ message?: { content?: string } }> })?.choices?.[0]?.message?.content ?? '';

      let parsed: unknown = null;
      try { parsed = JSON.parse(content); } catch { /* invalid JSON */ }

      const entriesRaw = (parsed as { entries?: unknown[] } | null)?.entries;
      if (!Array.isArray(entriesRaw) || entriesRaw.length === 0) {
        toast.error('Could not parse routine — check your API key is set in Settings');
        return;
      }

      let created = 0;
      for (const item of entriesRaw) {
        if (!item || typeof item.title !== 'string' || !item.title.trim()) continue;
        // Use AI-provided days if valid, otherwise try text-based detection on the title, finally weekdays
        const rawDays: number[] = Array.isArray(item.days)
          ? item.days.filter((d: unknown) => typeof d === 'number' && d >= 0 && d <= 6)
          : [];
        const days: number[] = rawDays.length > 0 ? rawDays : detectDays(item.title);
        const startTime = typeof item.startTime === 'string' && /^\d{2}:\d{2}$/.test(item.startTime)
          ? item.startTime
          : '09:00';
        const endTime = typeof item.endTime === 'string' && /^\d{2}:\d{2}$/.test(item.endTime)
          ? item.endTime
          : '10:00';
        const kind: 'fixed' | 'flex' = item.kind === 'flex' ? 'flex' : 'fixed';

        // Simple hash of title to pick a stable color
        let hash = 0;
        for (let i = 0; i < item.title.length; i++) {
          hash = (hash * 31 + item.title.charCodeAt(i)) >>> 0;
        }
        const color = DEFAULT_COLORS[hash % DEFAULT_COLORS.length];

        await createScheduleSkeletonEntry({
          title: item.title.trim(),
          locationId: null,
          daysOfWeek: days.length > 0 ? days : [1, 2, 3, 4, 5],
          startTime,
          endTime,
          kind,
          color,
          notes: '',
          active: true,
        });
        created++;
      }

      if (created === 0) {
        toast.error('Could not parse routine — check your API key is set in Settings');
        return;
      }

      setIsAIOpen(false);
      setAIPrompt('');
      await loadEntries();
      dispatchDataChanged();
      toast.success('Routine built');
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      toast.error(msg || 'Could not parse routine — check your API key is set in Settings');
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
          {entries.length > 0 && (
            <Button variant="outline" size="sm" className="gap-2" onClick={() => setClearAllConfirmOpen(true)}>
              <Trash size={14} />
              Clear All
            </Button>
          )}
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
                    onClick={() => handleDelete(entry.id)}
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

      <ConfirmDialog
        open={clearAllConfirmOpen}
        onOpenChange={setClearAllConfirmOpen}
        title="Clear all routine entries?"
        description="This removes all weekly routine entries created manually or by AI."
        actionType="delete"
        confirmText="Clear All"
        cancelText="Cancel"
        onConfirm={handleClearAll}
      />

      <ConfirmDialog
        open={deleteEntryConfirmOpen}
        onOpenChange={(open) => {
          setDeleteEntryConfirmOpen(open);
          if (!open) setEntryToDelete(null);
        }}
        title="Delete routine entry?"
        description="Are you sure you want to remove this entry from your routine?"
        actionType="delete"
        confirmText="Delete"
        cancelText="Cancel"
        onConfirm={handleDeleteConfirm}
      />
    </div>
  );
}
