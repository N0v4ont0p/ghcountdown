import { useMemo, useState, useEffect, useRef } from 'react';
import {
  Sparkle, Lightning, WarningCircle, CheckCircle, WifiSlash,
  SlidersHorizontal, PaperPlaneTilt, CalendarPlus, CheckSquare,
  Timer, ArrowsCounterClockwise,
} from '@phosphor-icons/react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { getAllTodos, createTodo, getTodosByStatus } from '@/db/repositories/todosRepo';
import { getAllEvents, createEvent } from '@/db/repositories/eventsRepo';
import { getAllTimeBlocks, createTimeBlock, getTimeBlocksByDate } from '@/db/repositories/timeBlocksRepo';
import { getAllTimeEntries } from '@/db/repositories/timeRepo';
import { updateSettings } from '@/db/repositories/settingsRepo';
import { getActiveGoals } from '@/db/repositories/goalsRepo';
import {
  AIMode,
  AIAssistantResult,
  AISuggestion,
  generateActionPlan,
  getAIConfiguration,
  updateAIConfiguration,
} from '@/lib/aiPlanner';
import { scheduleMyDay } from '@/lib/schedulingUtils';
import { format } from 'date-fns';
import { getCurrentLocation, getEffectiveScheduleForDate } from '@/lib/effectiveSchedule';
import { getHabitModel, predictActivity } from '@/lib/habitModel';

const AI_MODE_STORAGE_KEY = 'ghcountdown.ai.defaultMode';

/**
 * Phrases that trigger deterministic scheduling instead of the AI API.
 * Matches (with or without "my"): "schedule todos", "schedule my todos",
 * "schedule tasks", "schedule my tasks", "schedule my day", "plan my day".
 * Uses non-greedy `.*?` to avoid spanning multiple unrelated sentences.
 */
const SCHEDULE_INTENT_RE = /\bschedule\b.*?\b(my\s+)?(todos?|tasks?|day)\b|\bplan\s+my\s+day\b/i;

interface AIAssistantViewProps {
  compact?: boolean;
}

type ChangedDataType = 'todos' | 'events' | 'timeBlocks';

function readSavedMode(): AIMode {
  if (typeof window === 'undefined') return 'plan';
  const saved = window.localStorage.getItem(AI_MODE_STORAGE_KEY);
  return saved === 'agent' ? 'agent' : 'plan';
}


