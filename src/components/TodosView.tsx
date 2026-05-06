import { memo, useCallback, useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Todo, Project, Goal } from '@/db/schema';
import { getAllTodos, createTodo, updateTodo, deleteTodo } from '@/db/repositories/todosRepo';
import { getAllProjects, createProject, updateProject, deleteProject } from '@/db/repositories/projectsRepo';
import { getActiveGoals } from '@/db/repositories/goalsRepo';
import { getAllTimeEntries, updateTimeEntry } from '@/db/repositories/timeRepo';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { IconPicker } from '@/components/IconPicker';
import { Plus, Trash, Folder, CheckCircle, CalendarCheck, PencilSimple, CaretDown, CaretRight, Circle } from '@phosphor-icons/react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { broadcastDataChanged } from '@/lib/dataSync';
import { useScrollPreservation } from '@/lib/scrollPreservation';

/** Curated palette of project colors.  Users can also pick a custom color. */
const PROJECT_COLOR_PALETTE: string[] = [
  'oklch(0.60 0.19 250)', // blue
  'oklch(0.65 0.20 150)', // green
  'oklch(0.70 0.22 50)',  // orange
  'oklch(0.65 0.20 350)', // pink
  'oklch(0.60 0.18 200)', // teal
  'oklch(0.68 0.19 100)', // yellow-green
  'oklch(0.55 0.22 290)', // violet
  'oklch(0.62 0.21 25)',  // red
  'oklch(0.60 0.15 180)', // cyan
  'oklch(0.55 0.18 320)', // magenta
  'oklch(0.50 0.05 270)', // slate
  'oklch(0.72 0.18 80)',  // amber
];

type ProjectFormData = {
  name: string;
  color: string;
  icon: string;
  description: string;
  status: 'active' | 'paused' | 'archived';
};

const EMPTY_PROJECT_FORM: ProjectFormData = {
  name: '',
  color: PROJECT_COLOR_PALETTE[0],
  icon: '',
  description: '',
  status: 'active',
};

type TodoFormData = {
  title: string;
  status: 'today' | 'done';
  dueAt: string;
  priority: 1 | 2 | 3 | 4 | 5;
  projectId: string;
  cognitiveLoad: 'high' | 'medium' | 'low' | null;
  goalId: string;
  estimatedMinutes: string; // string for the input; parsed on submit
};

/**
 * The native `<input type="color">` only understands `#rrggbb` — our curated
 * palette is in `oklch(...)` form, which the picker can't display.  Rather
 * than ship a full color-space converter, we fall back to a neutral gray
 * when the current value isn't a hex string.  As soon as the user picks
 * from the swatch we save and round-trip a hex value, so subsequent opens
 * are exact.  This keeps the picker usable without pulling in a converter.
 */
function oklchToHexFallback(value: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(value) ? value : '#888888';
}

// ---------------------------------------------------------------------------
// TodoItem
// ---------------------------------------------------------------------------
// Defined at module scope (NOT inside TodosView) so its component identity
// stays stable across parent re-renders.  TodosView re-renders frequently
// because App.tsx ticks `nowTick` every second; if TodoItem were redeclared
// inside TodosView, React would treat each render as a new component type
// and unmount + remount every row, which made the framer-motion entrance
// animation replay constantly (most visibly when the user hovered a trash
// button — the hover was unrelated, the timer was the cause).  React.memo
// also short-circuits re-renders when none of the relevant props changed.
// ---------------------------------------------------------------------------
interface TodoItemProps {
  todo: Todo;
  project: Project | null;
  showProject?: boolean;
  isOverdue: boolean;
  onToggle: (todo: Todo) => void;
  onMoveToToday: (todo: Todo) => void;
  onEdit: (todo: Todo) => void;
  onDelete: (id: string) => void;
}

