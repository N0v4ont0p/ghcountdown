import { useMemo, useState, useEffect } from 'react';
import { Sparkle, Lightning, WarningCircle, CheckCircle, WifiSlash } from '@phosphor-icons/react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { getAllTodos, createTodo } from '@/db/repositories/todosRepo';
import { getAllEvents, createEvent } from '@/db/repositories/eventsRepo';
import { getAllTimeBlocks, createTimeBlock } from '@/db/repositories/timeBlocksRepo';
import { AIAssistantResult, AISuggestion, generateActionPlan, isAIConfigured } from '@/lib/aiPlanner';

export function AIAssistantView() {
  const [prompt, setPrompt] = useState('');
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isApplyingAll, setIsApplyingAll] = useState(false);
  const [result, setResult] = useState<AIAssistantResult | null>(null);
  const [appliedIds, setAppliedIds] = useState<string[]>([]);

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

  const aiReady = isOnline && isAIConfigured();
  const confidencePercent = useMemo(
    () => (result ? Math.round(result.confidence * 100) : 0),
    [result]
  );

  async function handleGenerate() {
    if (!prompt.trim()) {
      toast.error('Describe your schedule or goals first.');
      return;
    }

    if (!isOnline) {
      toast.error('No internet connection. AI features are disabled.');
      return;
    }

    if (!isAIConfigured()) {
      toast.error('Missing AI key. Set VITE_HUGGINGFACE_API_KEY in your local .env file.');
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
      });

      setResult(plan);
      setAppliedIds([]);
      toast.success('AI action plan generated.');
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

      {!isAIConfigured() && (
        <Card className="p-4 border-yellow-500/40">
          <div className="flex items-center gap-2 text-sm">
            <WarningCircle size={18} className="text-yellow-500" />
            <p>Set VITE_HUGGINGFACE_API_KEY in your local .env file to enable AI generation.</p>
          </div>
        </Card>
      )}

      <Card className="p-5 space-y-4">
        <Textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder="Example: I have classes 9-12, gym at 6 PM, and a project deadline Friday. Build me a realistic day plan and create what should be added."
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
            {isApplyingAll ? 'Applying...' : 'Apply All Suggestions'}
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
