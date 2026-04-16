import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Toaster } from '@/components/ui/sonner';
import { Sidebar } from '@/components/Sidebar';
import { CountdownHero } from '@/components/CountdownHero';
import { EventsView } from '@/components/EventsView';
import { TodosView } from '@/components/TodosView';
import { TimelineView } from '@/components/TimelineView';
import { WeeklyCalendarView } from '@/components/WeeklyCalendarView';
import { StatisticsView } from '@/components/StatisticsView';
import { TimeTrackingView } from '@/components/TimeTrackingView';
import { initDB } from '@/db/core';
import { seedDatabase } from '@/db/seed';
import { getNextImportantEvent, getAllEvents } from '@/db/repositories/eventsRepo';
import { getAllTodos } from '@/db/repositories/todosRepo';
import { getSettings, updateSettings } from '@/db/repositories/settingsRepo';
import { Event, Todo, Settings } from '@/db/schema';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Plus, CalendarBlank, Sun, Moon, Monitor, DownloadSimple, UploadSimple } from '@phosphor-icons/react';
import { format } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import { useTheme } from '@/hooks/use-theme';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { exportAllData, downloadJSON, exportTimeEntriesCSV, exportEventsCSV, exportTodosCSV, importAllData, ExportData } from '@/db/export';
import { toast } from 'sonner';

function App() {
  const [currentView, setCurrentView] = useState('home');
  const [nextEvent, setNextEvent] = useState<Event | null>(null);
  const [upcomingEvents, setUpcomingEvents] = useState<Event[]>([]);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const { theme, setTheme, resolvedTheme } = useTheme();

  useEffect(() => {
    async function initialize() {
      try {
        await initDB();
        await seedDatabase();
        
        const appSettings = await getSettings();
        setSettings(appSettings);
        
        const important = await getNextImportantEvent(appSettings.importantPriorityThreshold);
        setNextEvent(important);
        
        const allEvents = await getAllEvents();
        const upcoming = allEvents
          .filter(e => new Date(e.startsAt) > new Date())
          .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
          .slice(0, 5);
        setUpcomingEvents(upcoming);
        
        const allTodos = await getAllTodos();
        setTodos(allTodos.filter(t => t.status !== 'done'));
      } catch (error) {
        console.error('Failed to initialize:', error);
      } finally {
        setIsLoading(false);
      }
    }

    initialize();
  }, []);

  useEffect(() => {
    if (currentView === 'home') {
      loadHomeData();
    }
  }, [currentView]);

  async function loadHomeData() {
    const appSettings = await getSettings();
    const important = await getNextImportantEvent(appSettings.importantPriorityThreshold);
    setNextEvent(important);
    
    const allEvents = await getAllEvents();
    const upcoming = allEvents
      .filter(e => new Date(e.startsAt) > new Date())
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
      .slice(0, 5);
    setUpcomingEvents(upcoming);
    
    const allTodos = await getAllTodos();
    setTodos(allTodos.filter(t => t.status !== 'done'));
  }

  async function handleExportJSON() {
    try {
      const data = await exportAllData();
      downloadJSON(data, `ghcountdown-backup-${new Date().toISOString().split('T')[0]}.json`);
      toast.success('Data exported successfully!');
    } catch (error) {
      console.error('Export failed:', error);
      toast.error('Failed to export data');
    }
  }

  async function handleExportTimeCSV() {
    try {
      await exportTimeEntriesCSV();
      toast.success('Time entries exported!');
    } catch (error) {
      console.error('Export failed:', error);
      toast.error('Failed to export time entries');
    }
  }

  async function handleExportEventsCSV() {
    try {
      await exportEventsCSV();
      toast.success('Events exported!');
    } catch (error) {
      console.error('Export failed:', error);
      toast.error('Failed to export events');
    }
  }

  async function handleExportTodosCSV() {
    try {
      await exportTodosCSV();
      toast.success('Todos exported!');
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
        toast.success('Data imported successfully! Refreshing...');
        setTimeout(() => window.location.reload(), 1500);
      } catch (error) {
        console.error('Import failed:', error);
        toast.error('Failed to import data. Please check the file format.');
      }
    };

    input.click();
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

                <CountdownHero event={nextEvent} />

                <div className="grid md:grid-cols-2 gap-6">
                  <Card className="p-6">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-lg font-semibold">Upcoming Events</h3>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setCurrentView('events')}
                      >
                        <Plus size={16} className="mr-1" />
                        Add
                      </Button>
                    </div>

                    {upcomingEvents.length === 0 ? (
                      <div className="text-center py-8 text-muted-foreground">
                        <CalendarBlank size={48} className="mx-auto mb-2 opacity-50" />
                        <p>No upcoming events</p>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <AnimatePresence mode="popLayout">
                          {upcomingEvents.map((event, index) => (
                            <motion.div
                              key={event.id}
                              initial={{ opacity: 0, x: -20 }}
                              animate={{ opacity: 1, x: 0 }}
                              exit={{ opacity: 0, x: 20 }}
                              transition={{ delay: index * 0.05 }}
                              onClick={() => setCurrentView('events')}
                              className="p-3 rounded-lg border bg-card hover:bg-accent/5 transition-all duration-200 cursor-pointer hover:shadow-sm"
                            >
                              <div className="flex items-start justify-between">
                                <div className="flex-1">
                                  <h4 className="font-medium">{event.title}</h4>
                                  <p className="text-sm text-muted-foreground">
                                    {format(new Date(event.startsAt), 'MMM d • h:mm a')}
                                  </p>
                                </div>
                                <Badge variant="outline">P{event.priority}</Badge>
                              </div>
                            </motion.div>
                          ))}
                        </AnimatePresence>
                      </div>
                    )}
                  </Card>

                  <Card className="p-6">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-lg font-semibold">Today's Tasks</h3>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setCurrentView('todos')}
                      >
                        <Plus size={16} className="mr-1" />
                        Add
                      </Button>
                    </div>

                    {todos.filter(t => t.status === 'today').length === 0 ? (
                      <div className="text-center py-8 text-muted-foreground">
                        <p>No tasks for today</p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <AnimatePresence mode="popLayout">
                          {todos.filter(t => t.status === 'today').map((todo, index) => (
                            <motion.div
                              key={todo.id}
                              initial={{ opacity: 0, x: -20 }}
                              animate={{ opacity: 1, x: 0 }}
                              exit={{ opacity: 0, x: 20 }}
                              transition={{ delay: index * 0.05 }}
                              onClick={() => setCurrentView('todos')}
                              className="flex items-center gap-3 p-2 rounded hover:bg-accent/5 transition-all duration-200 cursor-pointer"
                            >
                              <div className="w-4 h-4 rounded border-2"></div>
                              <span className="flex-1">{todo.title}</span>
                              {todo.priority >= 4 && (
                                <Badge variant="destructive" className="text-xs">High</Badge>
                              )}
                            </motion.div>
                          ))}
                        </AnimatePresence>
                      </div>
                    )}
                  </Card>
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

            {currentView === 'weekly' && (
              <motion.div
                key="weekly"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.3 }}
              >
                <WeeklyCalendarView />
              </motion.div>
            )}

            {currentView === 'time-tracking' && (
              <motion.div
                key="time-tracking"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.3 }}
              >
                <TimeTrackingView />
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
                      </div>
                    </div>
                  </Card>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </main>
      </div>

      <Toaster />
    </div>
  );
}

export default App;