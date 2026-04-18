import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Toaster } from '@/components/ui/sonner';
import { Sidebar } from '@/components/Sidebar';
import { CountdownHero } from '@/components/CountdownHero';
import { RightNowCard } from '@/components/RightNowCard';
import { DeadlinePressureStrip } from '@/components/DeadlinePressureStrip';
import { MomentumStrip } from '@/components/MomentumStrip';
import { SmartSuggestions } from '@/components/SmartSuggestions';
import { EventsView } from '@/components/EventsView';
import { TodosView } from '@/components/TodosView';
import { TimelineView } from '@/components/TimelineView';
import { StatisticsView } from '@/components/StatisticsView';
import { AIAssistantView } from '@/components/AIAssistantView';
import { QuickCapture } from '@/components/QuickCapture';
import { UniversalSearch } from '@/components/UniversalSearch';
import { EveningFlow } from '@/components/EveningFlow';
import { MorningFlow } from '@/components/MorningFlow';
import { WeeklyReview } from '@/components/WeeklyReview';
import { initDB } from '@/db/core';
import { seedDatabase } from '@/db/seed';
import { deleteAllEvents, getNextImportantEvent, getAllEvents } from '@/db/repositories/eventsRepo';
import { deleteAllTodos, getAllTodos } from '@/db/repositories/todosRepo';
import { getSettings, updateSettings } from '@/db/repositories/settingsRepo';
import { deleteAllProjects } from '@/db/repositories/projectsRepo';
import { deleteAllTimeEntries, getAllTimeEntries } from '@/db/repositories/timeRepo';
import { deleteAllTimeBlocks, getTimeBlocksByDate, getAllTimeBlocks } from '@/db/repositories/timeBlocksRepo';
import { Event, Todo, TimeBlock, Settings } from '@/db/schema';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Sun, Moon, Monitor, DownloadSimple, UploadSimple, Trash, Sparkle, X, MagnifyingGlass, Plus, CalendarBlank, CheckSquare, Warning, ArrowRight } from '@phosphor-icons/react';
import { format } from 'date-fns';
import { useTheme } from '@/hooks/use-theme';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { exportAllData, downloadJSON, exportTimeEntriesCSV, exportEventsCSV, exportTodosCSV, importAllData, ExportData } from '@/db/export';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { getAIConfiguration, updateAIConfiguration, generateActionPlan } from '@/lib/aiPlanner';
import { performDailyRollover } from '@/lib/rollover';
import { escalateOverdueTodos } from '@/lib/overdueCheck';
import { detectDrift } from '@/lib/habitModel';
import { weeklyReviewKey } from '@/lib/weeklyTrajectory';

