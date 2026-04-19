import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Toaster } from '@/components/ui/sonner';
import { Sidebar } from '@/components/Sidebar';
import { MomentumStrip } from '@/components/MomentumStrip';
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
import { getAllGoals, getActiveGoals, createGoal, updateGoal, deleteGoal, deleteAllGoals } from '@/db/repositories/goalsRepo';
import { Event, Todo, TimeBlock, Settings, Goal } from '@/db/schema';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Sun, Moon, Monitor, DownloadSimple, UploadSimple, Trash, Sparkle, X, MagnifyingGlass, Plus } from '@phosphor-icons/react';
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
  const [goals, setGoals] = useState<Goal[]>([]);
  const [newGoalTitle, setNewGoalTitle] = useState('');
  const [showWeeklyReview, setShowWeeklyReview] = useState(false);
  const [weeklyIntention, setWeeklyIntention] = useState(() => localStorage.getItem('weeklyIntention') ?? '');
  const [activeGoals, setActiveGoals] = useState<Goal[]>([]);
  const [countdownTick, setCountdownTick] = useState(Date.now());
  const { theme, setTheme, resolvedTheme } = useTheme();

  function invalidateCache() { setDataVersion(v => v + 1); }

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

        const blocks = await getTimeBlocksByDate(format(new Date(), 'yyyy-MM-dd'));
        setTodayBlocks(blocks.sort((a, b) => a.startTime.localeCompare(b.startTime)));

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

  // Tick every minute so the "RIGHT NOW" card updates automatically
  useEffect(() => {
    const id = setInterval(() => setNowTick(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  // Tick every second for the countdown hero
  useEffect(() => {
    const id = setInterval(() => setCountdownTick(Date.now()), 1000);
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

    const allGoals = await getAllGoals();
    setGoals(allGoals);
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
        `Today\'s tasks: ${todayTodos.map(t => `${t.title}(P${t.priority})`).join(', ') || 'none'}`,
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

  // Home view derived values
  const countdownTimeLeft = nextEvent ? (() => {
    const diff = new Date(nextEvent.startsAt).getTime() - countdownTick;
    if (diff <= 0) return null;
    return {
      days: Math.floor(diff / (1000 * 60 * 60 * 24)),
      hours: Math.floor((diff / (1000 * 60 * 60)) % 24),
      minutes: Math.floor((diff / 1000 / 60) % 60),
      seconds: Math.floor((diff / 1000) % 60),
    };
  })() : null;

  const currentHHMM = format(nowTick, 'HH:mm');
  const activeBlock = todayBlocks.find(b => b.startTime <= currentHHMM && currentHHMM < b.endTime) ?? null;
  const nextUpcomingBlock = !activeBlock
    ? (todayBlocks.find(b => b.startTime > currentHHMM) ?? null)
    : null;

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
                className="max-w-6xl mx-auto flex flex-col gap-8"
              >
                {/* ── COUNTDOWN HERO ── */}
                <div className="glass-card rounded-3xl p-8 md:p-12 relative overflow-hidden">
                  {nextEvent ? (
                    <>
                      <div
                        className="absolute top-0 left-0 right-0 h-1"
                        style={{ backgroundColor: `var(--priority-${nextEvent.priority})` }}
                      />
                      <div className="text-center mb-8">
                        <p className="text-xs uppercase tracking-widest text-muted-foreground mb-3">Counting down to</p>
                        <h1 className="text-3xl md:text-5xl font-bold tracking-tight mb-3">{nextEvent.title}</h1>
                        <p className="text-sm text-muted-foreground">
                          {format(new Date(nextEvent.startsAt), 'EEEE, MMMM d, yyyy • h:mm a')}
                        </p>
                      </div>
                      {countdownTimeLeft ? (
                        <div className="grid grid-cols-4 gap-4 md:gap-10">
                          {[
                            { label: 'Days', value: countdownTimeLeft.days },
                            { label: 'Hours', value: countdownTimeLeft.hours },
                            { label: 'Minutes', value: countdownTimeLeft.minutes },
                            { label: 'Seconds', value: countdownTimeLeft.seconds },
                          ].map(({ label, value }, i) => (
                            <motion.div
                              key={label}
                              initial={{ opacity: 0, scale: 0.85 }}
                              animate={{ opacity: 1, scale: 1 }}
                              transition={{ delay: 0.1 + i * 0.05 }}
                              className="text-center"
                            >
                              <div className="text-5xl md:text-7xl font-bold tabular-nums text-primary tracking-tighter">
                                {String(value).padStart(2, '0')}
                              </div>
                              <div className="text-xs text-muted-foreground uppercase tracking-wide mt-1">
                                {label}
                              </div>
                            </motion.div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-center text-muted-foreground py-4">This event has passed</p>
                      )}
                    </>
                  ) : (
                    <div className="text-center py-4">
                      <h2 className="text-2xl font-semibold mb-2">No upcoming events</h2>
                      <p className="text-muted-foreground text-sm">
                        Add an important event to start counting down
                      </p>
                    </div>
                  )}
                </div>

                {/* ── MAIN CONTENT: asymmetric two-column grid ── */}
                <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 lg:gap-8">

                  {/* LEFT COLUMN — action-oriented */}
                  <div className="lg:col-span-3 flex flex-col gap-6">

                    {/* Right Now — no card border */}
                    <motion.div
                      key="right-now"
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.1 }}
                      className="rounded-2xl px-4 py-5 bg-muted/30"
                    >
                      <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">
                        Right Now
                      </p>
                      {activeBlock ? (
                        <div className="flex items-start gap-3">
                          <span
                            className="animate-pulse w-2.5 h-2.5 rounded-full mt-1.5 flex-shrink-0"
                            style={{ backgroundColor: activeBlock.color }}
                          />
                          <div>
                            <p className="text-xl font-semibold leading-tight">{activeBlock.title}</p>
                            <p className="text-sm text-muted-foreground mt-0.5">
                              {activeBlock.startTime}–{activeBlock.endTime}
                              {(() => {
                                const [eh, em] = activeBlock.endTime.split(':').map(Number);
                                const remain = (eh * 60 + em) - (nowTick.getHours() * 60 + nowTick.getMinutes());
                                return remain > 0 ? ` · ${remain} min remaining` : '';
                              })()}
                            </p>
                          </div>
                        </div>
                      ) : nextUpcomingBlock ? (
                        <div className="flex items-start gap-3">
                          <span
                            className="w-2.5 h-2.5 rounded-full mt-1.5 flex-shrink-0 opacity-40"
                            style={{ backgroundColor: nextUpcomingBlock.color }}
                          />
                          <div>
                            <p className="text-sm text-muted-foreground">Up next</p>
                            <p className="text-xl font-semibold leading-tight">{nextUpcomingBlock.title}</p>
                            <p className="text-sm text-muted-foreground mt-0.5">
                              {nextUpcomingBlock.startTime}
                              {' · '}
                              {(() => {
                                const [sh, sm] = nextUpcomingBlock.startTime.split(':').map(Number);
                                const inMin = (sh * 60 + sm) - (nowTick.getHours() * 60 + nowTick.getMinutes());
                                return inMin >= 60
                                  ? `in ${Math.floor(inMin / 60)}h${inMin % 60 > 0 ? ` ${inMin % 60}m` : ''}`
                                  : `in ${inMin}m`;
                              })()}
                            </p>
                          </div>
                        </div>
                      ) : (
                        <p className="text-xl font-semibold">
                          Free time
                          <span className="ml-2 text-sm font-normal text-muted-foreground">
                            No more blocks today
                          </span>
                        </p>
                      )}
                    </motion.div>

                    {/* Today's Schedule — colored pill timeline */}
                    <motion.div
                      key="todays-schedule"
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.15 }}
                    >
                      <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">
                        Today's Schedule
                      </p>
                      {todayBlocks.length > 0 ? (
                        <div className="flex flex-wrap gap-1.5">
                          {todayBlocks.map(block => (
                            <button
                              key={block.id}
                              type="button"
                              onClick={() => setCurrentView('timeline')}
                              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-opacity hover:opacity-80"
                              style={{
                                backgroundColor: `${block.color}28`,
                                color: block.color,
                                border: `1px solid ${block.color}50`,
                              }}
                            >
                              <span className="tabular-nums">{block.startTime}</span>
                              <span>{block.title}</span>
                            </button>
                          ))}
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setCurrentView('timeline')}
                          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                        >
                          Nothing scheduled — Schedule My Day →
                        </button>
                      )}
                    </motion.div>

                    {/* Focus Tasks — priority 4 & 5 only, max 4 */}
                    <motion.div
                      key="focus-tasks"
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.2 }}
                    >
                      <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">
                        Focus Tasks
                      </p>
                      {todos.filter(t => t.status === 'today' && t.priority >= 4).length === 0 ? (
                        <p className="text-sm text-muted-foreground">No high-priority tasks for today</p>
                      ) : (
                        <div className="flex flex-col gap-2">
                          {todos.filter(t => t.status === 'today' && t.priority >= 4).slice(0, 4).map(todo => (
                            <div
                              key={todo.id}
                              className="flex items-center gap-3 rounded-lg px-3 py-2 bg-muted/20"
                              style={todo.priority === 5 ? { borderLeft: '3px solid var(--destructive)' } : {}}
                            >
                              <Checkbox
                                className="flex-shrink-0"
                                onCheckedChange={async () => {
                                  await updateTodo(todo.id, { status: 'done' });
                                  await loadHomeData();
                                }}
                              />
                              <span className="flex-1 text-sm truncate">{todo.title}</span>
                              <span className="text-xs text-muted-foreground shrink-0">P{todo.priority}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={() => setCurrentView('todos')}
                        className="mt-3 text-xs text-muted-foreground hover:text-foreground transition-colors"
                      >
                        See all tasks →
                      </button>
                    </motion.div>
                  </div>

                  {/* RIGHT COLUMN — context and insight */}
                  <div className="lg:col-span-2 flex flex-col gap-5">

                    {/* Morning briefing — blockquote style */}
                    {morningBriefing && (
                      <motion.div
                        key="morning-briefing"
                        initial={{ opacity: 0, x: 10 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: 0.1 }}
                        className="relative rounded-xl pl-4 pr-8 py-3 bg-primary/5 border-l-2 border-l-primary"
                      >
                        <Sparkle size={13} weight="fill" className="text-primary absolute top-3 right-3" />
                        <p className="text-sm leading-relaxed">{morningBriefing}</p>
                        <button
                          type="button"
                          onClick={() => setMorningBriefing(null)}
                          className="absolute top-2 right-2 text-muted-foreground hover:text-foreground"
                        >
                          <X size={13} />
                        </button>
                      </motion.div>
                    )}

                    {/* Weekly intention */}
                    {weeklyIntention && (
                      <motion.div
                        key="weekly-intention"
                        initial={{ opacity: 0, x: 10 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: 0.12 }}
                        className="rounded-xl pl-4 py-3 pr-3 bg-muted/40 border-l-2 border-l-primary/40"
                      >
                        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-1">
                          This week
                        </p>
                        <p className="text-sm leading-relaxed">{weeklyIntention}</p>
                        <button
                          type="button"
                          className="mt-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                          onClick={() => setShowWeeklyReview(true)}
                        >
                          Review →
                        </button>
                      </motion.div>
                    )}

                    {/* Goals progress — thin rows, no card border */}
                    {activeGoals.length > 0 && (
                      <motion.div
                        key="goals-progress"
                        initial={{ opacity: 0, x: 10 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: 0.15 }}
                        className="flex flex-col gap-3"
                      >
                        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                          Goals
                        </p>
                        {activeGoals.slice(0, 4).map(goal => {
                          const linked = todos.filter(t => t.goalId === goal.id);
                          const done = linked.filter(t => t.status === 'done').length;
                          const pct = linked.length > 0 ? Math.round((done / linked.length) * 100) : 0;
                          return (
                            <div key={goal.id}>
                              <div className="flex items-center gap-2 mb-1">
                                <span
                                  className="w-2 h-2 rounded-full flex-shrink-0"
                                  style={{ backgroundColor: goal.color }}
                                />
                                <span className="text-sm flex-1 truncate">{goal.title}</span>
                                <span className="text-xs text-muted-foreground">{pct}%</span>
                              </div>
                              <div className="w-full bg-muted rounded-full h-1 overflow-hidden">
                                <div
                                  className="rounded-full h-1 transition-all duration-500"
                                  style={{ width: `${pct}%`, backgroundColor: goal.color }}
                                />
                              </div>
                            </div>
                          );
                        })}
                      </motion.div>
                    )}

                    {/* Upcoming events — max 3, minimal rows */}
                    {upcomingEvents.length > 0 && (
                      <motion.div
                        key="upcoming-events"
                        initial={{ opacity: 0, x: 10 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: 0.2 }}
                        className="flex flex-col gap-1"
                      >
                        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-1">
                          Upcoming
                        </p>
                        {upcomingEvents.slice(0, 3).map(evt => (
                          <button
                            key={evt.id}
                            type="button"
                            onClick={() => setCurrentView('events')}
                            className="flex items-center gap-2 text-sm text-left hover:bg-muted/40 rounded-lg px-2 py-1.5 transition-colors"
                          >
                            <span
                              className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                              style={{ backgroundColor: `var(--priority-${evt.priority})` }}
                            />
                            <span className="flex-1 truncate">{evt.title}</span>
                            <span className="text-xs text-muted-foreground shrink-0">
                              {format(new Date(evt.startsAt), 'MMM d')}
                            </span>
                            {evt.priority >= 4 && (
                              <span className={`text-xs px-1.5 py-0.5 rounded font-medium shrink-0 ${evt.priority === 5 ? 'bg-destructive/15 text-destructive' : 'bg-yellow-500/15 text-yellow-600 dark:text-yellow-400'}`}>
                                P{evt.priority}
                              </span>
                            )}
                          </button>
                        ))}
                      </motion.div>
                    )}

                    {/* AI nudges — max 2 */}
                    {aiNudges.length > 0 && (
                      <motion.div
                        key="ai-nudges"
                        initial={{ opacity: 0, x: 10 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: 0.25 }}
                        className="flex flex-col gap-1.5"
                      >
                        {aiNudges.slice(0, 2).map((nudge, i) => (
                          <div key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                            <Sparkle size={12} weight="fill" className="text-yellow-500 mt-0.5 flex-shrink-0" />
                            <span>{nudge}</span>
                          </div>
                        ))}
                      </motion.div>
                    )}

                    {/* Momentum — compact inline stats */}
                    <motion.div
                      key="momentum"
                      initial={{ opacity: 0, x: 10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.28 }}
                    >
                      <MomentumStrip compact />
                    </motion.div>
                  </div>
                </div>
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
