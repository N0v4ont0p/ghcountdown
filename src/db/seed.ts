import { createEvent, getAllEvents } from './repositories/eventsRepo';
import { createProject, getAllProjects } from './repositories/projectsRepo';
import { createTodo, getAllTodos } from './repositories/todosRepo';

export async function seedDatabase() {
  const events = await getAllEvents();
  const projects = await getAllProjects();
  const todos = await getAllTodos();

  if (events.length > 0 || projects.length > 0 || todos.length > 0) {
    return;
  }

  const now = new Date();
  
  const projectLaunch = await createEvent({
    title: 'Product Launch Day',
    startsAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    allDay: false,
    priority: 5,
    tags: ['work', 'milestone'],
    notes: 'Final launch of the new product line. All hands on deck!',
  });

  await createEvent({
    title: 'Team Offsite',
    startsAt: new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString(),
    allDay: true,
    priority: 4,
    tags: ['team', 'planning'],
    notes: 'Quarterly planning session in the mountains.',
  });

  await createEvent({
    title: 'Client Presentation',
    startsAt: new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString(),
    allDay: false,
    priority: 5,
    tags: ['client', 'presentation'],
    notes: 'Present Q4 results to the board.',
  });

  const workProject = await createProject({
    name: 'Product Launch',
    color: 'oklch(0.60 0.19 250)',
  });

  const personalProject = await createProject({
    name: 'Personal Goals',
    color: 'oklch(0.65 0.20 150)',
  });

  await createTodo({
    title: 'Finalize launch presentation deck',
    status: 'today',
    dueAt: new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000).toISOString(),
    priority: 5,
    projectId: workProject.id,
    eventId: projectLaunch.id,
  });

  await createTodo({
    title: 'Review marketing materials',
    status: 'today',
    dueAt: null,
    priority: 4,
    projectId: workProject.id,
    eventId: null,
  });

  await createTodo({
    title: 'Schedule team sync',
    status: 'inbox',
    dueAt: null,
    priority: 3,
    projectId: workProject.id,
    eventId: null,
  });

  await createTodo({
    title: 'Update portfolio website',
    status: 'inbox',
    dueAt: null,
    priority: 2,
    projectId: personalProject.id,
    eventId: null,
  });

  await createTodo({
    title: 'Plan weekend hike',
    status: 'inbox',
    dueAt: null,
    priority: 1,
    projectId: personalProject.id,
    eventId: null,
  });
}
