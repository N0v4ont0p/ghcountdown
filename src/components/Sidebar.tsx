import { ReactNode } from 'react';
import { House, CalendarBlank, ListChecks, Clock, Gear } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';

interface SidebarProps {
  currentView: string;
  onNavigate: (view: string) => void;
}

const navItems = [
  { id: 'home', label: 'Home', icon: House },
  { id: 'events', label: 'Events', icon: CalendarBlank },
  { id: 'todos', label: 'Todos', icon: ListChecks },
  { id: 'time', label: 'Time Tracking', icon: Clock },
  { id: 'settings', label: 'Settings', icon: Gear },
];

export function Sidebar({ currentView, onNavigate }: SidebarProps) {
  return (
    <aside className="w-60 h-screen sticky top-0 glass-card border-r flex flex-col p-4">
      <div className="mb-8">
        <h1 className="text-xl font-semibold tracking-tight">GHCountdown</h1>
        <p className="text-xs text-muted-foreground">Local productivity</p>
      </div>

      <nav className="flex-1 space-y-1">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = currentView === item.id;
          
          return (
            <button
              key={item.id}
              onClick={() => onNavigate(item.id)}
              className={cn(
                'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all',
                isActive
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-foreground/70 hover:text-foreground hover:bg-muted'
              )}
            >
              <Icon size={20} weight={isActive ? 'fill' : 'regular'} />
              {item.label}
            </button>
          );
        })}
      </nav>

      <div className="pt-4 border-t text-xs text-muted-foreground">
        <p>All data stored locally</p>
      </div>
    </aside>
  );
}