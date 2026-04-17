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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { getAllTodos, createTodo } from '@/db/repositories/todosRepo';
import { getAllEvents, createEvent } from '@/db/repositories/eventsRepo';
import { getAllTimeBlocks, createTimeBlock } from '@/db/repositories/timeBlocksRepo';
import { updateSettings } from '@/db/repositories/settingsRepo';
import {
  AIMode,
  AIAssistantResult,
  AISuggestion,
  CUSTOM_MODEL_ID,
  DEFAULT_HUGGING_FACE_MODEL,
  PRESET_MODELS,
  PresetModel,
  generateActionPlan,
  getAIConfiguration,
  isPresetModel,
  updateAIConfiguration,
} from '@/lib/aiPlanner';

const AI_MODE_STORAGE_KEY = 'ghcountdown.ai.defaultMode';

/** Tier badge text and color. */
const TIER_LABELS: Record<PresetModel['tier'], { label: string; color: string }> = {
  fast:     { label: 'Fast',     color: 'text-green-500' },
  balanced: { label: 'Balanced', color: 'text-blue-500' },
  quality:  { label: 'Quality',  color: 'text-purple-500' },
};

interface AIAssistantViewProps {
  compact?: boolean;
}

function readSavedMode(): AIMode {
  if (typeof window === 'undefined') return 'plan';
  const saved = window.localStorage.getItem(AI_MODE_STORAGE_KEY);
  return saved === 'agent' ? 'agent' : 'plan';
}

/** Returns the Select value to show for a given model string. */
function toSelectValue(modelId: string): string {
  return isPresetModel(modelId) ? modelId : CUSTOM_MODEL_ID;
}

