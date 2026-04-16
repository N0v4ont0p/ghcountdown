import { motion } from 'framer-motion';
import { House, CalendarBlank, ListChecks, Clock, Gear, CalendarCheck, ChartBar, Timer, Sparkle } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import logoUrl from '@/assets/logo.svg';

interface SidebarProps {
  currentView: string;
  onNavigate: (view: string) => void;
}

const navItems = [
  { id: 'home', label: 'Home', icon: House },
  { id: 'events', label: 'Events', icon: CalendarBlank },
  { id: 'todos', label: 'Todos', icon: ListChecks },
  { id: 'timeline', label: 'Timeline', icon: Clock },
  { id: 'weekly', label: 'Weekly', icon: CalendarCheck },
  { id: 'time-tracking', label: 'Time Tracking', icon: Timer },
  { id: 'statistics', label: 'Statistics', icon: ChartBar },
  { id: 'ai-assistant', label: 'AI Assistant', icon: Sparkle },
  { id: 'settings', label: 'Settings', icon: Gear },
];

export function Sidebar({ currentView, onNavigate }: SidebarProps) {
  return (
    <aside className="w-60 h-screen sticky top-0 glass-card border-r flex flex-col">
      {/* macOS traffic-light drag region — 44px tall, draggable, no content */}
      <div className="titlebar-drag h-11 flex-shrink-0" />

      <div className="px-4 pb-3 flex-shrink-0">
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="flex items-center gap-2.5"
        >
          <img src={logoUrl} alt="" role="presentation" className="w-8 h-8 flex-shrink-0" />
          <div>
            <h1 className="text-base font-semibold tracking-tight leading-tight">GHCountdown</h1>
            <p className="text-[10px] text-muted-foreground leading-tight">Local productivity</p>
          </div>
        </motion.div>
      </div>

      <nav className="flex-1 px-4 py-2 space-y-0.5 overflow-y-auto">
        {navItems.map((item, index) => {
          const Icon = item.icon;
          const isActive = currentView === item.id;

          return (
            <motion.button
              key={item.id}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.04, duration: 0.3 }}
              onClick={() => onNavigate(item.id)}
              className={cn(
                'no-drag w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all relative',
                isActive
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-foreground/70 hover:text-foreground hover:bg-muted'
              )}
              whileHover={{ scale: 1.02, x: 4 }}
              whileTap={{ scale: 0.98 }}
            >
              <motion.div
                animate={isActive ? { rotate: [0, -10, 10, -10, 0] } : {}}
                transition={{ duration: 0.5 }}
              >
                <Icon size={18} weight={isActive ? 'fill' : 'regular'} />
              </motion.div>
              {item.label}

              {isActive && (
                <motion.div
                  layoutId="activeTab"
                  className="absolute inset-0 bg-primary rounded-lg -z-10"
                  transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                />
              )}
            </motion.button>
          );
        })}
      </nav>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5 }}
        className="px-4 py-3 border-t text-xs text-muted-foreground flex-shrink-0"
      >
        <p>All data stored locally</p>
      </motion.div>
    </aside>
  );
}
