import { motion } from 'framer-motion';
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
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="mb-8"
      >
        <h1 className="text-xl font-semibold tracking-tight">GHCountdown</h1>
        <p className="text-xs text-muted-foreground">Local productivity</p>
      </motion.div>

      <nav className="flex-1 space-y-1">
        {navItems.map((item, index) => {
          const Icon = item.icon;
          const isActive = currentView === item.id;
          
          return (
            <motion.button
              key={item.id}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.05, duration: 0.3 }}
              onClick={() => onNavigate(item.id)}
              className={cn(
                'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all relative',
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
                <Icon size={20} weight={isActive ? 'fill' : 'regular'} />
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
        className="pt-4 border-t text-xs text-muted-foreground"
      >
        <p>All data stored locally</p>
      </motion.div>
    </aside>
  );
}