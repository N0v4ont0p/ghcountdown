import { v4 as uuidv4 } from 'uuid';
import { Project, STORES } from '../schema';
import { clearStore, getAll, getByKey, put, remove, getAllByIndex } from '../core';
import { updateTodo } from './todosRepo';
import { unlinkNotesFromProject } from './notesRepo';

export async function getAllProjects(): Promise<Project[]> {
  return getAll<Project>(STORES.PROJECTS);
}

export async function getProjectById(id: string): Promise<Project | undefined> {
  return getByKey<Project>(STORES.PROJECTS, id);
}

export async function createProject(
  data: Omit<Project, 'id' | 'createdAt' | 'updatedAt' | 'icon' | 'description' | 'status'> &
    Partial<Pick<Project, 'icon' | 'description' | 'status'>>
): Promise<Project> {
  const now = new Date().toISOString();
  const project: Project = {
    name: data.name,
    color: data.color,
    icon: data.icon ?? null,
    description: data.description ?? '',
    status: data.status ?? 'active',
    id: uuidv4(),
    createdAt: now,
    updatedAt: now,
  };
  await put(STORES.PROJECTS, project);
  return project;
}

export async function updateProject(
  id: string,
  data: Partial<Omit<Project, 'id' | 'createdAt' | 'updatedAt'>>
): Promise<Project | null> {
  const existing = await getProjectById(id);
  if (!existing) return null;

  const updated: Project = {
    ...existing,
    ...data,
    updatedAt: new Date().toISOString(),
  };
  await put(STORES.PROJECTS, updated);
  return updated;
}

export async function deleteProject(id: string): Promise<boolean> {
  const existing = await getProjectById(id);
  if (!existing) return false;

  // Unlink (NOT delete) all todos that belong to this project so the user
  // never silently loses tasks when removing a project.  This matches the
  // confirmation copy shown in the UI ("Todos in this project will not be
  // deleted, but will no longer be linked to it") and keeps references safe
  // — every todo's `projectId` ends up `null`, never a dangling id.
  const linkedTodos = await getAllByIndex<{ id: string }>(STORES.TODOS, 'projectId', id);
  await Promise.all(linkedTodos.map((todo) => updateTodo(todo.id, { projectId: null })));

  // Notes are unlinked too — same rationale.
  await unlinkNotesFromProject(id);

  await remove(STORES.PROJECTS, id);
  return true;
}

export async function deleteAllProjects(): Promise<void> {
  await clearStore(STORES.PROJECTS);
}
