import { motion } from 'framer-motion';
import { House, CalendarBlank, ListChecks, Clock, Gear, ChartBar, ClockCountdown } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import logoUrl from '@/assets/logo.svg';

interface SidebarProps {
  currentView: string;
  onNavigate: (view: string) => void;
}

const navItems = [
  { id: 'home', label: 'Home', icon: House, group: 'Core' },
  { id: 'timer', label: 'Timer', icon: ClockCountdown, group: 'Core' },
  { id: 'timeline', label: 'Timeline', icon: Clock, group: 'Core' },
  { id: 'todos', label: 'Todos', icon: ListChecks, group: 'Manage' },
  { id: 'events', label: 'Events', icon: CalendarBlank, group: 'Manage' },
  { id: 'statistics', label: 'Stats', icon: ChartBar, group: 'Insights' },
  { id: 'settings', label: 'Settings', icon: Gear, group: 'System' },
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

      <nav className="flex-1 px-3 py-2 overflow-y-auto">
        {Array.from(new Set(navItems.map((item) => item.group))).map((group, groupIndex) => (
          <div key={group} className="mb-4 last:mb-0">
            <p className="px-3 mb-1.5 text-[10px] uppercase tracking-widest text-muted-foreground/80">{group}</p>
            <div className="space-y-1">
              {navItems.filter((item) => item.group === group).map((item, index) => {
                const Icon = item.icon;
                const isActive = currentView === item.id;

                return (
                  <motion.button
                    key={item.id}
                    initial={{ opacity: 0, x: -16 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: (groupIndex * 0.08) + (index * 0.04), duration: 0.28 }}
                    onClick={() => onNavigate(item.id)}
                    className={cn(
                      'no-drag w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium transition-all relative text-left',
                      isActive
                        ? 'text-primary-foreground shadow-sm'
                        : 'text-foreground/70 hover:text-foreground hover:bg-muted/70'
                    )}
                    whileHover={{ scale: 1.01, x: 2 }}
                    whileTap={{ scale: 0.99 }}
                  >
                    <motion.div
                      animate={isActive ? { rotate: [0, -8, 8, 0] } : {}}
                      transition={{ duration: 0.42 }}
                    >
                      <Icon size={17} weight={isActive ? 'fill' : 'regular'} />
                    </motion.div>
                    {item.label}

                    {isActive && (
                      <motion.div
                        layoutId="activeTab"
                        className="absolute inset-0 bg-primary rounded-xl -z-10"
                        transition={{ type: 'spring', stiffness: 420, damping: 30 }}
                      />
                    )}
                  </motion.button>
                );
              })}
            </div>
          </div>
        ))}
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