export function AIAssistantView({ compact = false }: AIAssistantViewProps) {
  const [prompt, setPrompt] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState(DEFAULT_HUGGING_FACE_MODEL);
  const [customModelInput, setCustomModelInput] = useState('');
  const [mode, setMode] = useState<AIMode>(readSavedMode());
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isApplyingAll, setIsApplyingAll] = useState(false);
  const [result, setResult] = useState<AIAssistantResult | null>(null);
  const [appliedIds, setAppliedIds] = useState<string[]>([]);
  const [isCompactSettingsOpen, setIsCompactSettingsOpen] = useState(false);
  const resultRef = useRef<HTMLDivElement | null>(null);

  const isCustomModel = model === CUSTOM_MODEL_ID;
  const hasApiKey = apiKey.trim().length > 0;

  useEffect(() => {
    const config = getAIConfiguration();
    setApiKey(config.apiKey);
    if (!isPresetModel(config.model)) {
      setModel(CUSTOM_MODEL_ID);
      setCustomModelInput(config.model);
    } else {
      setModel(config.model);
    }
    setMode(readSavedMode());
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

  function handleModelSelectChange(value: string) {
    setModel(value);
    if (value !== CUSTOM_MODEL_ID) {
      setCustomModelInput('');
    }
  }

  /** Returns the resolved model ID to use for the current UI state.
   *  Returns null when custom mode is selected but the input is empty,
   *  so callers can decide whether to fall back or warn. */
  function resolveCurrentModel(): string | null {
    if (isCustomModel) {
      const trimmed = customModelInput.trim();
      return trimmed.length > 0 ? trimmed : null;
    }
    return model;
  }

  function handleSaveAIConfig() {
    const trimmedApiKey = apiKey.trim();
    const resolvedModel = resolveCurrentModel();

    if (isCustomModel && !resolvedModel) {
      toast.error('Enter a custom model ID before saving.');
      return;
    }

    const finalModel = resolvedModel ?? DEFAULT_HUGGING_FACE_MODEL;
    updateAIConfiguration({
      apiKey: trimmedApiKey,
      model: finalModel,
    });
    updateSettings({ aiApiKey: trimmedApiKey, aiModel: finalModel });

    toast.success(trimmedApiKey ? 'AI credentials saved.' : 'Saved model. Add an API key to enable AI.');
  }

  async function handleGenerate() {
    if (!prompt.trim()) {
      toast.error('Describe your schedule or goals first.');
      return;
    }

    if (!isOnline) {
      toast.error('No internet connection. AI features are disabled.');
      return;
    }

    // Sync the currently selected model before generating
    const resolvedModel = resolveCurrentModel();
    if (isCustomModel && !resolvedModel) {
      toast.error('Enter a custom model ID first.');
      return;
    }
    const finalModel = resolvedModel ?? DEFAULT_HUGGING_FACE_MODEL;
    updateAIConfiguration({
      apiKey: apiKey.trim(),
      model: finalModel,
    });
    updateSettings({ aiApiKey: apiKey.trim(), aiModel: finalModel });

    if (!apiKey.trim()) {
      toast.error('Missing AI key. Add your Hugging Face key below or via VITE_HUGGINGFACE_API_KEY.');
      return;
    }

    setIsGenerating(true);
    try {
      const [todos, events, blocks] = await Promise.all([
        getAllTodos(),
        getAllEvents(),
        getAllTimeBlocks(),
      ]);

      const nextEvents = events
        .filter((event) => new Date(event.startsAt).getTime() >= Date.now())
        .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
        .slice(0, 8);

      const recentBlocks = blocks
        .slice()
        .sort((a, b) => `${b.date}${b.startTime}`.localeCompare(`${a.date}${a.startTime}`))
        .slice(0, 10);

      const plan = await generateActionPlan(prompt.trim(), {
        todoTitles: todos.slice(0, 20).map((todo) => todo.title),
        upcomingEventTitles: nextEvents.map((event) => event.title),
        recentBlockTitles: recentBlocks.map((block) => block.title),
      }, { mode });

      setResult(plan);
      setAppliedIds([]);

      if (mode === 'agent' && plan.suggestions.length > 0) {
        // Auto-apply all suggestions in agent mode
        for (const suggestion of plan.suggestions) {
          await applySuggestion(suggestion);
        }
        toast.success(`Agent executed ${plan.suggestions.length} action(s) automatically.`);
      } else {
        toast.success('AI action plan generated.');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to generate AI plan.';
      toast.error(message);
    } finally {
      setIsGenerating(false);
    }
  }

  async function applySuggestion(suggestion: AISuggestion) {
    if (appliedIds.includes(suggestion.id)) return;

    if (suggestion.type === 'todo') {
      await createTodo({
        title: suggestion.title,
        status: suggestion.priority >= 4 ? 'today' : 'inbox',
        dueAt: suggestion.dueAt ?? null,
        priority: suggestion.priority,
        projectId: null,
        eventId: null,
      });
    } else if (suggestion.type === 'event') {
      await createEvent({
        title: suggestion.title,
        startsAt: suggestion.startsAt ?? new Date().toISOString(),
        allDay: Boolean(suggestion.allDay),
        priority: suggestion.priority,
        tags: ['ai'],
        notes: suggestion.notes ?? '',
      });
    } else {
      await createTimeBlock({
        title: suggestion.title,
        date: suggestion.date ?? new Date().toISOString().split('T')[0],
        startTime: suggestion.startTime ?? '09:00',
        endTime: suggestion.endTime ?? '10:00',
        todoId: null,
        projectId: null,
        color: 'oklch(0.60 0.19 250)',
        autoTrack: suggestion.autoTrack !== false,
      });
    }

    setAppliedIds((prev) => [...prev, suggestion.id]);
  }

  async function handleApplyAll() {
    if (!result || result.suggestions.length === 0) return;
    setIsApplyingAll(true);
    try {
      for (const suggestion of result.suggestions) {
        await applySuggestion(suggestion);
      }
      toast.success('AI plan applied to your app data.');
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
              {!isOnline ? 'Offline' : aiReady ? `AI ready · ${mode} mode` : 'Setup needed'}
            </span>
          </div>
          <Button type="button" variant="ghost" size="sm" className="h-7 px-2 gap-1.5" onClick={() => setIsCompactSettingsOpen(true)}>
            <SlidersHorizontal size={13} />
            <span className="text-xs">Settings</span>
          </Button>
        </div>

        {/* ── banners ── */}
        {!isOnline && (
          <div className="flex items-center gap-1.5 text-xs text-destructive">
            <WifiSlash size={14} />
            No internet — AI unavailable.
          </div>
        )}
        {!hasApiKey && isOnline && (
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
                {mode === 'agent' && (
                  <div className="text-xs text-green-600 font-medium px-1">
                    ✓ Agent auto-applied all actions
                  </div>
                )}
                {result.suggestions.map((suggestion) => {
                  const applied = mode === 'agent' || appliedIds.includes(suggestion.id);
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
                      {mode === 'agent' ? (
                        <CheckCircle size={16} className="text-green-500 shrink-0" />
                      ) : (
                        <button
                          type="button"
                          aria-label={applied ? 'Applied' : 'Add'}
                          disabled={applied}
                          onClick={() => applySuggestion(suggestion)}
                          className="shrink-0 rounded-md p-0.5 hover:bg-accent disabled:cursor-not-allowed"
                        >
                          {applied
                            ? <CheckCircle size={16} className="text-green-500" />
                            : <span className="text-muted-foreground hover:text-foreground text-base leading-none">+</span>
                          }
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* apply all + clear */}
            {result.suggestions.length > 1 && mode !== 'agent' && (
              <div className="flex items-center gap-3 pt-0.5">
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
                ? 'Talk naturally — e.g. "I feel behind today, help me recover…"'
                : "Describe your day or goals and I'll build a plan…"
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
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground">Model</p>
                <Select value={toSelectValue(model)} onValueChange={handleModelSelectChange}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a model…" />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    {PRESET_MODELS.map((preset) => (
                      <SelectItem key={preset.id} value={preset.id}>
                        <span className="flex items-center gap-2">
                          {preset.label}
                          <span className={`text-xs font-medium ${TIER_LABELS[preset.tier].color}`}>
                            {TIER_LABELS[preset.tier].label}
                          </span>
                        </span>
                      </SelectItem>
                    ))}
                    <SelectItem value={CUSTOM_MODEL_ID}>Custom model…</SelectItem>
                  </SelectContent>
                </Select>
                {isCustomModel && (
                  <Input
                    value={customModelInput}
                    onChange={(event) => setCustomModelInput(event.target.value)}
                    placeholder="e.g. org/model-name"
                    className="mt-1"
                  />
                )}
              </div>
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground">Response style</p>
                <div className="flex gap-2">
                  <Button type="button" size="sm" variant={mode === 'plan' ? 'default' : 'outline'} onClick={() => setMode('plan')}>
                    Plan
                  </Button>
                  <Button type="button" size="sm" variant={mode === 'agent' ? 'default' : 'outline'} onClick={() => setMode('agent')}>
                    Agent
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  {mode === 'agent' ? 'Auto-executes all actions immediately.' : 'Concise, execution-focused output.'}
                </p>
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

      {!hasApiKey && (
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
          Set your Hugging Face key for this app session and choose the model to use.
        </p>
        <Input
          type="password"
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
          placeholder="hf_xxx..."
          autoComplete="off"
        />

        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">Model</p>
          <Select value={toSelectValue(model)} onValueChange={handleModelSelectChange}>
            <SelectTrigger>
              <SelectValue placeholder="Select a model…" />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              {PRESET_MODELS.map((preset) => (
                <SelectItem key={preset.id} value={preset.id}>
                  <div className="flex flex-col gap-0.5 py-0.5">
                    <span className="flex items-center gap-2">
                      {preset.label}
                      <span className={`text-xs font-medium ${TIER_LABELS[preset.tier].color}`}>
                        {TIER_LABELS[preset.tier].label}
                      </span>
                    </span>
                    <span className="text-xs text-muted-foreground leading-tight">{preset.description}</span>
                  </div>
                </SelectItem>
              ))}
              <SelectItem value={CUSTOM_MODEL_ID}>
                <div className="flex flex-col gap-0.5 py-0.5">
                  <span>Custom model…</span>
                  <span className="text-xs text-muted-foreground">Enter any Hugging Face model ID manually</span>
                </div>
              </SelectItem>
            </SelectContent>
          </Select>

          {isCustomModel && (
            <Input
              value={customModelInput}
              onChange={(event) => setCustomModelInput(event.target.value)}
              placeholder="e.g. org/model-name"
              className="mt-1"
            />
          )}

          {!isCustomModel && model && (
            <p className="text-xs text-muted-foreground break-all">
              Model ID: <code>{model}</code>
            </p>
          )}
        </div>

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
                          onClick={() => applySuggestion(suggestion)}
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
