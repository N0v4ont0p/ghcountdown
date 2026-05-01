import { useState, useEffect } from 'react';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Plus, Trash, Folder, CheckCircle, CalendarCheck, Cloud, PencilSimple } from '@phosphor-icons/react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { broadcastDataChanged } from '@/lib/dataSync';

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
  status: 'today' | 'done' | 'someday';
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

export function TodosView() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isProjectDialogOpen, setIsProjectDialogOpen] = useState(false);
  const [currentTab, setCurrentTab] = useState<'today' | 'someday' | 'projects'>('today');
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

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    function onDataChange() { void loadData(); }
    window.addEventListener('ghc-data-changed', onDataChange);
    window.addEventListener('app:datachange', onDataChange);
    return () => {
      window.removeEventListener('ghc-data-changed', onDataChange);
      window.removeEventListener('app:datachange', onDataChange);
    };
  }, []);

  async function loadData() {
    const [allTodos, allProjects, activeGoals] = await Promise.all([
      getAllTodos(),
      getAllProjects(),
      getActiveGoals(),
    ]);
    setTodos(allTodos);
    setProjects(allProjects);
    setGoals(activeGoals);
  }

  function resetForm() {
    setFormData({
      title: '',
      status: currentTab === 'projects' ? 'today' : currentTab,
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

  function openEditTodo(todo: Todo) {
    setEditingTodoId(todo.id);
    setFormData({
      title: todo.title,
      // 'inbox' falls back to 'today' for the editor since the dialog only
      // exposes user-facing buckets (today / someday / done).
      status: todo.status === 'inbox' ? 'today' : todo.status,
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
  }

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
      loadData();
    } catch (error) {
      toast.error(editingTodoId ? 'Failed to update todo' : 'Failed to create todo');
    }
  }

  async function handleToggle(todo: Todo) {
    const newStatus = todo.status === 'done' ? 'today' : 'done';
    await updateTodo(todo.id, { status: newStatus });
    if (newStatus === 'done') {
      // Stop any running time entries linked to this todo
      const entries = await getAllTimeEntries();
      const running = entries.filter(e => e.todoId === todo.id && !e.endAt);
      await Promise.all(running.map(e => updateTimeEntry(e.id, { endAt: new Date().toISOString() })));
      toast.success('Task completed');
    }
    loadData();
  }

  async function handleMoveToToday(todo: Todo) {
    await updateTodo(todo.id, { status: 'today' });
    toast.success('Moved to Today');
    loadData();
  }

  async function handleDelete(id: string) {
    setTodoToDelete(id);
    setDeleteConfirmOpen(true);
  }

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
              await loadData();
            }
          },
        },
      });
      await loadData();
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
      await loadData();
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
      loadData();
    } catch (error) {
      toast.error(editingProjectId ? 'Failed to update project' : 'Failed to create project');
    }
  }

  const todayTodos = todos
    .filter(t => t.status === 'today' || t.status === 'inbox')
    .sort((a, b) => {
      const aOv = isOverdue(a) ? 0 : 1;
      const bOv = isOverdue(b) ? 0 : 1;
      return aOv - bOv;
    });
  const doneTodos = todos.filter(t => t.status === 'done');
  const someDayTodos = todos.filter(t => t.status === 'someday');

  function getTodosByProject(projectId: string) {
    return todos.filter(t => t.projectId === projectId && t.status !== 'done');
  }

  function isOverdue(todo: Todo): boolean {
    return todo.status !== 'done' && !!todo.dueAt && new Date(todo.dueAt).getTime() < Date.now();
  }

  function TodoItem({ todo, showProject = false }: { todo: Todo; showProject?: boolean }) {
    const project = todo.projectId ? projects.find(p => p.id === todo.projectId) : null;
    const isDone = todo.status === 'done';
    const overdue = isOverdue(todo);

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
                onCheckedChange={() => handleToggle(todo)}
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

            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              {todo.status === 'inbox' && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => handleMoveToToday(todo)}
                  className="h-7 px-2 text-xs hover:scale-105 active:scale-95 transition-transform"
                >
                  → Today
                </Button>
              )}
              <Button
                size="icon"
                variant="ghost"
                onClick={() => openEditTodo(todo)}
                className="h-7 w-7 text-muted-foreground hover:text-foreground hover:scale-110 active:scale-95 transition-transform"
                aria-label="Edit todo"
                title="Edit todo"
              >
                <PencilSimple size={14} />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => handleDelete(todo.id)}
                className="h-7 w-7 text-destructive hover:text-destructive hover:scale-110 active:scale-95 transition-transform"
              >
                <Trash size={14} />
              </Button>
            </div>
          </div>
        </Card>
      </motion.div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6">
        <h2 className="text-3xl font-semibold mb-2">Todos</h2>
        <p className="text-muted-foreground">Organize tasks by today, someday, and projects</p>
      </div>

      <Tabs value={currentTab} onValueChange={(v) => setCurrentTab(v as 'today' | 'someday' | 'projects')} className="space-y-6">
        <div className="flex items-center justify-between">
          <TabsList>
            <TabsTrigger value="today" className="gap-2">
              <CalendarCheck size={16} />
              Today
              {todayTodos.length > 0 && (
                <Badge variant="secondary" className="ml-1 h-5 min-w-5 px-1">
                  {todayTodos.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="someday" className="gap-2">
              <Cloud size={16} />
              Someday
              {someDayTodos.length > 0 && (
                <Badge variant="secondary" className="ml-1 h-5 min-w-5 px-1">
                  {someDayTodos.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="projects" className="gap-2">
              <Folder size={16} />
              Projects
              {projects.length > 0 && (
                <Badge variant="secondary" className="ml-1 h-5 min-w-5 px-1">
                  {projects.length}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>

          <div className="flex gap-2">
            {currentTab === 'projects' && (
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
                        <Input
                          id="projectIcon"
                          value={projectFormData.icon}
                          onChange={(e) =>
                            // Allow at most one emoji / glyph (cluster).  Use Array.from
                            // to count by code points so a single emoji counts as 1.
                            setProjectFormData({
                              ...projectFormData,
                              icon: Array.from(e.target.value).slice(0, 2).join(''),
                            })
                          }
                          placeholder="🚀"
                          className="text-center text-xl h-10"
                          aria-label="Project icon (single emoji or character)"
                        />
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
            )}

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
                        onValueChange={(val) => setFormData({ ...formData, status: val as 'today' | 'done' | 'someday' })}
                      >
                        <SelectTrigger id="status">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="today">Today</SelectItem>
                          <SelectItem value="someday">Someday</SelectItem>
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

        <TabsContent value="today" className="space-y-3 mt-0">
          {todayTodos.length === 0 ? (
            <Card className="p-12 text-center">
              <CalendarCheck weight="thin" size={48} className="mx-auto mb-4 text-muted-foreground" />
              <h3 className="text-lg font-semibold mb-2">Nothing planned</h3>
              <p className="text-sm text-muted-foreground">Move tasks here to focus</p>
            </Card>
          ) : (
            <AnimatePresence initial={false} mode="popLayout">
              {todayTodos.map((todo) => (
                <TodoItem key={todo.id} todo={todo} showProject />
              ))}
            </AnimatePresence>
          )}
        </TabsContent>

        <TabsContent value="someday" className="space-y-3 mt-0">
          {someDayTodos.length === 0 ? (
            <Card className="p-12 text-center">
              <Cloud weight="thin" size={48} className="mx-auto mb-4 text-muted-foreground" />
              <h3 className="text-lg font-semibold mb-2">Your idea list is empty</h3>
              <p className="text-sm text-muted-foreground">Capture ideas without committing</p>
            </Card>
          ) : (
            <AnimatePresence initial={false} mode="popLayout">
              {someDayTodos.map((todo) => (
                <TodoItem key={todo.id} todo={todo} showProject />
              ))}
            </AnimatePresence>
          )}
        </TabsContent>

        <TabsContent value="projects" className="space-y-4 mt-0">
          {projects.length === 0 ? (
            <Card className="p-12 text-center">
              <Folder weight="thin" size={48} className="mx-auto mb-4 text-muted-foreground" />
              <h3 className="text-lg font-semibold mb-2">No projects yet</h3>
              <p className="text-sm text-muted-foreground mb-4">Create projects to organize your todos</p>
              <Button onClick={() => setIsProjectDialogOpen(true)} className="gap-2">
                <Plus size={16} weight="bold" />
                Create Your First Project
              </Button>
            </Card>
          ) : (
            <div className="space-y-4">
              {projects.map((project) => {
                const projectTodos = getTodosByProject(project.id);
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
                            No todos in this project
                          </p>
                        ) : (
                          projectTodos.map((todo) => (
                            <TodoItem key={todo.id} todo={todo} />
                          ))
                        )}
                      </AnimatePresence>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {doneTodos.length > 0 && (
        <div className="mt-8">
          <div className="flex items-center gap-2 mb-3">
            <CheckCircle size={20} className="text-muted-foreground" />
            <h3 className="text-lg font-semibold text-muted-foreground">Completed</h3>
            <Badge variant="outline">{doneTodos.length}</Badge>
          </div>
          <div className="space-y-2">
            <AnimatePresence initial={false} mode="popLayout">
              {doneTodos.slice(0, 5).map((todo) => (
                <TodoItem key={todo.id} todo={todo} showProject />
              ))}
            </AnimatePresence>
          </div>
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
