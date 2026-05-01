import { v4 as uuidv4 } from 'uuid';
import { Project, STORES } from '../schema';
import { clearStore, getAll, getByKey, put, remove, getAllByIndex } from '../core';
import { deleteTodo } from './todosRepo';
import { unlinkNotesFromProject } from './notesRepo';

export async function getAllProjects(): Promise<Project[]> {
  return getAll<Project>(STORES.PROJECTS);
}

export async function getProjectById(id: string): Promise<Project | undefined> {
  return getByKey<Project>(STORES.PROJECTS, id);
}

export async function createProject(
  data: Omit<Project, 'id' | 'createdAt' | 'updatedAt'>
): Promise<Project> {
  const now = new Date().toISOString();
  const project: Project = {
    ...data,
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

  // Cascade: delete all todos that belong to this project.
  // deleteTodo() already cascades to linked time blocks.
  const linkedTodos = await getAllByIndex<{ id: string }>(STORES.TODOS, 'projectId', id);
  await Promise.all(linkedTodos.map((todo) => deleteTodo(todo.id)));

  // Notes are *not* cascade-deleted — they're unlinked so the user keeps
  // their writing.  A removed project should never silently destroy notes.
  await unlinkNotesFromProject(id);

  await remove(STORES.PROJECTS, id);
  return true;
}

export async function deleteAllProjects(): Promise<void> {
  await clearStore(STORES.PROJECTS);
}