function App() {
  const [currentView, setCurrentView] = useState('home');
  const [nextEvent, setNextEvent] = useState<Event | null>(null);
  const [upcomingEvents, setUpcomingEvents] = useState<Event[]>([]);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [todayBlocks, setTodayBlocks] = useState<TimeBlock[]>([]);
  const [nowTick, setNowTick] = useState(new Date());
  const [settings, setSettings] = useState<Settings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isAIPopupOpen, setIsAIPopupOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isQuickCaptureOpen, setIsQuickCaptureOpen] = useState(false);
  const [morningBriefing, setMorningBriefing] = useState<string | null>(null);
  const [aiNudges, setAiNudges] = useState<string[]>([]);
  const [dataVersion, setDataVersion] = useState(0);
  const [bulkDeleteConfirmOpen, setBulkDeleteConfirmOpen] = useState(false);
  const [bulkDeleteTarget, setBulkDeleteTarget] = useState<'events' | 'todos' | 'projects' | 'timeEntries' | 'timeBlocks' | 'all' | null>(null);
  const [showEveningFlow, setShowEveningFlow] = useState(false);
  const [showMorningFlow, setShowMorningFlow] = useState(false);
  const [showWeeklyReview, setShowWeeklyReview] = useState(false);
  const [weeklyIntention, setWeeklyIntention] = useState(() => localStorage.getItem('weeklyIntention') ?? '');
  const { theme, setTheme, resolvedTheme } = useTheme();

  function invalidateCache() { setDataVersion(v => v + 1); }

  useEffect(() => {
    async function initialize() {
      try {
        await initDB();
        await seedDatabase();
        
        const appSettings = await getSettings();
        setSettings(appSettings);

        // Restore persisted AI config into the runtime (env-var key takes priority)
        const runtimeConfig = getAIConfiguration();
        updateAIConfiguration({
          apiKey: runtimeConfig.apiKey || appSettings.aiApiKey,
        });
        
        const important = await getNextImportantEvent(appSettings.importantPriorityThreshold);
        setNextEvent(important);
        
        const allEvents = await getAllEvents();
        const upcoming = allEvents
          .filter(e => new Date(e.startsAt) > new Date())
          .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
        setUpcomingEvents(upcoming);
        
        const allTodos = await getAllTodos();
        setTodos(allTodos.filter(t => t.status !== 'done'));

        const blocks = await getTimeBlocksByDate(format(new Date(), 'yyyy-MM-dd'));
        setTodayBlocks(blocks.sort((a, b) => a.startTime.localeCompare(b.startTime)));

        const rolledOver = await performDailyRollover();
        if (rolledOver.length > 0) {
          toast.info(`🔄 ${rolledOver.length} unfinished todo${rolledOver.length !== 1 ? 's' : ''} rolled over from yesterday`);
        }

        const escalated = await escalateOverdueTodos();
        if (escalated > 0) {
          toast.warning(`⚠️ ${escalated} overdue todo${escalated !== 1 ? 's' : ''} escalated to critical priority`);
        }

        await detectDrift();

        // Morning briefing — only between 5am and 11am, once per day
        const hour = new Date().getHours();
        const today = new Date().toISOString().split('T')[0];
        const lastBriefing = localStorage.getItem('lastBriefingDate');
        const morningFlowDate = localStorage.getItem('morningFlowDate');
        if (lastBriefing !== today && hour >= 5 && hour <= 11) {
          localStorage.setItem('lastBriefingDate', today);
          await generateMorningBriefing();
        }
        if (morningFlowDate !== today && hour >= 5 && hour <= 11) {
          const blocks = await getTimeBlocksByDate(format(new Date(), 'yyyy-MM-dd'));
          const allTodos = await getAllTodos();
          const scheduledIds = new Set(blocks.map((b) => b.todoId).filter(Boolean) as string[]);
          const unscheduledToday = allTodos.filter((t) => t.status === 'today' && !scheduledIds.has(t.id));
          if (unscheduledToday.length > 0 || blocks.length < 2) {
            setShowMorningFlow(true);
          }
        }
      } catch (error) {
        console.error('Failed to initialize:', error);
      } finally {
        setIsLoading(false);
      }
    }

    initialize();
  }, []);

  // Tick every minute so the "RIGHT NOW" card updates automatically
  useEffect(() => {
    const id = setInterval(() => setNowTick(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  // Evening flow — trigger after 8pm, once per day, on load and window focus
  useEffect(() => {
    function checkEveningFlow() {
      const hour = new Date().getHours();
      const today = new Date().toISOString().split('T')[0];
      const lastEvening = localStorage.getItem('eveningFlowDate');
      if (hour >= 20 && lastEvening !== today) {
        setShowEveningFlow(true);
        localStorage.setItem('eveningFlowDate', today);
      }
    }

    checkEveningFlow();
    window.addEventListener('focus', checkEveningFlow);
    return () => window.removeEventListener('focus', checkEveningFlow);
  }, []);

  // Weekly review — trigger Sunday ≥18:00 or Monday <11:00, once per review window
  useEffect(() => {
    function checkWeeklyReview() {
      const now = new Date();
      const day = now.getDay(); // 0 = Sunday, 1 = Monday
      const hour = now.getHours();
      const isTriggerTime = (day === 0 && hour >= 18) || (day === 1 && hour < 11);
      if (!isTriggerTime) return;
      const key = weeklyReviewKey(now);
      if (localStorage.getItem('weeklyReviewKey') !== key) {
        setShowWeeklyReview(true);
      }
    }

    checkWeeklyReview();
    window.addEventListener('focus', checkWeeklyReview);
    return () => window.removeEventListener('focus', checkWeeklyReview);
  }, []);

  // Global keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsAIPopupOpen(true);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault();
        setIsSearchOpen(true);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
        e.preventDefault();
        setIsQuickCaptureOpen(true);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  useEffect(() => {
    if (currentView === 'home') {
      loadHomeData();
    }
  }, [currentView, dataVersion]);

  async function loadHomeData() {
    const appSettings = await getSettings();
    const important = await getNextImportantEvent(appSettings.importantPriorityThreshold);
    setNextEvent(important);
    
    const allEvents = await getAllEvents();
    const upcoming = allEvents
      .filter(e => new Date(e.startsAt) > new Date())
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    setUpcomingEvents(upcoming);
    
    const allTodos = await getAllTodos();
    const activeTodos = allTodos.filter(t => t.status !== 'done');
    setTodos(activeTodos);

    const blocks = await getTimeBlocksByDate(format(new Date(), 'yyyy-MM-dd'));
    setTodayBlocks(blocks.sort((a, b) => a.startTime.localeCompare(b.startTime)));

    void generateNudges(upcoming, activeTodos);
  }

  async function generateMorningBriefing() {
    try {
      const config = getAIConfiguration();
      if (!config.apiKey) return;
      const allTodos = await getAllTodos();
      const allEvents = await getAllEvents();
      const todayTodos = allTodos.filter(t => t.status === 'today');
      const urgentEvents = allEvents
        .filter(e => {
          const h = (new Date(e.startsAt).getTime() - Date.now()) / 3600000;
          return h > 0 && h <= 48;
        })
        .slice(0, 3);
      const briefingPrompt = [
        'Generate a short morning briefing (2-3 sentences max).',
        `Today\'s tasks: ${todayTodos.map(t => `${t.title}(P${t.priority})`).join(', ') || 'none'}`,
        `Upcoming deadlines: ${urgentEvents.map(e => `${e.title} in ${Math.round((new Date(e.startsAt).getTime() - Date.now()) / 3600000)}h`).join(', ') || 'none'}`,
        'Be specific, concise, and encouraging. Do not invent tasks.',
        'Return only the summary string in the JSON summary field. Leave suggestions array empty.',
      ].join(' ');
      const plan = await generateActionPlan(briefingPrompt, {
        todoTitles: todayTodos.map(t => t.title),
        upcomingEventTitles: urgentEvents.map(e => e.title),
        recentBlockTitles: [],
        unscheduledTodayTodos: [],
        overdueTodos: [],
        currentStreak: 0,
        todayFocusMinutes: 0,
        nextEventDateTime: urgentEvents[0]?.startsAt ?? null,
        weeklySkeletonSummary: '',
        currentLocation: '',
        peakFocusHoursToday: [],
        typicalActivitiesNow: [],
      }, { mode: 'plan' });
      if (plan.summary) setMorningBriefing(plan.summary);
    } catch {
      // Silent fail — briefing is optional
    }
  }

  async function generateNudges(freshUpcoming: Event[], freshTodos: Todo[]) {
    const nudges: string[] = [];
    const now = Date.now();

    for (const evt of freshUpcoming.filter(e => e.priority === 5)) {
      const hoursUntil = (new Date(evt.startsAt).getTime() - now) / 3600000;
      if (hoursUntil <= 72 && hoursUntil > 0) {
        const allBlocks = await getAllTimeBlocks();
        const firstWord = evt.title.toLowerCase().split(' ')[0];
        const hasPrep = allBlocks.some(b => b.title.toLowerCase().includes(firstWord));
        if (!hasPrep) nudges.push(`"${evt.title}" is in ${Math.round(hoursUntil)}h — no prep blocks scheduled`);
      }
    }

    const highInbox = freshTodos.filter(t => t.status === 'inbox' && t.priority >= 4);
    if (highInbox.length >= 3) {
      nudges.push(`${highInbox.length} high-priority tasks still in inbox`);
    }

    if (new Date().getHours() >= 14) {
      const todayStr = new Date().toISOString().split('T')[0];
      const entries = await getAllTimeEntries();
      const tracked = entries.filter(e => e.startAt.startsWith(todayStr) && e.endAt);
      if (tracked.length === 0) nudges.push('No focus sessions tracked today');
    }

    setAiNudges(nudges);
  }

  async function handleExportJSON() {
    try {
      const data = await exportAllData();
      downloadJSON(data, `ghcountdown-backup-${new Date().toISOString().split('T')[0]}.json`);
      toast.success('Data exported');
    } catch (error) {
      console.error('Export failed:', error);
      toast.error('Failed to export data');
    }
  }

  async function handleExportTimeCSV() {
    try {
      await exportTimeEntriesCSV();
      toast.success('Time entries exported');
    } catch (error) {
      console.error('Export failed:', error);
      toast.error('Failed to export time entries');
    }
  }

  async function handleExportEventsCSV() {
    try {
      await exportEventsCSV();
      toast.success('Events exported');
    } catch (error) {
      console.error('Export failed:', error);
      toast.error('Failed to export events');
    }
  }

  async function handleExportTodosCSV() {
    try {
      await exportTodosCSV();
      toast.success('Todos exported');
    } catch (error) {
      console.error('Export failed:', error);
      toast.error('Failed to export todos');
    }
  }

  async function handleImportJSON() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      try {
        const text = await file.text();
        const data: ExportData = JSON.parse(text);
        await importAllData(data);
        toast.success('Data imported — refreshing...');
        setTimeout(() => window.location.reload(), 1500);
      } catch (error) {
        console.error('Import failed:', error);
        toast.error('Import failed — check the file format');
      }
    };

    input.click();
  }

  const bulkDeleteMeta = {
    events: {
      title: 'Delete all events?',
      description: 'This will permanently delete every event.',
      successMessage: 'All events deleted',
    },
    todos: {
      title: 'Delete all todos?',
      description: 'This will permanently delete every todo.',
      successMessage: 'All todos deleted',
    },
    projects: {
      title: 'Delete all projects?',
      description: 'This will permanently delete every project.',
      successMessage: 'All projects deleted',
    },
    timeEntries: {
      title: 'Delete all time entries?',
      description: 'This will permanently delete every tracked time entry.',
      successMessage: 'All time entries deleted',
    },
    timeBlocks: {
      title: 'Delete all time blocks?',
      description: 'This will permanently delete every timeline time block.',
      successMessage: 'All time blocks deleted',
    },
    all: {
      title: 'Delete all app data?',
      description: 'This will delete events, todos, projects, time entries, and time blocks. Settings are kept.',
      successMessage: 'All app data deleted',
    },
  } as const;

  async function handleBulkDeleteConfirm() {
    if (!bulkDeleteTarget) return;

    try {
      switch (bulkDeleteTarget) {
        case 'events':
          await deleteAllEvents();
          break;
        case 'todos':
          await deleteAllTodos();
          break;
        case 'projects':
          await deleteAllProjects();
          break;
        case 'timeEntries':
          await deleteAllTimeEntries();
          break;
        case 'timeBlocks':
          await deleteAllTimeBlocks();
          break;
        case 'all':
          await Promise.all([
            deleteAllEvents(),
            deleteAllTodos(),
            deleteAllProjects(),
            deleteAllTimeEntries(),
            deleteAllTimeBlocks(),
          ]);
          break;
      }

      await loadHomeData();
      toast.success(bulkDeleteMeta[bulkDeleteTarget].successMessage);
    } catch (error) {
      toast.error('Failed to delete data');
      throw error;
    } finally {
      setBulkDeleteTarget(null);
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.3 }}
          className="text-center"
        >
          <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading GHCountdown...</p>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <div className="noise-texture"></div>

      <Sidebar currentView={currentView} onNavigate={setCurrentView} />

      {/* Right panel: titlebar drag strip + scrollable content */}
      <div className="flex-1 flex flex-col overflow-hidden relative z-10">
        {/* Drag region that lines up with the sidebar's traffic-light area */}
        <div className="titlebar-drag h-11 flex-shrink-0" />

        <main className="flex-1 overflow-y-auto px-8 pb-8">
          <AnimatePresence mode="wait">
            {currentView === 'home' && (
              <motion.div
                key="home"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.3 }}
                className="max-w-6xl mx-auto space-y-8"
              >
                <div>
                  <h2 className="text-3xl font-semibold mb-2">Welcome Back</h2>
                  <p className="text-muted-foreground">Your next important event is counting down</p>
                </div>

                {/* 1. Morning briefing */}
                {morningBriefing && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="glass-card rounded-2xl p-4 border-l-4 border-l-primary flex items-start justify-between gap-3"
                  >
                    <div className="flex items-start gap-2">
                      <Sparkle size={16} weight="fill" className="text-primary mt-0.5 flex-shrink-0" />
                      <p className="text-sm leading-relaxed">{morningBriefing}</p>
                    </div>
                    <button
                      onClick={() => setMorningBriefing(null)}
                      className="text-muted-foreground hover:text-foreground flex-shrink-0"
                    >
                      <X size={14} />
                    </button>
                  </motion.div>
                )}

                {/* 2. Momentum strip */}
                <MomentumStrip />

                {/* 3. Right Now card — visually prominent */}
                <div className="rounded-2xl overflow-hidden shadow-lg" style={{ borderLeft: '4px solid var(--primary)' }}>
                  <RightNowCard
                    blocks={todayBlocks}
                    now={nowTick}
                    onNavigateTimeline={() => setCurrentView('timeline')}
                  />
                </div>

                {/* 4. Countdown hero */}
                <CountdownHero event={nextEvent} />

                {/* 5. Deadline pressure strip */}
                <DeadlinePressureStrip events={upcomingEvents} />

                {/* 6. Smart suggestions + AI nudges */}
                <div className="space-y-3">
                  <SmartSuggestions onNavigate={setCurrentView} />
                  {aiNudges.length > 0 && (
                    <Card className="p-4 border-yellow-500/30 bg-yellow-500/5">
                      <div className="space-y-2">
                        {aiNudges.map((nudge, i) => (
                          <div key={i} className="flex items-center gap-2 text-sm">
                            <Warning size={14} className="text-yellow-500 shrink-0" />
                            <span>{nudge}</span>
                          </div>
                        ))}
                      </div>
                    </Card>
                  )}
                </div>

                {/* 7. Two-column: upcoming events | today's tasks */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <Card className="p-4">
                    <h3 className="font-semibold mb-3 flex items-center gap-2 text-sm">
                      <CalendarBlank size={16} />
                      Upcoming Events
                    </h3>
                    {upcomingEvents.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-4">No upcoming events</p>
                    ) : (
                      <div className="space-y-2">
                        {upcomingEvents.slice(0, 5).map(evt => (
                          <div key={evt.id} className="flex items-center gap-2 text-sm">
                            <div
                              className="w-1 h-8 rounded-full flex-shrink-0"
                              style={{ backgroundColor: `var(--priority-${evt.priority}, oklch(0.65 0.18 40))` }}
                            />
                            <div className="flex-1 min-w-0">
                              <p className="font-medium truncate">{evt.title}</p>
                              <p className="text-xs text-muted-foreground">
                                {format(new Date(evt.startsAt), 'MMM d, h:mm a')}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </Card>
                  <Card className="p-4">
                    <h3 className="font-semibold mb-3 flex items-center gap-2 text-sm">
                      <CheckSquare size={16} />
                      Today's Tasks
                    </h3>
                    {todos.filter(t => t.status === 'today').length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-4">No tasks for today</p>
                    ) : (
                      <div className="space-y-2">
                        {todos.filter(t => t.status === 'today').slice(0, 5).map(todo => (
                          <div key={todo.id} className="flex items-center gap-2 text-sm">
                            <div className="w-3.5 h-3.5 rounded-full border-2 border-muted-foreground flex-shrink-0" />
                            <span className="flex-1 truncate">{todo.title}</span>
                            <span className="text-xs text-muted-foreground shrink-0">P{todo.priority}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </Card>
                </div>

                {/* 8. Weekly intention card */}
                {weeklyIntention && (
                  <Card className="p-4 border-l-4 border-l-primary/50">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1">
                        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-1.5">
                          This week's intention
                        </p>
                        <p className="text-sm leading-relaxed">{weeklyIntention}</p>
                      </div>
                      <button
                        className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 shrink-0 mt-0.5"
                        onClick={() => setShowWeeklyReview(true)}
                      >
                        <ArrowRight size={12} />
                        Review
                      </button>
                    </div>
                  </Card>
                )}
              </motion.div>
            )}

            {currentView === 'events' && (
              <motion.div
                key="events"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.3 }}
              >
                <EventsView />
              </motion.div>
            )}

            {currentView === 'todos' && (
              <motion.div
                key="todos"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.3 }}
              >
                <TodosView />
              </motion.div>
            )}

            {currentView === 'timeline' && (
              <motion.div
                key="timeline"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.3 }}
              >
                <TimelineView />
              </motion.div>
            )}

            {currentView === 'statistics' && (
              <motion.div
                key="statistics"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.3 }}
              >
                <StatisticsView />
              </motion.div>
            )}

            {currentView === 'settings' && (
              <motion.div
                key="settings"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.3 }}
                className="max-w-2xl mx-auto"
              >
                <div className="mb-6">
                  <h2 className="text-3xl font-semibold mb-2">Settings</h2>
                  <p className="text-muted-foreground">Customize your GHCountdown experience</p>
                </div>

                <div className="space-y-4">
                  <Card className="p-6">
                    <div className="space-y-4">
                      <div>
                        <Label htmlFor="theme-select" className="text-base font-semibold mb-3 block">
                          Theme
                        </Label>
                        <p className="text-sm text-muted-foreground mb-3">
                          Choose your preferred color scheme
                        </p>
                        <Select value={theme} onValueChange={(value: 'light' | 'dark' | 'system') => setTheme(value)}>
                          <SelectTrigger id="theme-select" className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="light">
                              <div className="flex items-center gap-2">
                                <Sun size={16} />
                                Light
                              </div>
                            </SelectItem>
                            <SelectItem value="dark">
                              <div className="flex items-center gap-2">
                                <Moon size={16} />
                                Dark
                              </div>
                            </SelectItem>
                            <SelectItem value="system">
                              <div className="flex items-center gap-2">
                                <Monitor size={16} />
                                System
                              </div>
                            </SelectItem>
                          </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground mt-2">
                          Currently using: <strong>{resolvedTheme}</strong> mode
                        </p>
                      </div>
                    </div>
                  </Card>

                  <Card className="p-6">
                    <div>
                      <h3 className="font-semibold mb-2">Important Event Priority</h3>
                      <p className="text-sm text-muted-foreground mb-3">
                        Events with this priority or higher appear in the countdown hero
                      </p>
                      <Select
                        value={String(settings?.importantPriorityThreshold ?? 3)}
                        onValueChange={async (val) => {
                          const threshold = parseInt(val) as 1 | 2 | 3 | 4 | 5;
                          await updateSettings({ importantPriorityThreshold: threshold });
                          const updated = await getSettings();
                          setSettings(updated);
                          toast.success('Priority threshold updated');
                        }}
                      >
                        <SelectTrigger className="w-48">
                          <SelectValue placeholder="Select priority" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="5">Priority 5 — Critical only</SelectItem>
                          <SelectItem value="4">Priority 4 — High &amp; above</SelectItem>
                          <SelectItem value="3">Priority 3 — Medium &amp; above</SelectItem>
                          <SelectItem value="2">Priority 2 — Low &amp; above</SelectItem>
                          <SelectItem value="1">Priority 1 — All events</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </Card>

                  <Card className="p-6">
                    <div>
                      <h3 className="font-semibold mb-2">Data Management</h3>
                      <p className="text-sm text-muted-foreground mb-3">
                        All data is stored locally on this device
                      </p>
                      <div className="space-y-4">
                        <div>
                          <p className="text-xs font-medium mb-2">Export Data</p>
                          <div className="flex flex-wrap gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={handleExportJSON}
                              className="button-interactive"
                            >
                              <DownloadSimple size={16} className="mr-1" />
                              Full Backup (JSON)
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={handleExportEventsCSV}
                              className="button-interactive"
                            >
                              <DownloadSimple size={16} className="mr-1" />
                              Events CSV
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={handleExportTodosCSV}
                              className="button-interactive"
                            >
                              <DownloadSimple size={16} className="mr-1" />
                              Todos CSV
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={handleExportTimeCSV}
                              className="button-interactive"
                            >
                              <DownloadSimple size={16} className="mr-1" />
                              Time Entries CSV
                            </Button>
                          </div>
                        </div>
                        <div>
                          <p className="text-xs font-medium mb-2">Import Data</p>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={handleImportJSON}
                            className="button-interactive"
                          >
                            <UploadSimple size={16} className="mr-1" />
                            Import from Backup
                          </Button>
                          <p className="text-xs text-muted-foreground mt-2">
                            Import will add data to existing records
                          </p>
                        </div>
                        <div>
                          <p className="text-xs font-medium mb-2">Delete Data</p>
                          <div className="flex flex-wrap gap-2">
                            <Button
                              variant="destructive"
                              size="sm"
                              onClick={() => {
                                setBulkDeleteTarget('timeBlocks');
                                setBulkDeleteConfirmOpen(true);
                              }}
                              className="button-interactive"
                            >
                              <Trash size={16} className="mr-1" />
                              Clear Time Blocks
                            </Button>
                            <Button
                              variant="destructive"
                              size="sm"
                              onClick={() => {
                                setBulkDeleteTarget('timeEntries');
                                setBulkDeleteConfirmOpen(true);
                              }}
                              className="button-interactive"
                            >
                              <Trash size={16} className="mr-1" />
                              Clear Time Entries
                            </Button>
                            <Button
                              variant="destructive"
                              size="sm"
                              onClick={() => {
                                setBulkDeleteTarget('todos');
                                setBulkDeleteConfirmOpen(true);
                              }}
                              className="button-interactive"
                            >
                              <Trash size={16} className="mr-1" />
                              Clear Todos
                            </Button>
                            <Button
                              variant="destructive"
                              size="sm"
                              onClick={() => {
                                setBulkDeleteTarget('events');
                                setBulkDeleteConfirmOpen(true);
                              }}
                              className="button-interactive"
                            >
                              <Trash size={16} className="mr-1" />
                              Clear Events
                            </Button>
                            <Button
                              variant="destructive"
                              size="sm"
                              onClick={() => {
                                setBulkDeleteTarget('projects');
                                setBulkDeleteConfirmOpen(true);
                              }}
                              className="button-interactive"
                            >
                              <Trash size={16} className="mr-1" />
                              Clear Projects
                            </Button>
                            <Button
                              variant="destructive"
                              size="sm"
                              onClick={() => {
                                setBulkDeleteTarget('all');
                                setBulkDeleteConfirmOpen(true);
                              }}
                              className="button-interactive"
                            >
                              <Trash size={16} className="mr-1" />
                              Clear Everything
                            </Button>
                          </div>
                          <p className="text-xs text-muted-foreground mt-2">
                            Deletions are permanent and cannot be undone.
                          </p>
                        </div>
                      </div>
                    </div>
                  </Card>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </main>
      </div>

      <div className="fixed bottom-6 right-6 z-40 flex flex-col gap-2 items-end">
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setIsSearchOpen(true)}
            className="text-xs gap-1.5 rounded-full shadow"
          >
            <MagnifyingGlass size={13} /> ⌘F
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setIsQuickCaptureOpen(true)}
            className="text-xs gap-1.5 rounded-full shadow"
          >
            <Plus size={13} /> ⌘N
          </Button>
        </div>
        <Button
          onClick={() => setIsAIPopupOpen(true)}
          className="rounded-full shadow-lg px-4 gap-2"
        >
          <Sparkle size={16} />
          AI <span className="text-xs opacity-70">⌘K</span>
        </Button>
      </div>

      <Dialog open={isAIPopupOpen} onOpenChange={setIsAIPopupOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[88vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>AI Assistant</DialogTitle>
          </DialogHeader>
          <AIAssistantView compact />
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={bulkDeleteConfirmOpen}
        onOpenChange={(open) => {
          setBulkDeleteConfirmOpen(open);
          if (!open) setBulkDeleteTarget(null);
        }}
        title={bulkDeleteTarget ? bulkDeleteMeta[bulkDeleteTarget].title : 'Delete data?'}
        description={bulkDeleteTarget ? bulkDeleteMeta[bulkDeleteTarget].description : 'This action cannot be undone.'}
        actionType="delete"
        variant="destructive"
        confirmText="Delete"
        cancelText="Cancel"
        onConfirm={handleBulkDeleteConfirm}
      />

      <QuickCapture open={isQuickCaptureOpen} onClose={() => setIsQuickCaptureOpen(false)} />
      <UniversalSearch
        open={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
        onNavigate={setCurrentView}
      />

      <AnimatePresence>
        {showMorningFlow && (
          <MorningFlow
            briefing={morningBriefing}
            onDismiss={() => setShowMorningFlow(false)}
          />
        )}
        {showEveningFlow && (
          <EveningFlow onDismiss={() => setShowEveningFlow(false)} />
        )}
        {showWeeklyReview && (
          <WeeklyReview
            onDismiss={() => {
              setShowWeeklyReview(false);
              setWeeklyIntention(localStorage.getItem('weeklyIntention') ?? '');
            }}
          />
        )}
      </AnimatePresence>

      <Toaster />
    </div>
  );
}

export default App;
