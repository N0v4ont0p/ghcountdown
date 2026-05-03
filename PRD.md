# Planning Guide

GHCountdown is a Mac-first, local-only productivity app that puts your next important event front and center with a stunning countdown, complemented by powerful todo management, in-day timeline planning, and comprehensive time tracking—all stored locally on your machine.

**Experience Qualities**:
1. **Focused** - The hero countdown commands attention, making your most important deadline impossible to ignore while keeping all productivity tools one glance away.
2. **Refined** - Every pixel follows macOS design principles with tasteful glassmorphism, fluid spring animations, and premium typography that feels native to the platform.
3. **Responsive** - Instant feedback on every interaction, real-time countdown updates, and smooth transitions create a delightful experience that never feels sluggish.

**Complexity Level**: Complex Application (advanced functionality, likely with multiple views)
This is a full-featured productivity suite with multiple interconnected views (Home, Events, Todos, Timeline, Time Tracking, Settings), local database persistence with migrations, real-time countdown updates, time tracking with state recovery, keyboard shortcuts, command palette, and sophisticated data relationships between events, todos, projects, and time entries.

## Essential Features

**Hero Countdown Display**
- Functionality: Displays a large, animated countdown (days/hours/minutes/seconds) to the next important event with smooth digit transitions
- Purpose: Keeps users focused on their most critical upcoming deadline at all times
- Trigger: Auto-selects on app launch; updates in real-time every second
- Progression: App opens → DB queries next event (priority ≥3) → Countdown renders with smooth animations → Updates every second → On completion, shows "Completed" state → Auto-advances to next event
- Success criteria: Countdown updates smoothly without jank, shows correct next event, transitions elegantly between events

**Quick Event Management**
- Functionality: Add/edit events with title, date/time, all-day toggle, priority (1-5), tags, and notes
- Purpose: Capture important deadlines and milestones quickly without breaking flow
- Trigger: Click "Add event" button, press N shortcut, or use ⌘K palette
- Progression: Trigger → Modal/drawer opens → Fill fields → Save → Persists to local DB → UI updates → Modal closes
- Success criteria: Event appears immediately in lists, persists after app restart, validates required fields

**Todo System with Projects**
- Functionality: Manage todos in a single unified list auto-grouped by project (with a separate Individual Todos group for project-less items and a collapsible Completed section), with priority levels and event linking. Projects pick their icon from a curated emoji palette
- Purpose: Organize tasks by context and urgency, connect todos to countdown events
- Trigger: Press T for new todo, or use the New Todo / New Project buttons on the Todos page
- Progression: Create todo → Appears in its project group (or Individual Todos) → Sorted by overdue → priority → due date → recency → Mark complete with animation → Moves into the collapsible Completed section
- Success criteria: Todos persist locally, grouping/sorting updates instantly, completion animations delight

**In-Day Timeline (Today View)**
- Functionality: Vertical hour-by-hour timeline (5:00-24:00) showing scheduled blocks, events for today, and "now" indicator
- Purpose: Visualize and plan the current day with time-blocked focus periods
- Trigger: Navigate to Today view
- Progression: Open Today → Timeline renders with current time indicator → Click/drag to create block → Edit start/end times → Link to todo → Block persists
- Success criteria: Blocks align to timeline correctly, "now" line updates in real-time, drag interactions feel natural

**Time Tracking**
- Functionality: Start/stop timer on todos or free-form activities; view daily/weekly summaries; export CSV/JSON
- Purpose: Understand where time goes, build accountability, enable data-driven productivity insights
- Trigger: Press Space on selected todo, click timer button
- Progression: Select todo → Start timer → Timer runs in background → Stop (or app closes) → Entry saved with duration → View in summaries → Export for analysis
- Success criteria: Timer survives app closure (recovers on restart), entries persist accurately, export formats correctly

**Statistics Dashboard**
- Functionality: Comprehensive analytics showing productivity patterns, time insights, streaks, hourly activity, and personalized insights based on tracked data
- Purpose: Provide actionable insights into work patterns, celebrate achievements, identify peak productivity hours, and maintain motivation through streak tracking
- Trigger: Navigate to Statistics view from sidebar
- Progression: Open Statistics → View key metrics (total focus time, completed tasks, streaks, avg session) → Explore weekly/monthly charts → Review hourly activity patterns → Read personalized insights → Compare daily performance
- Success criteria: Charts animate smoothly, insights update based on real data, week/month toggle works correctly, visualizations accurately represent time distribution

**Command Palette (⌘K)**
- Functionality: Global quick-access for navigation and actions (new event, new todo, jump to view)
- Purpose: Power users can accomplish tasks without mouse, maintaining flow state
- Trigger: Press ⌘K
- Progression: Press ⌘K → Palette opens → Type to filter → Select action → Palette executes and closes → Context updates
- Success criteria: Opens instantly, filters responsively, executes actions correctly

**Local Database Persistence**
- Functionality: All data stored locally via repository pattern with schema versioning
- Purpose: Zero-cloud dependency, full offline capability, user owns all data
- Trigger: Any CRUD operation
- Progression: Action triggers → Repo function called → Data validated → IndexedDB transaction → Success callback → UI updates
- Success criteria: Data survives restart, migrations run on schema changes, export/import works perfectly

## Edge Case Handling

- **No Important Events**: Display elegant empty state with quick-add CTA instead of countdown
- **Timer Running on App Close**: On next launch, detect orphaned timer, show dialog asking to keep/discard/edit time
- **Past Events in Countdown**: Mark as "Completed" with different visual treatment, auto-advance to next future event
- **Conflicting Timeline Blocks**: Allow overlaps but show visual indicator, let user resolve manually
- **Large Data Sets**: Implement virtual scrolling for event/todo lists beyond 100 items
- **Invalid Dates**: Validate all date inputs, show helpful error messages for impossible dates
- **No Projects/Tags**: Allow todos/events without them, provide sensible defaults
- **Export with No Data**: Show message but still generate valid empty CSV/JSON files

