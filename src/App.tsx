import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Toaster } from '@/components/ui/sonner';
import { Sidebar } from '@/components/Sidebar';
import { HomeView } from '@/components/HomeView';
import { GoalsSettingsCard } from '@/components/GoalsSettingsCard';
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
import { deleteAllTodos, getAllTodos, updateTodo } from '@/db/repositories/todosRepo';
import { getSettings, updateSettings } from '@/db/repositories/settingsRepo';
import { deleteAllProjects } from '@/db/repositories/projectsRepo';
import { deleteAllTimeEntries, getAllTimeEntries } from '@/db/repositories/timeRepo';
import { deleteAllTimeBlocks, getTimeBlocksByDate, getAllTimeBlocks } from '@/db/repositories/timeBlocksRepo';
import { getAllGoals, getActiveGoals, deleteAllGoals } from '@/db/repositories/goalsRepo';
import { Event, Todo, TimeBlock, Settings, Goal } from '@/db/schema';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Sun, Moon, Monitor, DownloadSimple, UploadSimple, Trash, Sparkle, MagnifyingGlass, Plus, Timer } from '@phosphor-icons/react';
import { format } from 'date-fns';
import { useTheme } from '@/hooks/use-theme';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { exportAllData, downloadJSON, exportTimeEntriesCSV, exportEventsCSV, exportTodosCSV, importAllData, ExportData } from '@/db/export';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast as notifications } from 'sonner';
import { getAIConfiguration, updateAIConfiguration, generateActionPlan } from '@/lib/aiPlanner';
import { performDailyRollover } from '@/lib/rollover';
import { escalateOverdueTodos } from '@/lib/overdueCheck';
import { detectDrift } from '@/lib/habitModel';
import { weeklyReviewKey } from '@/lib/weeklyTrajectory';
import { getEffectiveScheduleForDate } from '@/lib/effectiveSchedule';