const TodoItem = memo(function TodoItem({
  todo,
  project,
  showProject = false,
  isOverdue: overdue,
  onToggle,
  onMoveToToday,
  onEdit,
  onDelete,
}: TodoItemProps) {
  const isDone = todo.status === 'done';

  return (
    <motion.div
      layout
      initial={false}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ type: 'spring', stiffness: 420, damping: 34, mass: 0.45 }}
    >
      <Card className={cn(
        "p-3 group hover:shadow-sm transition-all duration-200",
        isDone && "opacity-60",
        overdue && "border-l-4 border-l-red-500"
      )}>
        <div className="flex items-start gap-3">
          <div className="pt-0.5">
            <Checkbox
              checked={isDone}
              onCheckedChange={() => onToggle(todo)}
              className="h-5 w-5"
            />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={cn(
                "font-medium",
                isDone && "line-through text-muted-foreground"
              )}>
                {todo.title}
              </span>
              {overdue && (
                <Badge variant="destructive" className="h-5 text-xs bg-red-600">OVERDUE</Badge>
              )}
              {!overdue && todo.priority >= 4 && (
                <Badge variant="destructive" className="h-5 text-xs">High</Badge>
              )}
              {showProject && project && (
                <Badge
                  variant="outline"
                  className="h-5 text-xs"
                  style={{ borderColor: project.color }}
                >
                  <Folder size={10} weight="fill" style={{ color: project.color }} className="mr-1" />
                  {project.icon && <span className="mr-1">{project.icon}</span>}
                  {project.name}
                </Badge>
              )}
            </div>

            {todo.dueAt && (
              <p className={cn(
                "text-xs mt-1",
                overdue ? "text-red-500 font-medium" : "text-muted-foreground"
              )}>
                Due: {format(new Date(todo.dueAt), 'MMM d, yyyy')}
              </p>
            )}
          </div>

          {/* Hover action controls — pure CSS opacity transition, no React
              re-renders or remounts triggered by hover.  The buttons stay in
              the DOM so the layout never shifts. */}
          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            {todo.status === 'inbox' && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onMoveToToday(todo)}
                className="h-7 px-2 text-xs hover:scale-105 active:scale-95 transition-transform"
              >
                → Today
              </Button>
            )}
            <Button
              size="icon"
              variant="ghost"
              onClick={() => onEdit(todo)}
              className="h-7 w-7 text-muted-foreground hover:text-foreground hover:scale-110 active:scale-95 transition-transform"
              aria-label="Edit todo"
              title="Edit todo"
            >
              <PencilSimple size={14} />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              onClick={() => onDelete(todo.id)}
              className="h-7 w-7 text-destructive hover:text-destructive hover:scale-110 active:scale-95 transition-transform"
              aria-label="Delete todo"
              title="Delete todo"
            >
              <Trash size={14} />
            </Button>
          </div>
        </div>
      </Card>
    </motion.div>
  );
});