## Design Direction

The design should evoke the feeling of a premium macOS native application—pristine, focused, and effortlessly powerful. Think Apple's Reminders meets Motion with touches of Arc browser's polish: soft glassy surfaces with subtle blur, confident typography, generous whitespace, and micro-interactions that feel alive. The countdown should be heroic and captivating, while the rest of the interface stays calm and supportive. Every element should feel intentional, refined, and distinctly Mac.

## Color Selection

A sophisticated dark-first palette with vibrant accent options that feel modern and energetic without compromising readability.

- **Primary Color**: Deep charcoal `oklch(0.22 0.01 270)` - Grounding and sophisticated, used for primary text and key UI elements
- **Secondary Colors**: Soft slate backgrounds `oklch(0.96 0.005 270)` for cards and elevated surfaces; muted gray `oklch(0.65 0.01 270)` for secondary text
- **Accent Color**: Electric blue `oklch(0.60 0.19 250)` - Energetic and attention-grabbing for CTAs, countdown digits, timer indicators, and interactive elements
- **Foreground/Background Pairings**: 
  - Background (Soft White #FAFAFA `oklch(0.98 0 0)`): Charcoal text `oklch(0.22 0.01 270)` - Ratio 14.2:1 ✓
  - Card (Light Slate #F5F5F7 `oklch(0.96 0.005 270)`): Charcoal text `oklch(0.22 0.01 270)` - Ratio 13.1:1 ✓
  - Accent (Electric Blue `oklch(0.60 0.19 250)`): White text `oklch(1 0 0)` - Ratio 6.8:1 ✓
  - Muted backgrounds `oklch(0.94 0.008 270)`: Muted text `oklch(0.55 0.01 270)` - Ratio 4.9:1 ✓

## Font Selection

Typography should feel native to macOS—clean, legible, and refined with strong hierarchy that guides attention naturally from the hero countdown through supporting details.

- **Typographic Hierarchy**:
  - H1 (Countdown Digits): SF Pro Display Semibold/72px/tight letter spacing/-0.02em
  - H2 (Event Title in Hero): SF Pro Display Medium/32px/tight/-0.01em
  - H3 (Section Headers): SF Pro Text Semibold/20px/normal
  - H4 (Card Titles): SF Pro Text Medium/16px/normal
  - Body (Todo text, descriptions): SF Pro Text Regular/15px/1.5 line height
  - Caption (Timestamps, metadata): SF Pro Text Regular/13px/muted color
  - Mono (Time entries, durations): SF Mono Regular/14px/tabular nums

## Animations

Animations should embody macOS fluidity—spring-based physics for natural motion, subtle yet delightful. The countdown digits should use a smooth morph or flip transition on change. Cards should scale slightly on hover with a gentle spring. Completing a todo triggers a satisfying check animation with a subtle haptic-style pulse. The "now" indicator on the timeline glides smoothly. All transitions use ease-out curves (or springs) and respect reduced-motion preferences. Timer start/stop should feel immediate with a micro-bounce. Navigation between views uses smooth fade + slight vertical shift.

## Component Selection

- **Components**: 
  - Dialog for event/todo editing with form fields (Input, Textarea, Select for priority/tags)
  - Command palette using Command component for ⌘K
  - Card for event items, todo items, time entries, and per-project todo groups
  - Progress for countdown progress rings (optional visual enhancement)
  - Badge for priority indicators and tags
  - Separator for visual section breaks
  - ScrollArea for long lists
  - Switch for all-day toggle, settings toggles
  - Button with variants (default, ghost, outline) for all actions
  - Tooltip for icon-only buttons and keyboard shortcuts hints
  - Sonner toast for feedback ("Event created", "Timer started", etc.)
  
- **Customizations**: 
  - Custom CountdownHero component with animated digit transitions using framer-motion
  - Custom TimelineBlock component with drag handles and hour grid snapping
  - Custom TodoRow with checkbox, drag handle, priority indicator, and inline quick-actions
  - Custom EventCard with gradient accent border based on priority
  - Custom Sidebar with sections and keyboard navigation
  - Custom CommandPalette overlay with fuzzy search
  
- **States**: 
  - Buttons: subtle scale on hover (0.98), accent glow on focus, disabled state with reduced opacity
  - Inputs: border accent on focus with smooth transition, error state with red border + shake animation
  - Cards: lift with shadow increase on hover, press down slightly on click
  - Checkboxes: smooth check animation with spring, accent color fill
  
- **Icon Selection**: 
  - Plus for add actions
  - Calendar for events
  - CheckSquare/Square for todos
  - Clock for time tracking
  - Play/Pause for timer controls
  - Settings/Gear for settings
  - Export for data export
  - MagnifyingGlass for search
  - Tag for tags
  - Folder for projects
  
- **Spacing**: 
  - Base unit: 4px (Tailwind's default)
  - Component padding: 16px (p-4)
  - Section gaps: 24px (gap-6)
  - Card spacing: 12px between items (gap-3)
  - Page margins: 32px (p-8)
  - Sidebar width: 240px
  
- **Mobile**: 
  - Sidebar collapses to bottom tab bar on mobile
  - Countdown scales down proportionally but remains prominent
  - Timeline switches to horizontal scroll or stacked blocks
  - Command palette remains full-screen overlay
  - Touch targets minimum 44px
  - Drag gestures replaced with long-press + move on touch devices
