import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Toaster } from '@/components/ui/sonner';
import { Sidebar } from '@/components/Sidebar';
import { CountdownHero } from '@/components/CountdownHero';
import { EventsView } from '@/components/EventsView';
import { TodosView } from '@/components/TodosView';
import { TimeTrackingView } from '@/components/TimeTrackingView';
import { initDB } from '@/db/core';
import { seedDatabase } from '@/db/seed';
import { getNextImportantEvent, getAllEvents } from '@/db/repositories/eventsRepo';
import { getAllTodos } from '@/db/repositories/todosRepo';
import { getSettings, updateSettings } from '@/db/repositories/settingsRepo';
import { Event, Todo, Settings } from '@/db/schema';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Plus, CalendarBlank, Sun, Moon, Monitor } from '@phosphor-icons/react';
import { format } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import { useTheme } from '@/hooks/use-theme';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';

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
    <div className="flex min-h-screen">
      <div className="noise-texture"></div>
      
      <Sidebar currentView={currentView} onNavigate={setCurrentView} />
      
      <main className="flex-1 p-8 relative z-10">
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

          {currentView === 'time' && (
            <motion.div
              key="time"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.3 }}
            >
              <TimeTrackingView />
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
                      <Select value={theme} onValueChange={(value: any) => setTheme(value)}>
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
                    <p className="text-sm text-muted-foreground mb-2">
                      Events with this priority or higher appear in the countdown hero
                    </p>
                    <p className="text-sm">
                      Current threshold: <strong>Priority {settings?.importantPriorityThreshold}</strong>
                    </p>
                  </div>
                </Card>
                  
                <Card className="p-6">
                  <div>
                    <h3 className="font-semibold mb-2">Data Management</h3>
                    <p className="text-sm text-muted-foreground mb-3">
                      All data is stored locally in your browser
                    </p>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm">Export JSON</Button>
                      <Button variant="outline" size="sm">Export CSV</Button>
                    </div>
                  </div>
                </Card>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      <Toaster />
    </div>
  );
}

export default App;