export function TodosView() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isProjectDialogOpen, setIsProjectDialogOpen] = useState(false);
  const [showCompleted, setShowCompleted] = useState(false);
  const [selectedProjectId, _setSelectedProjectId] = useState<string | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [todoToDelete, setTodoToDelete] = useState<string | null>(null);
  const [deleteProjectConfirmOpen, setDeleteProjectConfirmOpen] = useState(false);
  const [projectToDelete, setProjectToDelete] = useState<string | null>(null);
  /** When set, the project dialog is in edit mode for this id. */
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  /** When set, the todo dialog is in edit mode for this id. */
  const [editingTodoId, setEditingTodoId] = useState<string | null>(null);

  const [formData, setFormData] = useState<TodoFormData>({
    title: '',
    status: 'today',
    dueAt: '',
    priority: 3,
    projectId: 'none',
    cognitiveLoad: null,
    goalId: 'none',
    estimatedMinutes: '',
  });

  const [projectFormData, setProjectFormData] = useState<ProjectFormData>(EMPTY_PROJECT_FORM);

  // Keeps the user's scroll position stable across data reloads triggered by
  // create/edit/delete actions.  Without this, framer-motion `layout`
  // transitions and Radix dialog focus restoration can nudge the surrounding
  // `<main>` scroll container after every save.
  const { rootRef, preserveScroll } = useScrollPreservation<HTMLDivElement>();

  const loadData = useCallback(async () => {
    const [allTodos, allProjects, activeGoals] = await Promise.all([
      getAllTodos(),
      getAllProjects(),
      getActiveGoals(),
    ]);

    // Lazy migration: the 'someday' bucket has been retired. Quietly promote
    // any legacy someday todos to 'today' so they show up alongside other
    // active work and the user never sees a stale label.
    const legacySomeday = allTodos.filter(t => t.status === 'someday');
    if (legacySomeday.length > 0) {
      await Promise.all(legacySomeday.map(t => updateTodo(t.id, { status: 'today' })));
      for (const t of legacySomeday) t.status = 'today';
    }

    setTodos(allTodos);
    setProjects(allProjects);
    setGoals(activeGoals);
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    function onDataChange() { void preserveScroll(loadData); }
    window.addEventListener('ghc-data-changed', onDataChange);
    window.addEventListener('app:datachange', onDataChange);
    return () => {
      window.removeEventListener('ghc-data-changed', onDataChange);
      window.removeEventListener('app:datachange', onDataChange);
    };
  }, [loadData, preserveScroll]);

  function resetForm() {
    setFormData({
      title: '',
      status: 'today',
      dueAt: '',
      priority: 3,
      projectId: selectedProjectId || 'none',
      cognitiveLoad: null,
      goalId: 'none',
      estimatedMinutes: '',
    });
    setEditingTodoId(null);
  }

  /** Convert a stored ISO timestamp to the format expected by `<input type="datetime-local">`. */
  function isoToLocalInputValue(iso: string | null): string {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  const openEditTodo = useCallback((todo: Todo) => {
    setEditingTodoId(todo.id);
    setFormData({
      title: todo.title,
      // The dialog only exposes today/done now. Anything else (legacy 'inbox'
      // or 'someday') maps to 'today' so the editor can round-trip it
      // without surfacing retired buckets.
      status: todo.status === 'done' ? 'done' : 'today',
      dueAt: isoToLocalInputValue(todo.dueAt),
      priority: todo.priority,
      projectId: todo.projectId ?? 'none',
      cognitiveLoad: todo.cognitiveLoad,
      goalId: todo.goalId ?? 'none',
      estimatedMinutes:
        todo.estimatedMinutes !== null && todo.estimatedMinutes !== undefined
          ? String(todo.estimatedMinutes)
          : '',
    });
    setIsDialogOpen(true);
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!formData.title) {
      toast.error('Please enter a title');
      return;
    }

    const parsedEstimate = formData.estimatedMinutes.trim()
      ? Math.max(0, Math.floor(Number(formData.estimatedMinutes)))
      : null;
    if (formData.estimatedMinutes.trim() && Number.isNaN(Number(formData.estimatedMinutes))) {
      toast.error('Estimate must be a number of minutes');
      return;
    }

    try {
      if (editingTodoId) {
        await updateTodo(editingTodoId, {
          title: formData.title,
          status: formData.status,
          dueAt: formData.dueAt || null,
          priority: formData.priority,
          projectId: formData.projectId !== 'none' ? formData.projectId : null,
          cognitiveLoad: formData.cognitiveLoad,
          goalId: formData.goalId !== 'none' ? formData.goalId : null,
          estimatedMinutes: parsedEstimate,
        });
        toast.success('Todo updated');
      } else {
        await createTodo({
          title: formData.title,
          status: formData.status,
          dueAt: formData.dueAt || null,
          priority: formData.priority,
          projectId: formData.projectId !== 'none' ? formData.projectId : null,
          eventId: null,
          cognitiveLoad: formData.cognitiveLoad,
          goalId: formData.goalId !== 'none' ? formData.goalId : null,
          estimatedMinutes: parsedEstimate,
        });
        toast.success('Todo created');
      }

      setIsDialogOpen(false);
      resetForm();
      broadcastDataChanged({ kind: 'todo' });
      void preserveScroll(loadData);
    } catch (error) {
      toast.error(editingTodoId ? 'Failed to update todo' : 'Failed to create todo');
    }
  }

  const handleToggle = useCallback(async (todo: Todo) => {
    const newStatus = todo.status === 'done' ? 'today' : 'done';
    await updateTodo(todo.id, { status: newStatus });
    if (newStatus === 'done') {
      // Stop any running time entries linked to this todo
      const entries = await getAllTimeEntries();
      const running = entries.filter(e => e.todoId === todo.id && !e.endAt);
      await Promise.all(running.map(e => updateTimeEntry(e.id, { endAt: new Date().toISOString() })));
      toast.success('Task completed');
    }
    void preserveScroll(loadData);
  }, [loadData, preserveScroll]);

  const handleMoveToToday = useCallback(async (todo: Todo) => {
    await updateTodo(todo.id, { status: 'today' });
    toast.success('Moved to Today');
    void preserveScroll(loadData);
  }, [loadData, preserveScroll]);

  const handleDelete = useCallback((id: string) => {
    setTodoToDelete(id);
    setDeleteConfirmOpen(true);
  }, []);

  async function handleDeleteConfirm() {
    if (!todoToDelete) return;
    try {
      const { pushUndo } = await import('@/lib/undoHistory');
      const { getTodoById } = await import('@/db/repositories/todosRepo');
      const todoData = await getTodoById(todoToDelete);
      if (todoData) pushUndo({ type: 'deleteTodo', data: todoData, ts: Date.now() });
      await deleteTodo(todoToDelete);
      toast.success('Todo deleted', {
        duration: 5000,
        action: {
          label: 'Undo',
          onClick: async () => {
            const { canUndo, popUndo } = await import('@/lib/undoHistory');
            if (canUndo()) {
              const entry = popUndo()!;
              const { add } = await import('@/db/core');
              const { STORES } = await import('@/db/schema');
              await add(STORES.TODOS, entry.data);
              await preserveScroll(loadData);
            }
          },
        },
      });
      await preserveScroll(loadData);
    } catch (error) {
      toast.error('Failed to delete todo');
    } finally {
      setTodoToDelete(null);
    }
  }

  async function handleDeleteProject(id: string) {
    setProjectToDelete(id);
    setDeleteProjectConfirmOpen(true);
  }

  async function handleDeleteProjectConfirm() {
    if (!projectToDelete) return;
    try {
      await deleteProject(projectToDelete);
      toast.success('Project deleted');
      broadcastDataChanged({ kind: 'project' });
      await preserveScroll(loadData);
    } catch (error) {
      toast.error('Failed to delete project');
    } finally {
      setProjectToDelete(null);
    }
  }

  function openEditProject(project: Project) {
    setEditingProjectId(project.id);
    setProjectFormData({
      name: project.name,
      color: project.color,
      icon: project.icon ?? '',
      description: project.description ?? '',
      status: project.status ?? 'active',
    });
    setIsProjectDialogOpen(true);
  }

  function closeProjectDialog() {
    setIsProjectDialogOpen(false);
    setEditingProjectId(null);
    setProjectFormData(EMPTY_PROJECT_FORM);
  }

  async function handleProjectSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!projectFormData.name) {
      toast.error('Please enter a project name');
      return;
    }

    const payload = {
      name: projectFormData.name.trim(),
      color: projectFormData.color,
      icon: projectFormData.icon.trim() ? projectFormData.icon.trim() : null,
      description: projectFormData.description,
      status: projectFormData.status,
    };

    try {
      if (editingProjectId) {
        await updateProject(editingProjectId, payload);
        toast.success('Project updated');
      } else {
        await createProject(payload);
        toast.success('Project created');
      }
      closeProjectDialog();
      broadcastDataChanged({ kind: 'project' });
      void preserveScroll(loadData);
    } catch (error) {
      toast.error(editingProjectId ? 'Failed to update project' : 'Failed to create project');
    }
  }

  function isOverdue(todo: Todo): boolean {
    return todo.status !== 'done' && !!todo.dueAt && new Date(todo.dueAt).getTime() < Date.now();
  }

  /** Sort active todos by overdue → priority desc → due date asc (no due last) → updatedAt desc. */
  function sortActive(a: Todo, b: Todo): number {
    const ao = isOverdue(a) ? 0 : 1;
    const bo = isOverdue(b) ? 0 : 1;
    if (ao !== bo) return ao - bo;
    if (a.priority !== b.priority) return b.priority - a.priority;
    const ad = a.dueAt ? new Date(a.dueAt).getTime() : Number.POSITIVE_INFINITY;
    const bd = b.dueAt ? new Date(b.dueAt).getTime() : Number.POSITIVE_INFINITY;
    if (ad !== bd) return ad - bd;
    const au = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
    const bu = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
    return bu - au;
  }

  // Active = anything not done. Treat legacy 'inbox' and 'someday' as active
  // alongside 'today' so existing data stays visible without an explicit
  // schema migration step.
  const activeTodos = todos.filter(t => t.status !== 'done');
  const doneTodos = todos
    .filter(t => t.status === 'done')
    .sort((a, b) => {
      const au = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
      const bu = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
      return bu - au;
    });

  const todosWithoutProject = activeTodos
    .filter(t => !t.projectId)
    .sort(sortActive);

  function getActiveTodosByProject(projectId: string) {
    return activeTodos.filter(t => t.projectId === projectId).sort(sortActive);
  }

  /** Render a TodoItem with the project lookup + handlers wired in.  This
   *  keeps the call sites short and ensures every list passes the same
   *  stable, memoizable props. */
  function renderTodoItem(todo: Todo, showProject = false) {
    const project = todo.projectId ? projects.find(p => p.id === todo.projectId) ?? null : null;
    return (
      <TodoItem
        key={todo.id}
        todo={todo}
        project={project}
        showProject={showProject}
        isOverdue={isOverdue(todo)}
        onToggle={handleToggle}
        onMoveToToday={handleMoveToToday}
        onEdit={openEditTodo}
        onDelete={handleDelete}
      />
    );
  }

  return (
    <div ref={rootRef} className="max-w-4xl mx-auto">
      <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-3xl font-semibold mb-2">Todos</h2>
          <p className="text-muted-foreground">
            Active tasks grouped by project · {activeTodos.length} open
          </p>
        </div>

        <div className="flex gap-2">
          <Dialog open={isProjectDialogOpen} onOpenChange={(open) => {
            setIsProjectDialogOpen(open);
            if (!open) {
              setEditingProjectId(null);
              setProjectFormData(EMPTY_PROJECT_FORM);
            }
          }}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2">
                <Plus size={14} weight="bold" />
                New Project
              </Button>
            </DialogTrigger>
            <DialogContent className="max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>{editingProjectId ? 'Edit Project' : 'Create New Project'}</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleProjectSubmit} className="space-y-4">
                <div className="grid grid-cols-[80px_1fr] gap-3">
                  <div>
                    <Label htmlFor="projectIcon">Icon</Label>
                    <div className="mt-1">
                      <IconPicker
                        id="projectIcon"
                        value={projectFormData.icon || null}
                        onChange={(next) =>
                          setProjectFormData({
                            ...projectFormData,
                            icon: next ?? '',
                          })
                        }
                        ariaLabel="Project icon"
                        placeholder="🚀"
                      />
                    </div>
                  </div>
                  <div>
                    <Label htmlFor="projectName">Project Name</Label>
                    <Input
                      id="projectName"
                      value={projectFormData.name}
                      onChange={(e) => setProjectFormData({ ...projectFormData, name: e.target.value })}
                      placeholder="Work, Personal, Side Project..."
                      required
                      autoFocus
                    />
                  </div>
                </div>

                <div>
                  <Label htmlFor="projectDescription">Description (optional)</Label>
                  <Textarea
                    id="projectDescription"
                    value={projectFormData.description}
                    onChange={(e) => setProjectFormData({ ...projectFormData, description: e.target.value })}
                    placeholder="What is this project about?"
                    rows={3}
                  />
                </div>

                <div>
                  <Label htmlFor="projectStatus">Status</Label>
                  <Select
                    value={projectFormData.status}
                    onValueChange={(val) =>
                      setProjectFormData({
                        ...projectFormData,
                        status: val as 'active' | 'paused' | 'archived',
                      })
                    }
                  >
                    <SelectTrigger id="projectStatus">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="paused">Paused</SelectItem>
                      <SelectItem value="archived">Archived</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label htmlFor="projectColor">Color</Label>
                  <div className="grid grid-cols-6 gap-2 mt-2">
                    {PROJECT_COLOR_PALETTE.map((color) => (
                      <button
                        key={color}
                        type="button"
                        onClick={() => setProjectFormData({ ...projectFormData, color })}
                        className={cn(
                          "w-10 h-10 rounded-lg border-2 transition-all",
                          projectFormData.color === color ? "border-foreground scale-110" : "border-transparent"
                        )}
                        style={{ backgroundColor: color }}
                        aria-label={`Pick color ${color}`}
                        aria-pressed={projectFormData.color === color}
                      />
                    ))}
                  </div>
                  <div className="flex items-center gap-2 mt-3">
                    <Label
                      htmlFor="projectCustomColor"
                      className="text-xs text-muted-foreground cursor-pointer"
                    >
                      Custom color
                    </Label>
                    <input
                      id="projectCustomColor"
                      type="color"
                      value={oklchToHexFallback(projectFormData.color)}
                      onChange={(e) =>
                        setProjectFormData({ ...projectFormData, color: e.target.value })
                      }
                      className="h-8 w-12 rounded border border-border bg-transparent cursor-pointer"
                      aria-label="Pick a custom color"
                    />
                    <span
                      className="inline-block w-5 h-5 rounded-full border"
                      style={{ backgroundColor: projectFormData.color }}
                      aria-hidden
                    />
                    <code className="text-[10px] text-muted-foreground truncate">
                      {projectFormData.color}
                    </code>
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-4">
                  <Button type="button" variant="outline" onClick={closeProjectDialog}>
                    Cancel
                  </Button>
                  <Button type="submit">
                    {editingProjectId ? 'Save Changes' : 'Create Project'}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>

          <Dialog open={isDialogOpen} onOpenChange={(open) => {
            setIsDialogOpen(open);
            if (!open) resetForm();
          }}>
            <DialogTrigger asChild>
              <Button size="sm" className="gap-2">
                <Plus size={14} weight="bold" />
                New Todo
              </Button>
            </DialogTrigger>
            <DialogContent className="max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>{editingTodoId ? 'Edit Todo' : 'Create New Todo'}</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <Label htmlFor="title">Task Title</Label>
                  <Input
                    id="title"
                    value={formData.title}
                    onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                    placeholder="What needs to be done?"
                    required
                    autoFocus
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="status">Status</Label>
                    <Select
                      value={formData.status}
                      onValueChange={(val) => setFormData({ ...formData, status: val as 'today' | 'done' })}
                    >
                      <SelectTrigger id="status">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="today">Active</SelectItem>
                        {editingTodoId && <SelectItem value="done">Done</SelectItem>}
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label htmlFor="priority">Priority</Label>
                    <Select
                      value={formData.priority.toString()}
                      onValueChange={(val) => setFormData({ ...formData, priority: parseInt(val) as 1 | 2 | 3 | 4 | 5 })}
                    >
                      <SelectTrigger id="priority">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="5">5 - Critical</SelectItem>
                        <SelectItem value="4">4 - High</SelectItem>
                        <SelectItem value="3">3 - Medium</SelectItem>
                        <SelectItem value="2">2 - Low</SelectItem>
                        <SelectItem value="1">1 - Minimal</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div>
                  <Label htmlFor="project">Project (optional)</Label>
                  <Select
                    value={formData.projectId}
                    onValueChange={(val) => setFormData({ ...formData, projectId: val })}
                  >
                    <SelectTrigger id="project">
                      <SelectValue placeholder="None" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      {projects.map((project) => (
                        <SelectItem key={project.id} value={project.id}>
                          <span className="flex items-center gap-2">
                            <span
                              className="w-2.5 h-2.5 rounded-full inline-block"
                              style={{ backgroundColor: project.color }}
                              aria-hidden
                            />
                            {project.icon && <span>{project.icon}</span>}
                            {project.name}
                            {project.status && project.status !== 'active' && (
                              <span className="text-[10px] text-muted-foreground ml-1">
                                ({project.status})
                              </span>
                            )}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {goals.length > 0 && (
                  <div>
                    <Label htmlFor="goalId">Contributes to (optional)</Label>
                    <Select
                      value={formData.goalId}
                      onValueChange={(val) => setFormData({ ...formData, goalId: val })}
                    >
                      <SelectTrigger id="goalId">
                        <SelectValue placeholder="No goal" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">No goal</SelectItem>
                        {goals.filter(g => g.status === 'active').map((goal) => (
                          <SelectItem key={goal.id} value={goal.id}>
                            {goal.title}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="dueAt">Due Date (optional)</Label>
                    <Input
                      id="dueAt"
                      type="datetime-local"
                      value={formData.dueAt}
                      onChange={(e) => setFormData({ ...formData, dueAt: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label htmlFor="estimatedMinutes">Estimate (minutes)</Label>
                    <Input
                      id="estimatedMinutes"
                      type="number"
                      min={0}
                      step={5}
                      value={formData.estimatedMinutes}
                      onChange={(e) =>
                        setFormData({ ...formData, estimatedMinutes: e.target.value })
                      }
                      placeholder="e.g. 30"
                    />
                  </div>
                </div>

                <div>
                  <Label>Mental effort (optional)</Label>
                  <div className="flex gap-2 mt-2">
                    {([
                      { value: 'low', label: 'Easy', color: 'oklch(0.65 0.17 145)' },
                      { value: 'medium', label: 'Medium', color: 'oklch(0.75 0.18 75)' },
                      { value: 'high', label: 'Deep work', color: 'oklch(0.58 0.20 20)' },
                    ] as const).map(({ value, label, color }) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() =>
                          setFormData({
                            ...formData,
                            cognitiveLoad: formData.cognitiveLoad === value ? null : value,
                          })
                        }
                        className={cn(
                          'flex-1 rounded-full border px-3 py-1.5 text-sm font-medium transition-all',
                          formData.cognitiveLoad === value
                            ? 'border-transparent text-white scale-105'
                            : 'border-border text-foreground hover:scale-105'
                        )}
                        style={
                          formData.cognitiveLoad === value
                            ? { backgroundColor: color }
                            : {}
                        }
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-4">
                  <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="submit">{editingTodoId ? 'Save Changes' : 'Create Todo'}</Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Unified groups: "No Project" / Individual todos first, then each project. */}
      <div className="space-y-4">
        {activeTodos.length === 0 && projects.length === 0 ? (
          <Card className="p-12 text-center">
            <CalendarCheck weight="thin" size={48} className="mx-auto mb-4 text-muted-foreground" />
            <h3 className="text-lg font-semibold mb-2">Nothing here yet</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Add a todo or create a project to get started.
            </p>
          </Card>
        ) : (
          <>
            {/* Individual / "No Project" group — shown first, only when it has todos. */}
            {todosWithoutProject.length > 0 && (
              <Card className="p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Circle size={14} className="text-muted-foreground" />
                  <h3 className="font-semibold text-lg">Individual Todos</h3>
                  <Badge variant="secondary" className="h-5">
                    {todosWithoutProject.length}
                  </Badge>
                </div>
                <div className="space-y-2">
                  <AnimatePresence initial={false} mode="popLayout">
                    {todosWithoutProject.map((todo) => (
                      renderTodoItem(todo)
                    ))}
                  </AnimatePresence>
                </div>
              </Card>
            )}

            {projects.map((project) => {
              const projectTodos = getActiveTodosByProject(project.id);
              return (
                <Card key={project.id} className="p-4">
                  <div className="flex items-start justify-between mb-3 gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <div
                          className="w-3 h-3 rounded-full flex-shrink-0"
                          style={{ backgroundColor: project.color }}
                        />
                        {project.icon && (
                          <span className="text-lg leading-none" aria-hidden>
                            {project.icon}
                          </span>
                        )}
                        <h3 className="font-semibold text-lg truncate">{project.name}</h3>
                        <Badge variant="secondary" className="h-5">
                          {projectTodos.length}
                        </Badge>
                        {project.status && project.status !== 'active' && (
                          <Badge
                            variant="outline"
                            className={cn(
                              'h-5 text-[10px] uppercase tracking-wider',
                              project.status === 'paused' && 'text-amber-600 border-amber-500/40',
                              project.status === 'archived' && 'text-muted-foreground'
                            )}
                          >
                            {project.status}
                          </Badge>
                        )}
                      </div>
                      {project.description && (
                        <p className="text-sm text-muted-foreground mt-1 whitespace-pre-wrap">
                          {project.description}
                        </p>
                      )}
                    </div>
                    <div className="flex gap-1 flex-shrink-0">
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => openEditProject(project)}
                        className="h-8 w-8 text-muted-foreground hover:text-foreground hover:scale-110 active:scale-95 transition-transform"
                        aria-label="Edit project"
                        title="Edit project"
                      >
                        <PencilSimple size={16} />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => handleDeleteProject(project.id)}
                        className="h-8 w-8 text-destructive hover:text-destructive hover:scale-110 active:scale-95 transition-transform"
                        aria-label="Delete project"
                      >
                        <Trash size={16} />
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <AnimatePresence initial={false} mode="popLayout">
                      {projectTodos.length === 0 ? (
                        <p className="text-sm text-muted-foreground text-center py-4">
                          No active todos in this project
                        </p>
                      ) : (
                        projectTodos.map((todo) => (
                          renderTodoItem(todo)
                        ))
                      )}
                    </AnimatePresence>
                  </div>
                </Card>
              );
            })}
          </>
        )}
      </div>

      {doneTodos.length > 0 && (
        <div className="mt-8">
          <button
            type="button"
            onClick={() => setShowCompleted(v => !v)}
            className="flex items-center gap-2 mb-3 group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
            aria-expanded={showCompleted}
            aria-controls="completed-todos"
          >
            {showCompleted
              ? <CaretDown size={14} className="text-muted-foreground" />
              : <CaretRight size={14} className="text-muted-foreground" />}
            <CheckCircle size={20} className="text-muted-foreground" />
            <h3 className="text-lg font-semibold text-muted-foreground group-hover:text-foreground transition-colors">
              Completed
            </h3>
            <Badge variant="outline">{doneTodos.length}</Badge>
          </button>
          {showCompleted && (
            <div id="completed-todos" className="space-y-2">
              <AnimatePresence initial={false} mode="popLayout">
                {doneTodos.slice(0, 50).map((todo) => (
                  renderTodoItem(todo, true)
                ))}
              </AnimatePresence>
            </div>
          )}
        </div>
      )}

      <ConfirmDialog
        open={deleteConfirmOpen}
        onOpenChange={(open) => {
          setDeleteConfirmOpen(open);
          if (!open) setTodoToDelete(null);
        }}
        title="Delete Todo?"
        description="Are you sure you want to delete this todo? This action cannot be undone."
        actionType="delete"
        confirmText="Delete"
        cancelText="Cancel"
        onConfirm={handleDeleteConfirm}
      />

      <ConfirmDialog
        open={deleteProjectConfirmOpen}
        onOpenChange={(open) => {
          setDeleteProjectConfirmOpen(open);
          if (!open) setProjectToDelete(null);
        }}
        title="Delete Project?"
        description="Are you sure you want to delete this project? Todos in this project will not be deleted, but will no longer be linked to it."
        actionType="warning"
        confirmText="Delete Project"
        cancelText="Cancel"
        onConfirm={handleDeleteProjectConfirm}
      />
    </div>
  );
}
