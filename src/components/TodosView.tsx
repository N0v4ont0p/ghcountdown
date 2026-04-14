import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Todo, Project } from '@/db/schema';
import { getAllTodos, createTodo, updateTodo, deleteTodo } from '@/db/repositories/todosRepo';
import { getAllProjects, createProject, deleteProject } from '@/db/repositories/projectsRepo';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Plus, Trash, Folder, CheckCircle, Tray, CalendarCheck } from '@phosphor-icons/react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

export function TodosView() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isProjectDialogOpen, setIsProjectDialogOpen] = useState(false);
  const [currentTab, setCurrentTab] = useState<'inbox' | 'today' | 'projects'>('inbox');
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [todoToDelete, setTodoToDelete] = useState<string | null>(null);
  const [deleteProjectConfirmOpen, setDeleteProjectConfirmOpen] = useState(false);
  const [projectToDelete, setProjectToDelete] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    title: '',
    status: 'inbox' as 'inbox' | 'today' | 'done',
    dueAt: '',
    priority: 3 as 1 | 2 | 3 | 4 | 5,
    projectId: 'none',
  });

  const [projectFormData, setProjectFormData] = useState({
    name: '',
    color: 'oklch(0.60 0.19 250)',
  });

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    const [allTodos, allProjects] = await Promise.all([
      getAllTodos(),
      getAllProjects(),
    ]);
    setTodos(allTodos);
    setProjects(allProjects);
  }

  function resetForm() {
    setFormData({
      title: '',
      status: currentTab === 'projects' ? 'inbox' : currentTab,
      dueAt: '',
      priority: 3,
      projectId: selectedProjectId || 'none',
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!formData.title) {
      toast.error('Please enter a title');
      return;
    }

    try {
      await createTodo({
        title: formData.title,
        status: formData.status,
        dueAt: formData.dueAt || null,
        priority: formData.priority,
        projectId: formData.projectId !== 'none' ? formData.projectId : null,
        eventId: null,
      });
      
      toast.success('Todo created!');
      setIsDialogOpen(false);
      resetForm();
      loadData();
    } catch (error) {
      toast.error('Failed to create todo');
    }
  }

  async function handleToggle(todo: Todo) {
    const newStatus = todo.status === 'done' ? 'inbox' : 'done';
    await updateTodo(todo.id, { status: newStatus });
    loadData();
    if (newStatus === 'done') {
      toast.success('Task completed!');
    }
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
    if (todoToDelete) {
      await deleteTodo(todoToDelete);
      toast.success('Todo deleted');
      setTodoToDelete(null);
      loadData();
    }
  }

  async function handleDeleteProject(id: string) {
    setProjectToDelete(id);
    setDeleteProjectConfirmOpen(true);
  }

  async function handleDeleteProjectConfirm() {
    if (projectToDelete) {
      await deleteProject(projectToDelete);
      toast.success('Project deleted');
      setProjectToDelete(null);
      loadData();
    }
  }

  async function handleProjectSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!projectFormData.name) {
      toast.error('Please enter a project name');
      return;
    }

    try {
      await createProject(projectFormData);
      toast.success('Project created!');
      setIsProjectDialogOpen(false);
      setProjectFormData({ name: '', color: 'oklch(0.60 0.19 250)' });
      loadData();
    } catch (error) {
      toast.error('Failed to create project');
    }
  }

  const inboxTodos = todos.filter(t => t.status === 'inbox');
  const todayTodos = todos.filter(t => t.status === 'today');
  const doneTodos = todos.filter(t => t.status === 'done');

  function getTodosByProject(projectId: string) {
    return todos.filter(t => t.projectId === projectId && t.status !== 'done');
  }

  function TodoItem({ todo, showProject = false }: { todo: Todo; showProject?: boolean }) {
    const project = todo.projectId ? projects.find(p => p.id === todo.projectId) : null;
    const isDone = todo.status === 'done';

    return (
      <motion.div
        layout
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        transition={{ type: 'spring', stiffness: 500, damping: 30 }}
      >
        <Card className={cn(
          "p-3 group hover:shadow-sm transition-all duration-200",
          isDone && "opacity-60"
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
                {todo.priority >= 4 && (
                  <Badge variant="destructive" className="h-5 text-xs">High</Badge>
                )}
                {showProject && project && (
                  <Badge
                    variant="outline"
                    className="h-5 text-xs"
                    style={{ borderColor: project.color }}
                  >
                    <Folder size={10} weight="fill" style={{ color: project.color }} className="mr-1" />
                    {project.name}
                  </Badge>
                )}
              </div>
              
              {todo.dueAt && (
                <p className="text-xs text-muted-foreground mt-1">
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
        <p className="text-muted-foreground">Organize tasks by inbox, today, and projects</p>
      </div>

      <Tabs value={currentTab} onValueChange={(v) => setCurrentTab(v as any)} className="space-y-6">
        <div className="flex items-center justify-between">
          <TabsList>
            <TabsTrigger value="inbox" className="gap-2">
              <Tray size={16} />
              Inbox
              {inboxTodos.length > 0 && (
                <Badge variant="secondary" className="ml-1 h-5 min-w-5 px-1">
                  {inboxTodos.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="today" className="gap-2">
              <CalendarCheck size={16} />
              Today
              {todayTodos.length > 0 && (
                <Badge variant="secondary" className="ml-1 h-5 min-w-5 px-1">
                  {todayTodos.length}
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
              <Dialog open={isProjectDialogOpen} onOpenChange={setIsProjectDialogOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-2">
                    <Plus size={14} weight="bold" />
                    New Project
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Create New Project</DialogTitle>
                  </DialogHeader>
                  <form onSubmit={handleProjectSubmit} className="space-y-4">
                    <div>
                      <Label htmlFor="projectName">Project Name</Label>
                      <Input
                        id="projectName"
                        value={projectFormData.name}
                        onChange={(e) => setProjectFormData({ ...projectFormData, name: e.target.value })}
                        placeholder="Work, Personal, Side Project..."
                        required
                      />
                    </div>

                    <div>
                      <Label htmlFor="projectColor">Color</Label>
                      <div className="grid grid-cols-6 gap-2 mt-2">
                        {[
                          'oklch(0.60 0.19 250)',
                          'oklch(0.65 0.20 150)',
                          'oklch(0.70 0.22 50)',
                          'oklch(0.65 0.20 350)',
                          'oklch(0.60 0.18 200)',
                          'oklch(0.68 0.19 100)',
                        ].map((color) => (
                          <button
                            key={color}
                            type="button"
                            onClick={() => setProjectFormData({ ...projectFormData, color })}
                            className={cn(
                              "w-10 h-10 rounded-lg border-2 transition-all",
                              projectFormData.color === color ? "border-foreground scale-110" : "border-transparent"
                            )}
                            style={{ backgroundColor: color }}
                          />
                        ))}
                      </div>
                    </div>

                    <div className="flex justify-end gap-2 pt-4">
                      <Button type="button" variant="outline" onClick={() => setIsProjectDialogOpen(false)}>
                        Cancel
                      </Button>
                      <Button type="submit">Create Project</Button>
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
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Create New Todo</DialogTitle>
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
                        onValueChange={(val: any) => setFormData({ ...formData, status: val })}
                      >
                        <SelectTrigger id="status">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="inbox">Inbox</SelectItem>
                          <SelectItem value="today">Today</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <Label htmlFor="priority">Priority</Label>
                      <Select
                        value={formData.priority.toString()}
                        onValueChange={(val) => setFormData({ ...formData, priority: parseInt(val) as any })}
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
                            {project.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label htmlFor="dueAt">Due Date (optional)</Label>
                    <Input
                      id="dueAt"
                      type="datetime-local"
                      value={formData.dueAt}
                      onChange={(e) => setFormData({ ...formData, dueAt: e.target.value })}
                    />
                  </div>

                  <div className="flex justify-end gap-2 pt-4">
                    <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
                      Cancel
                    </Button>
                    <Button type="submit">Create Todo</Button>
                  </div>
                </form>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        <TabsContent value="inbox" className="space-y-3 mt-0">
          {inboxTodos.length === 0 ? (
            <Card className="p-12 text-center">
              <Tray weight="thin" size={64} className="mx-auto mb-4 text-muted-foreground" />
              <h3 className="text-xl font-semibold mb-2">Inbox is Empty</h3>
              <p className="text-muted-foreground mb-4">All caught up!</p>
            </Card>
          ) : (
            <AnimatePresence mode="popLayout">
              {inboxTodos.map((todo) => (
                <TodoItem key={todo.id} todo={todo} showProject />
              ))}
            </AnimatePresence>
          )}
        </TabsContent>

        <TabsContent value="today" className="space-y-3 mt-0">
          {todayTodos.length === 0 ? (
            <Card className="p-12 text-center">
              <CalendarCheck weight="thin" size={64} className="mx-auto mb-4 text-muted-foreground" />
              <h3 className="text-xl font-semibold mb-2">No Tasks for Today</h3>
              <p className="text-muted-foreground mb-4">Add tasks to focus on today</p>
            </Card>
          ) : (
            <AnimatePresence mode="popLayout">
              {todayTodos.map((todo) => (
                <TodoItem key={todo.id} todo={todo} showProject />
              ))}
            </AnimatePresence>
          )}
        </TabsContent>

        <TabsContent value="projects" className="space-y-4 mt-0">
          {projects.length === 0 ? (
            <Card className="p-12 text-center">
              <Folder weight="thin" size={64} className="mx-auto mb-4 text-muted-foreground" />
              <h3 className="text-xl font-semibold mb-2">No Projects Yet</h3>
              <p className="text-muted-foreground mb-4">Create projects to organize your todos</p>
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
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <div
                          className="w-3 h-3 rounded-full"
                          style={{ backgroundColor: project.color }}
                        />
                        <h3 className="font-semibold text-lg">{project.name}</h3>
                        <Badge variant="secondary" className="h-5">
                          {projectTodos.length}
                        </Badge>
                      </div>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => handleDeleteProject(project.id)}
                        className="h-8 w-8 text-destructive hover:text-destructive hover:scale-110 active:scale-95 transition-transform"
                      >
                        <Trash size={16} />
                      </Button>
                    </div>
                    
                    <div className="space-y-2">
                      <AnimatePresence mode="popLayout">
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
            <AnimatePresence mode="popLayout">
              {doneTodos.slice(0, 5).map((todo) => (
                <TodoItem key={todo.id} todo={todo} showProject />
              ))}
            </AnimatePresence>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={deleteConfirmOpen}
        onOpenChange={setDeleteConfirmOpen}
        title="Delete Todo?"
        description="Are you sure you want to delete this todo? This action cannot be undone."
        actionType="delete"
        confirmText="Delete"
        cancelText="Cancel"
        onConfirm={handleDeleteConfirm}
      />

      <ConfirmDialog
        open={deleteProjectConfirmOpen}
        onOpenChange={setDeleteProjectConfirmOpen}
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
