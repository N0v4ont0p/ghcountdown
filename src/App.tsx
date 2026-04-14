import { useEffect, useState } from 'react';
import { Toaster } from '@/components/ui/sonner';
import { Sidebar } from '@/components/Sidebar';
import { CountdownHero } from '@/components/CountdownHero';
import { initDB } from '@/db/core';
import { seedDatabase } from '@/db/seed';
import { getNextImportantEvent, getAllEvents } from '@/db/repositories/eventsRepo';
import { getAllTodos } from '@/db/repositories/todosRepo';
import { getSettings } from '@/db/repositories/settingsRepo';
import { Event, Todo, Settings } from '@/db/schema';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Plus, CalendarBlank } from '@phosphor-icons/react';
import { format } from 'date-fns';
import { Badge } from '@/components/ui/badge';

function App() {
  const [currentView, setCurrentView] = useState('home');
  const [nextEvent, setNextEvent] = useState<Event | null>(null);
  const [upcomingEvents, setUpcomingEvents] = useState<Event[]>([]);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [isLoading, setIsLoading] = useState(true);

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

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading GHCountdown...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen">
      <div className="noise-texture"></div>
      
      <Sidebar currentView={currentView} onNavigate={setCurrentView} />
      
      <main className="flex-1 p-8 relative z-10">
        {currentView === 'home' && (
          <div className="max-w-6xl mx-auto space-y-8">
            <div>
              <h2 className="text-3xl font-semibold mb-2">Welcome Back</h2>
              <p className="text-muted-foreground">Your next important event is counting down</p>
            </div>

            <CountdownHero event={nextEvent} />

            <div className="grid md:grid-cols-2 gap-6">
              <Card className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold">Upcoming Events</h3>
                  <Button size="sm" variant="ghost">
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
                    {upcomingEvents.map((event) => (
                      <div
                        key={event.id}
                        className="p-3 rounded-lg border bg-card hover:bg-accent/5 transition-colors cursor-pointer"
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
                      </div>
                    ))}
                  </div>
                )}
              </Card>

              <Card className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold">Today's Tasks</h3>
                  <Button size="sm" variant="ghost">
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
                    {todos.filter(t => t.status === 'today').map((todo) => (
                      <div
                        key={todo.id}
                        className="flex items-center gap-3 p-2 rounded hover:bg-accent/5 transition-colors"
                      >
                        <input
                          type="checkbox"
                          className="w-4 h-4 rounded border-2"
                        />
                        <span className="flex-1">{todo.title}</span>
                        {todo.priority >= 4 && (
                          <Badge variant="destructive" className="text-xs">High</Badge>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </div>
          </div>
        )}

        {currentView === 'events' && (
          <div className="max-w-4xl mx-auto">
            <div className="mb-6">
              <h2 className="text-3xl font-semibold mb-2">Events</h2>
              <p className="text-muted-foreground">Manage your important deadlines and milestones</p>
            </div>
            <Card className="p-6">
              <p className="text-center text-muted-foreground py-12">
                Event management view - Add, edit, and organize your events
              </p>
            </Card>
          </div>
        )}

        {currentView === 'todos' && (
          <div className="max-w-4xl mx-auto">
            <div className="mb-6">
              <h2 className="text-3xl font-semibold mb-2">Todos</h2>
              <p className="text-muted-foreground">Organize tasks by inbox, today, and projects</p>
            </div>
            <Card className="p-6">
              <p className="text-center text-muted-foreground py-12">
                Todo management view - Inbox • Today • Projects
              </p>
            </Card>
          </div>
        )}

        {currentView === 'time' && (
          <div className="max-w-4xl mx-auto">
            <div className="mb-6">
              <h2 className="text-3xl font-semibold mb-2">Time Tracking</h2>
              <p className="text-muted-foreground">Track time spent on tasks and projects</p>
            </div>
            <Card className="p-6">
              <p className="text-center text-muted-foreground py-12">
                Time tracking view - Start/stop timer, view summaries, export data
              </p>
            </Card>
          </div>
        )}

        {currentView === 'settings' && (
          <div className="max-w-2xl mx-auto">
            <div className="mb-6">
              <h2 className="text-3xl font-semibold mb-2">Settings</h2>
              <p className="text-muted-foreground">Customize your GHCountdown experience</p>
            </div>
            <Card className="p-6">
              <div className="space-y-4">
                <div>
                  <h3 className="font-semibold mb-2">Important Event Priority</h3>
                  <p className="text-sm text-muted-foreground mb-2">
                    Events with this priority or higher appear in the countdown hero
                  </p>
                  <p className="text-sm">
                    Current threshold: <strong>Priority {settings?.importantPriorityThreshold}</strong>
                  </p>
                </div>
                
                <div className="pt-4 border-t">
                  <h3 className="font-semibold mb-2">Data Management</h3>
                  <p className="text-sm text-muted-foreground mb-3">
                    All data is stored locally in your browser
                  </p>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm">Export JSON</Button>
                    <Button variant="outline" size="sm">Export CSV</Button>
                  </div>
                </div>
              </div>
            </Card>
          </div>
        )}
      </main>

      <Toaster />
    </div>
  );
}

export default App;