function App() {
  function formatCountdown(seconds: number): string {
    const safe = Math.max(0, seconds);
    const h = Math.floor(safe / 3600);
    const m = Math.floor((safe % 3600) / 60);
    const s = safe % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  const [currentView, setCurrentView] = useState('home');
  const [nextEvent, setNextEvent] = useState<Event | null>(null);
  const [upcomingEvents, setUpcomingEvents] = useState<Event[]>([]);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [todayBlocks, setTodayBlocks] = useState<TimeBlock[]>([]);
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
  const [activeGoals, setActiveGoals] = useState<Goal[]>([]);
  const [nowTick, setNowTick] = useState(new Date());
  const { theme, setTheme, resolvedTheme } = useTheme();

  // Sync weeklyIntention from localStorage whenever the review modal closes
  useEffect(() => {
    if (!showWeeklyReview) {
      setWeeklyIntention(localStorage.getItem('weeklyIntention') ?? '');
    }
  }, [showWeeklyReview]);

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

        setTodayBlocks(await loadTodayTimelineBlocks());

        const rolledOver = await performDailyRollover();
        if (rolledOver.length > 0) {
          notifications.info(`🔄 ${rolledOver.length} unfinished todo${rolledOver.length !== 1 ? 's' : ''} rolled over from yesterday`);
        }

        const escalated = await escalateOverdueTodos();
        if (escalated > 0) {
          notifications.warning(`⚠️ ${escalated} overdue todo${escalated !== 1 ? 's' : ''} escalated to critical priority`);
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

  useEffect(() => {
    const timer = setInterval(() => setNowTick(new Date()), 1_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    let active = true;
    const refreshTodayBlocks = async () => {
      const blocks = await loadTodayTimelineBlocks();
      if (active) {
        setTodayBlocks(blocks);
      }
    };

    void refreshTodayBlocks();
    const timer = setInterval(() => { void refreshTodayBlocks(); }, 30_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    const onDataChange = () => setDataVersion((v) => v + 1);
    window.addEventListener('ghc-data-changed', onDataChange);
    window.addEventListener('app:datachange', onDataChange);
    return () => {
      window.removeEventListener('ghc-data-changed', onDataChange);
      window.removeEventListener('app:datachange', onDataChange);
    };
  }, []);

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

    setTodayBlocks(await loadTodayTimelineBlocks());

    const allGoals = await getAllGoals();
    setActiveGoals(allGoals.filter(g => g.status === 'active'));

    void generateNudges(upcoming, activeTodos);
  }

  async function generateMorningBriefing() {
    try {
      const config = getAIConfiguration();
      if (!config.apiKey) return;
      const allTodos = await getAllTodos();
      const allEvents = await getAllEvents();
      const goals = await getActiveGoals();
      const todayTodos = allTodos.filter(t => t.status === 'today');
      const urgentEvents = allEvents
        .filter(e => {
          const h = (new Date(e.startsAt).getTime() - Date.now()) / 3600000;
          return h > 0 && h <= 48;
        })
        .slice(0, 3);
      const goalsSummary = goals.length > 0
        ? goals.map(g => `"${g.title}" (why: ${g.why || 'unspecified'})`).join('; ')
        : 'none';
      const briefingPrompt = [
        'Generate a short morning briefing (2-3 sentences max).',
        `Today's tasks: ${todayTodos.map(t => `${t.title}(P${t.priority})`).join(', ') || 'none'}`,
        `Upcoming deadlines: ${urgentEvents.map(e => `${e.title} in ${Math.round((new Date(e.startsAt).getTime() - Date.now()) / 3600000)}h`).join(', ') || 'none'}`,
        `Active goals: ${goalsSummary}`,
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
        activeGoals: goalsSummary,
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
      notifications.success('Data exported');
    } catch (error) {
      console.error('Export failed:', error);
      notifications.error('Failed to export data');
    }
  }

  async function handleExportTimeCSV() {
    try {
      await exportTimeEntriesCSV();
      notifications.success('Time entries exported');
    } catch (error) {
      console.error('Export failed:', error);
      notifications.error('Failed to export time entries');
    }
  }

  async function handleExportEventsCSV() {
    try {
      await exportEventsCSV();
      notifications.success('Events exported');
    } catch (error) {
      console.error('Export failed:', error);
      notifications.error('Failed to export events');
    }
  }

  async function handleExportTodosCSV() {
    try {
      await exportTodosCSV();
      notifications.success('Todos exported');
    } catch (error) {
      console.error('Export failed:', error);
      notifications.error('Failed to export todos');
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
        notifications.success('Data imported — refreshing...');
        setTimeout(() => window.location.reload(), 1500);
      } catch (error) {
        console.error('Import failed:', error);
        notifications.error('Import failed — check the file format');
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
            deleteAllGoals(),
          ]);
          break;
      }

      await loadHomeData();
      notifications.success(bulkDeleteMeta[bulkDeleteTarget].successMessage);
    } catch (error) {
      notifications.error('Failed to delete data');
      throw error;
    } finally {
      setBulkDeleteTarget(null);
    }
  }

  // Stable callbacks passed to HomeView
  const handleNavigate = useCallback((view: string) => setCurrentView(view), []);

  const handleCompleteTodo = useCallback(async (todoId: string) => {
    await updateTodo(todoId, { status: 'done' });
    await loadHomeData();
  }, []);

  const handleDismissMorningBriefing = useCallback(() => setMorningBriefing(null), []);

  const handleShowWeeklyReview = useCallback(() => setShowWeeklyReview(true), []);

  async function loadTodayTimelineBlocks(): Promise<TimeBlock[]> {
    const dateStr = format(new Date(), 'yyyy-MM-dd');
    const blocks = await getTimeBlocksByDate(dateStr);
    if (blocks.length > 0) {
      return blocks.sort((a, b) => a.startTime.localeCompare(b.startTime));
    }

    const effective = await getEffectiveScheduleForDate(dateStr);
    const now = new Date().toISOString();
    return effective
      .map<TimeBlock>((entry) => ({
        id: `routine-${entry.id}-${dateStr}`,
        title: entry.title,
        date: dateStr,
        startTime: entry.startTime,
        endTime: entry.endTime,
        todoId: null,
        projectId: null,
        locationId: entry.locationId,
        color: entry.color,
        autoTrack: false,
        slotType: entry.kind === 'flex' ? 'flex-todo' : 'fixed',
        createdAt: now,
        updatedAt: now,
      }))
      .sort((a, b) => a.startTime.localeCompare(b.startTime));
  }

  const { activeRoutineBlock, nextRoutineBlock, activeRemainingSeconds, nextStartsInSeconds } = useMemo(() => {
    const currentHHMM = format(nowTick, 'HH:mm');
    const active = todayBlocks.find((block) => block.startTime <= currentHHMM && currentHHMM < block.endTime) ?? null;
    const next = todayBlocks.find((block) => block.startTime > currentHHMM) ?? null;

    if (!active && !next) {
      return {
        activeRoutineBlock: null,
        nextRoutineBlock: null,
        activeRemainingSeconds: null,
        nextStartsInSeconds: null,
      };
    }

    const nowSeconds = nowTick.getHours() * 3600 + nowTick.getMinutes() * 60 + nowTick.getSeconds();
    const activeRemaining = active
      ? (() => {
          const [endHour, endMinute] = active.endTime.split(':').map(Number);
          return Math.max(0, (endHour * 3600 + endMinute * 60) - nowSeconds);
        })()
      : null;

    const nextStartsIn = next
      ? (() => {
          const [startHour, startMinute] = next.startTime.split(':').map(Number);
          return Math.max(0, (startHour * 3600 + startMinute * 60) - nowSeconds);
        })()
      : null;

    return {
      activeRoutineBlock: active,
      nextRoutineBlock: next,
      activeRemainingSeconds: activeRemaining,
      nextStartsInSeconds: nextStartsIn,
    };
  }, [todayBlocks, nowTick]);

  const showFloatingRoutineCard = currentView !== 'home' && Boolean(activeRoutineBlock || nextRoutineBlock);

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
                initial={false}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.3 }}
              >
                <HomeView
                  nextEvent={nextEvent}
                  upcomingEvents={upcomingEvents}
                  todos={todos}
                  todayBlocks={todayBlocks}
                  activeGoals={activeGoals}
                  morningBriefing={morningBriefing}
                  aiNudges={aiNudges}
                  weeklyIntention={weeklyIntention}
                  onNavigate={handleNavigate}
                  onCompleteTodo={handleCompleteTodo}
                  onDismissMorningBriefing={handleDismissMorningBriefing}
                  onShowWeeklyReview={handleShowWeeklyReview}
                />
              </motion.div>
            )}

            {currentView === 'events' && (
              <motion.div
                key="events"
                initial={false}
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
                initial={false}
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
                initial={false}
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
                initial={false}
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
                initial={false}
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
                  <GoalsSettingsCard />

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
                          notifications.success('Priority threshold updated');
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
        <AnimatePresence>
          {showFloatingRoutineCard && (
            <motion.div
              initial={{ opacity: 0, y: 12, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.97 }}
              transition={{ type: 'spring', stiffness: 260, damping: 24 }}
            >
              <Card className="w-[320px] max-w-[calc(100vw-2rem)] p-3 shadow-lg border-primary/30 bg-card/95 backdrop-blur">
                <div className="flex items-start gap-2">
                  <motion.div
                    animate={{ y: [0, -2, 0] }}
                    transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
                  >
                    <Timer size={16} className="mt-0.5 text-primary" />
                  </motion.div>
                  <div className="min-w-0 flex-1">
                    {activeRoutineBlock ? (
                      <>
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">Now</p>
                        <p className="text-sm font-semibold truncate">
                          {formatCountdown(activeRemainingSeconds ?? 0)} left · {activeRoutineBlock.title}
                        </p>
                      </>
                    ) : (
                      <>
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">Next up</p>
                        <p className="text-sm font-semibold truncate">
                          in {formatCountdown(nextStartsInSeconds ?? 0)} · {nextRoutineBlock?.title}
                        </p>
                      </>
                    )}
                    {nextRoutineBlock && (
                      <p className="text-xs text-muted-foreground truncate mt-1">
                        Starts at {nextRoutineBlock.startTime}
                      </p>
                    )}
                    <div className="mt-2 h-1 rounded-full bg-primary/15 overflow-hidden">
                      <motion.div
                        className="h-full bg-primary"
                        key={`${activeRoutineBlock?.id ?? 'next'}-${activeRemainingSeconds ?? nextStartsInSeconds ?? 0}`}
                        initial={{ width: '100%' }}
                        animate={{ width: '0%' }}
                        transition={{ duration: 1, ease: 'linear' }}
                      />
                    </div>
                  </div>
                </div>
              </Card>
            </motion.div>
          )}
        </AnimatePresence>
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
            onDismiss={() => setShowWeeklyReview(false)}
          />
        )}
      </AnimatePresence>

      <Toaster />
    </div>
  );
}

export default App;