export function AIAssistantView({ compact = false }: AIAssistantViewProps) {
  const [prompt, setPrompt] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [mode, setMode] = useState<AIMode>(readSavedMode());
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isApplyingAll, setIsApplyingAll] = useState(false);
  const [result, setResult] = useState<AIAssistantResult | null>(null);
  const [appliedIds, setAppliedIds] = useState<string[]>([]);
  const [isCompactSettingsOpen, setIsCompactSettingsOpen] = useState(false);
  const [keyCheckDone, setKeyCheckDone] = useState(false);
  const resultRef = useRef<HTMLDivElement | null>(null);

  const hasApiKey = apiKey.trim().length > 0;

  useEffect(() => {
    const config = getAIConfiguration();
    setApiKey(config.apiKey);
    setMode(readSavedMode());

    // App.tsx initialize() is async — if the key is empty on first read,
    // retry after 500ms to let IndexedDB settings load into the runtime config.
    if (!config.apiKey) {
      const timer = setTimeout(() => {
        const retried = getAIConfiguration();
        if (retried.apiKey) setApiKey(retried.apiKey);
      }, 500);
      return () => clearTimeout(timer);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setKeyCheckDone(true), 600);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  useEffect(() => {
    window.localStorage.setItem(AI_MODE_STORAGE_KEY, mode);
  }, [mode]);

  useEffect(() => {
    if (compact && result && resultRef.current) {
      resultRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [compact, result]);

  const aiReady = isOnline && hasApiKey;
  const confidencePercent = useMemo(
    () => (result ? Math.round(result.confidence * 100) : 0),
    [result]
  );

  function handleSaveAIConfig() {
    const trimmedApiKey = apiKey.trim();
    updateAIConfiguration({ apiKey: trimmedApiKey });
    updateSettings({ aiApiKey: trimmedApiKey });
    if (trimmedApiKey) {
      toast.success('AI credentials saved');
    } else {
      toast.success('AI key cleared');
    }
  }

  function dispatchDataChanged(types: Set<ChangedDataType>) {
    if (types.size === 0) return;
    const detail = { types: Array.from(types) };
    window.dispatchEvent(new CustomEvent('ghc-data-changed', { detail }));
    window.dispatchEvent(new CustomEvent('app:datachange', { detail }));
  }

  async function handleGenerate() {
    if (!prompt.trim()) {
      toast.error('Enter a prompt first');
      return;
    }

    if (!isOnline) {
      toast.error('No internet connection — AI unavailable');
      return;
    }

    updateAIConfiguration({ apiKey: apiKey.trim() });
    updateSettings({ aiApiKey: apiKey.trim() });

    // Detect scheduling intent — runs the same deterministic logic as "Schedule My Day"
    const isSchedulingIntent = SCHEDULE_INTENT_RE.test(prompt.trim());
    if (isSchedulingIntent) {
      setIsGenerating(true);
      try {
        const today = format(new Date(), 'yyyy-MM-dd');
        const [todayTodos, todayBlocks] = await Promise.all([
          getTodosByStatus('today'),
          getTimeBlocksByDate(today),
        ]);
        const scheduledIds = new Set(todayBlocks.map(b => b.todoId).filter(Boolean) as string[]);
        const unscheduled = todayTodos.filter(t => !scheduledIds.has(t.id));
        const created = await scheduleMyDay(today, unscheduled, todayBlocks);
        if (created > 0) {
          dispatchDataChanged(new Set<ChangedDataType>(['timeBlocks', 'todos']));
          toast.success(`Scheduled ${created} todo${created !== 1 ? 's' : ''} for today`);
        } else {
          toast.info('All todos are already scheduled');
        }
      } catch {
        toast.error('Failed to schedule todos');
      } finally {
        setIsGenerating(false);
      }
      return;
    }

    if (!apiKey.trim()) {
      toast.error('Add your Hugging Face key in AI settings');
      return;
    }

    setIsGenerating(true);
    try {
      const today = format(new Date(), 'yyyy-MM-dd');
      const [todos, events, blocks, entries] = await Promise.all([
        getAllTodos(),
        getAllEvents(),
        getAllTimeBlocks(),
        getAllTimeEntries(),
      ]);

      const now = Date.now();

      const nextEvents = events
        .filter((event) => new Date(event.startsAt).getTime() >= now)
        .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
        .slice(0, 8);

      const recentBlocks = blocks
        .slice()
        .sort((a, b) => `${b.date}${b.startTime}`.localeCompare(`${a.date}${a.startTime}`))
        .slice(0, 10);

      const todayBlocks = blocks.filter(b => b.date === today);
      const scheduledTodoIds = new Set(todayBlocks.map(b => b.todoId).filter(Boolean) as string[]);
      const todayTodos = todos.filter(t => t.status === 'today');
      const unscheduledTodayTodos = todayTodos.filter(t => !scheduledTodoIds.has(t.id));

      const overdueTodos = todos.filter(
        t => t.status !== 'done' && t.dueAt && new Date(t.dueAt).getTime() < now
      );

      // Compute today's focus minutes from autoTrack time blocks
      const todayFocusMinutes = todayBlocks
        .filter(b => b.autoTrack)
        .reduce((sum, b) => {
          const [sh, sm] = b.startTime.split(':').map(Number);
          const [eh, em] = b.endTime.split(':').map(Number);
          return sum + Math.max(0, (eh * 60 + em) - (sh * 60 + sm));
        }, 0);

      // Compute current streak from time entries (start from today if has activity, else yesterday)
      const completedEntries = entries.filter(e => e.endAt !== null);
      const daysWithActivity = new Set(completedEntries.map(e => e.startAt.split('T')[0]));
      let currentStreak = 0;
      const streakStart = daysWithActivity.has(today)
        ? new Date()
        : new Date(Date.now() - 86400000);
      const checkDate = new Date(streakStart);
      for (let i = 0; i < 365; i++) {
        const dateStr = checkDate.toISOString().split('T')[0];
        if (daysWithActivity.has(dateStr)) {
          currentStreak++;
          checkDate.setDate(checkDate.getDate() - 1);
        } else {
          break;
        }
      }

      const nextEvent = nextEvents[0] ?? null;
      const [todaySkeleton, currentLocation, habitModel, predictedNow, activeGoals] = await Promise.all([
        getEffectiveScheduleForDate(today),
        getCurrentLocation(),
        getHabitModel(),
        predictActivity(new Date()),
        getActiveGoals(),
      ]);

      const weeklySkeletonSummary = todaySkeleton
        .map((entry) => `${entry.startTime}-${entry.endTime} ${entry.kind} ${entry.title}${entry.location ? ` @ ${entry.location.name}` : ''}`)
        .join(' | ');
      const currentLocationLabel = currentLocation ? `${currentLocation.icon} ${currentLocation.name}` : 'none';
      const peakFocusHoursToday = habitModel.dailyRhythms.peakFocusHours.map((hour) => `${String(hour).padStart(2, '0')}:00`);
      const typicalActivitiesNow = predictedNow ? [predictedNow.label] : [];
      const activeGoalsSummary = activeGoals.length > 0
        ? activeGoals.map(g => `"${g.title}" (why: ${g.why || 'unspecified'})`).join('; ')
        : undefined;

      const plan = await generateActionPlan(prompt.trim(), {
        todoTitles: todos.slice(0, 20).map((todo) => todo.title),
        upcomingEventTitles: nextEvents.map((event) => event.title),
        recentBlockTitles: recentBlocks.map((block) => block.title),
        unscheduledTodayTodos: unscheduledTodayTodos.map(t => t.title),
        overdueTodos: overdueTodos.map(t => t.title),
        currentStreak,
        todayFocusMinutes,
        nextEventDateTime: nextEvent ? nextEvent.startsAt : null,
        weeklySkeletonSummary,
        currentLocation: currentLocationLabel,
        peakFocusHoursToday,
        typicalActivitiesNow,
        activeGoals: activeGoalsSummary,
      }, { mode });

      setResult(plan);
      setAppliedIds([]);

      if (mode === 'agent' && plan.suggestions.length > 0) {
        // Auto-apply all suggestions in agent mode
        let appliedCount = 0;
        let failedCount = 0;
        const changedTypes = new Set<ChangedDataType>();
        for (const suggestion of plan.suggestions) {
          const changedType = await applySuggestion(suggestion);
          if (changedType) {
            changedTypes.add(changedType);
            appliedCount += 1;
          } else {
            failedCount += 1;
          }
        }
        dispatchDataChanged(changedTypes);
        if (failedCount === 0) {
          toast.success(`Agent executed ${appliedCount} action${appliedCount !== 1 ? 's' : ''}`);
        } else {
          toast.error(`${appliedCount} action${appliedCount !== 1 ? 's' : ''} applied, ${failedCount} failed — review and retry`);
        }
      } else {
        toast.success('AI plan generated');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to generate AI plan.';
      toast.error(message);
    } finally {
      setIsGenerating(false);
    }
  }

  async function applySuggestion(suggestion: AISuggestion): Promise<ChangedDataType | null> {
    if (appliedIds.includes(suggestion.id)) return null;

    try {
      if (suggestion.type === 'todo') {
        await createTodo({
          title: suggestion.title,
          status: 'today',
          dueAt: suggestion.dueAt ?? null,
          priority: suggestion.priority,
          projectId: null,
          eventId: null,
        });
        setAppliedIds((prev) => [...prev, suggestion.id]);
        return 'todos';
      } else if (suggestion.type === 'event') {
        await createEvent({
          title: suggestion.title,
          startsAt: suggestion.startsAt ?? new Date().toISOString(),
          allDay: Boolean(suggestion.allDay),
          priority: suggestion.priority,
          tags: ['ai'],
          notes: suggestion.notes ?? '',
        });
        setAppliedIds((prev) => [...prev, suggestion.id]);
        return 'events';
      } else {
        const blockDate = suggestion.date ?? new Date().toISOString().split('T')[0];
        const startTime = suggestion.startTime ?? '09:00';
        const endTime = suggestion.endTime ?? '10:00';
        const toMinutes = (value: string) => {
          const [h, m] = value.split(':').map(Number);
          return (h * 60) + m;
        };
        const startMinutes = toMinutes(startTime);
        const endMinutes = toMinutes(endTime);
        const effectiveSchedule = await getEffectiveScheduleForDate(blockDate);
        const conflictingFixed = effectiveSchedule.find(
          (entry) =>
            entry.kind === 'fixed' &&
            startMinutes < toMinutes(entry.endTime) &&
            endMinutes > toMinutes(entry.startTime)
        );

        if (conflictingFixed) {
          throw new Error(
            `AI suggestion overlaps with fixed routine "${conflictingFixed.title}" from ${conflictingFixed.startTime} to ${conflictingFixed.endTime}`
          );
        }

        const matchingSlot = effectiveSchedule.find(
          (entry) => startMinutes < toMinutes(entry.endTime) && endMinutes > toMinutes(entry.startTime)
        );

        await createTimeBlock({
          title: suggestion.title,
          date: blockDate,
          startTime,
          endTime,
          todoId: null,
          projectId: null,
          locationId: matchingSlot?.locationId ?? null,
          color: 'oklch(0.60 0.19 250)',
          autoTrack: suggestion.autoTrack !== false,
          slotType: 'fixed',
        });
        setAppliedIds((prev) => [...prev, suggestion.id]);
        return 'timeBlocks';
      }
    } catch (error) {
      console.error('applySuggestion failed:', error);
      toast.error(`Failed to apply: ${suggestion.title}`);
      return null;
    }
  }

  async function handleApplySuggestion(suggestion: AISuggestion) {
    const changedType = await applySuggestion(suggestion);
    if (!changedType) return;
    dispatchDataChanged(new Set<ChangedDataType>([changedType]));
  }

  async function handleApplyAll() {
    if (!result || result.suggestions.length === 0) return;
    setIsApplyingAll(true);
    try {
      const changedTypes = new Set<ChangedDataType>();
      for (const suggestion of result.suggestions) {
        const changedType = await applySuggestion(suggestion);
        if (changedType) changedTypes.add(changedType);
      }
      dispatchDataChanged(changedTypes);
      toast.success('AI plan applied');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to apply some AI actions.';
      toast.error(message);
    } finally {
      setIsApplyingAll(false);
    }
  }

  // ── compact (popup) mode ─────────────────────────────────────────────────
  if (compact) {
    const suggestionTypeIcon = (type: AISuggestion['type']) => {
      if (type === 'event') return <CalendarPlus size={14} className="shrink-0 text-blue-500" />;
      if (type === 'timeBlock') return <Timer size={14} className="shrink-0 text-purple-500" />;
      return <CheckSquare size={14} className="shrink-0 text-green-500" />;
    };

    return (
      <div className="flex flex-col gap-3">
        {/* ── status bar ── */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <span className={`inline-block w-2 h-2 rounded-full ${aiReady ? 'bg-green-500' : 'bg-yellow-500'}`} />
            <span className="text-xs text-muted-foreground">
              {!isOnline ? 'Offline' : aiReady ? 'AI ready' : 'Setup needed'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center p-0.5 bg-muted rounded-md">
              <button
                type="button"
                className={`px-2 py-0.5 rounded text-xs transition-colors ${mode === 'plan' ? 'bg-background shadow text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                onClick={() => setMode('plan')}
              >
                Plan
              </button>
              <button
                type="button"
                className={`px-2 py-0.5 rounded text-xs transition-colors ${mode === 'agent' ? 'bg-background shadow text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                onClick={() => setMode('agent')}
              >
                Agent
              </button>
            </div>
            <Button type="button" variant="ghost" size="sm" className="h-7 px-2 gap-1.5" onClick={() => setIsCompactSettingsOpen(true)}>
              <SlidersHorizontal size={13} />
              <span className="text-xs">Key</span>
            </Button>
          </div>
        </div>

        {/* ── banners ── */}
        {!isOnline && (
          <div className="flex items-center gap-1.5 text-xs text-destructive">
            <WifiSlash size={14} />
            No internet — AI unavailable.
          </div>
        )}
        {!hasApiKey && isOnline && keyCheckDone && (
          <div className="flex items-center gap-1.5 text-xs text-yellow-600">
            <WarningCircle size={14} />
            Add your Hugging Face API key in Settings.
          </div>
        )}

        {/* ── result / assistant message ── */}
        {result && (
          <div ref={resultRef} className="rounded-xl bg-muted/60 p-3 space-y-3">
            {/* summary + meta */}
            <p className="text-sm leading-relaxed">{result.summary}</p>
            <div className="flex flex-wrap gap-1.5">
              <Badge variant="secondary" className="text-xs capitalize">{result.severity}</Badge>
              <Badge variant="outline" className="text-xs">{confidencePercent}% confidence</Badge>
              {result.urgencyHours !== null && (
                <Badge variant="outline" className="text-xs">Urgent in {result.urgencyHours}h</Badge>
              )}
            </div>

            {/* suggestion chips */}
            {result.suggestions.length > 0 && (
              <div className="space-y-1.5">
                {mode === 'agent' ? (
                  <div className="text-sm text-green-600 font-medium px-1 py-1">
                    ✓ Created {result.suggestions.length} item{result.suggestions.length !== 1 ? 's' : ''}
                  </div>
                ) : (
                  result.suggestions.map((suggestion) => {
                    const applied = appliedIds.includes(suggestion.id);
                    return (
                      <div
                        key={suggestion.id}
                        className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm transition-colors ${applied ? 'opacity-50 bg-background' : 'bg-background hover:bg-accent'}`}
                      >
                        {suggestionTypeIcon(suggestion.type)}
                        <span className="flex-1 truncate">{suggestion.title}</span>
                        {suggestion.type === 'timeBlock' && suggestion.startTime && (
                          <span className="text-xs text-muted-foreground shrink-0">{suggestion.startTime}</span>
                        )}
                        <button
                          type="button"
                          aria-label={applied ? 'Applied' : 'Add'}
                          disabled={applied}
                          onClick={() => void handleApplySuggestion(suggestion)}
                          className="shrink-0 rounded-md p-0.5 hover:bg-accent disabled:cursor-not-allowed"
                        >
                          {applied
                            ? <CheckCircle size={16} className="text-green-500" />
                            : <span className="text-muted-foreground hover:text-foreground text-base leading-none">+</span>
                          }
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            )}

            {/* apply all + clear */}
            {result.suggestions.length > 1 && mode !== 'agent' && (              <div className="flex items-center gap-3 pt-0.5">
                <button
                  type="button"
                  onClick={handleApplyAll}
                  disabled={isApplyingAll || appliedIds.length === result.suggestions.length}
                  className="text-xs text-primary hover:underline disabled:opacity-40 disabled:no-underline"
                >
                  {isApplyingAll ? 'Applying…' : 'Apply all'}
                </button>
                <button
                  type="button"
                  onClick={() => { setResult(null); setAppliedIds([]); }}
                  className="text-xs text-muted-foreground hover:underline"
                >
                  Clear
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── chat input ── */}
        <div className="relative">
          <Textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                void handleGenerate();
              }
            }}
            placeholder={
              mode === 'agent'
                ? 'Tell me what to do...'
                : 'Describe your day or goals...'
            }
            className="min-h-20 pr-12 resize-none text-sm"
            disabled={isGenerating}
          />
          <Button
            type="button"
            size="icon"
            onClick={handleGenerate}
            disabled={isGenerating || !aiReady || !prompt.trim()}
            className="absolute bottom-2 right-2 h-8 w-8"
            aria-label="Generate plan"
          >
            {isGenerating
              ? <ArrowsCounterClockwise size={15} className="animate-spin" />
              : <PaperPlaneTilt size={15} />
            }
          </Button>
        </div>
        <p className="text-xs text-muted-foreground text-right -mt-1">Ctrl + Enter to send</p>

        {/* ── compact settings dialog ── */}
        <Dialog open={isCompactSettingsOpen} onOpenChange={setIsCompactSettingsOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>AI Settings</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-1">
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground">Hugging Face API key</p>
                <Input
                  type="password"
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  placeholder="hf_xxx…"
                  autoComplete="off"
                />
              </div>
              <div className="flex items-center justify-between gap-2 pt-1">
                <Button
                  type="button"
                  onClick={() => {
                    handleSaveAIConfig();
                    setIsCompactSettingsOpen(false);
                  }}
                >
                  Save
                </Button>
                {hasApiKey && <span className="text-xs text-muted-foreground">Key configured ✓</span>}
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    );
  }


  // ── full (tab) mode ──────────────────────────────────────────────────────
  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div>
        <h2 className="text-3xl font-semibold mb-2 flex items-center gap-2">
          <Sparkle size={28} weight="fill" />
          AI Action Assistant
        </h2>
        <p className="text-muted-foreground">
          Turn natural language into summaries, urgency signals, and one-click actions across todos, events, and timeline blocks.
        </p>
      </div>

      {!isOnline && (
        <Card className="p-4 border-destructive/40">
          <div className="flex items-center gap-2 text-sm">
            <WifiSlash size={18} className="text-destructive" />
            <p>No internet connection. AI features are disabled until your connection is restored.</p>
          </div>
        </Card>
      )}

      {!hasApiKey && keyCheckDone && (
        <Card className="p-4 border-yellow-500/40">
          <div className="flex items-center gap-2 text-sm">
            <WarningCircle size={18} className="text-yellow-500" />
            <p>Add your Hugging Face API key below for this app session, or set VITE_HUGGINGFACE_API_KEY.</p>
          </div>
        </Card>
      )}

      <Card className="p-5 space-y-3">
        <h3 className="font-semibold">AI Provider Configuration</h3>
        <p className="text-sm text-muted-foreground">
          Set your Hugging Face key for this app session.
        </p>
        <Input
          type="password"
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
          placeholder="hf_xxx..."
          autoComplete="off"
        />

        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" onClick={handleSaveAIConfig}>
            Save AI Settings
          </Button>
          {hasApiKey && <Badge variant="secondary">AI key configured</Badge>}
        </div>
      </Card>

      <Card className="p-5 space-y-4">
        <div className="space-y-2">
          <p className="text-sm font-medium">Mode</p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant={mode === 'plan' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setMode('plan')}
            >
              Plan mode
            </Button>
            <Button
              type="button"
              variant={mode === 'agent' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setMode('agent')}
            >
              Agent mode
            </Button>
            <Badge variant="secondary">Auto-saved as default</Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            {mode === 'agent'
              ? 'Agent mode automatically executes all suggestions immediately — todos, events, and time blocks are created for you without any clicks.'
              : 'Plan mode keeps output concise and execution-focused.'}
          </p>
        </div>
        <Textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder={
            mode === 'agent'
              ? 'Talk naturally: "I feel behind today. I have classes 9-12, gym at 6, and a Friday project deadline. Help me recover with realistic steps."'
              : 'Example: I have classes 9-12, gym at 6 PM, and a project deadline Friday. Build me a realistic day plan and create what should be added.'
          }
          className="min-h-36"
        />
        <div className="flex flex-wrap gap-2">
          <Button onClick={handleGenerate} disabled={isGenerating || !aiReady}>
            <Sparkle size={16} className="mr-2" />
            {isGenerating ? 'Generating...' : 'Generate AI Plan'}
          </Button>
          <Button
            variant="outline"
            onClick={handleApplyAll}
            disabled={!result || result.suggestions.length === 0 || isApplyingAll}
          >
            <Lightning size={16} className="mr-2" />
            {isApplyingAll ? 'Applying...' : mode === 'agent' ? 'Re-apply All' : 'Apply All Suggestions'}
          </Button>
        </div>
      </Card>

      {result && (
        <Card className="p-5 space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">Severity: {result.severity}</Badge>
            <Badge variant="outline">Confidence: {confidencePercent}%</Badge>
            {result.urgencyHours !== null && (
              <Badge variant="outline">Urgency window: {result.urgencyHours}h</Badge>
            )}
            {mode === 'agent' && (
              <Badge variant="secondary">Auto-executed in agent mode</Badge>
            )}
          </div>

          <div>
            <h3 className="font-semibold mb-2">Summary</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">{result.summary}</p>
          </div>

          <div>
            <h3 className="font-semibold mb-3">Suggested Actions ({result.suggestions.length})</h3>
            {result.suggestions.length === 0 ? (
              <p className="text-sm text-muted-foreground">No immediate actions were suggested.</p>
            ) : (
              <div className="space-y-3">
                {result.suggestions.map((suggestion, index) => {
                  const applied = appliedIds.includes(suggestion.id);
                  return (
                    <Card key={suggestion.id} className="p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-medium">{index + 1}. {suggestion.title}</p>
                          <div className="flex flex-wrap gap-2 mt-2">
                            <Badge variant="outline">{suggestion.type}</Badge>
                            <Badge variant="outline">P{suggestion.priority}</Badge>
                            {suggestion.type === 'timeBlock' && suggestion.startTime && suggestion.endTime && (
                              <Badge variant="outline">{suggestion.startTime} - {suggestion.endTime}</Badge>
                            )}
                          </div>
                          {suggestion.notes && (
                            <p className="text-sm text-muted-foreground mt-2">{suggestion.notes}</p>
                          )}
                        </div>
                        <Button
                          size="sm"
                          variant={applied ? 'secondary' : 'default'}
                          onClick={() => void handleApplySuggestion(suggestion)}
                          disabled={applied}
                        >
                          {applied ? (
                            <>
                              <CheckCircle size={14} className="mr-1" />
                              Applied
                            </>
                          ) : (
                            'Apply'
                          )}
                        </Button>
                      </div>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
