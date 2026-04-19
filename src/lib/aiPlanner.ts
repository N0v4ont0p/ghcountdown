export type AISeverity = 'low' | 'medium' | 'high' | 'critical';

export interface AISuggestion {
  id: string;
  type: 'todo' | 'event' | 'timeBlock';
  title: string;
  priority: 1 | 2 | 3 | 4 | 5;
  cognitiveLoad: 'high' | 'medium' | 'low' | null;
  notes?: string;
  dueAt?: string | null;
  startsAt?: string;
  allDay?: boolean;
  date?: string;
  startTime?: string;
  endTime?: string;
  autoTrack?: boolean;
}

export interface AIAssistantResult {
  summary: string;
  severity: AISeverity;
  urgencyHours: number | null;
  confidence: number;
  suggestions: AISuggestion[];
}

interface AIContext {
  todoTitles: string[];
  upcomingEventTitles: string[];
  recentBlockTitles: string[];
  unscheduledTodayTodos: string[];
  overdueTodos: string[];
  currentStreak: number;
  todayFocusMinutes: number;
  nextEventDateTime: string | null;
  weeklySkeletonSummary: string;
  currentLocation: string;
  peakFocusHoursToday: string[];
  typicalActivitiesNow: string[];
  activeGoals?: string;
}

const ENV_HUGGING_FACE_API_KEY = import.meta.env.VITE_HUGGINGFACE_API_KEY;
const FIXED_MODEL = 'openai/gpt-oss-120b';

const CHAT_COMPLETIONS_ENDPOINTS = [
  { buildUrl: () => 'https://router.huggingface.co/v1/chat/completions' },
];
const AUTH_FAILURE_CODES = new Set([401, 403]);
export type AIMode = 'plan' | 'agent';

export interface AIConfiguration {
  apiKey: string;
}

let runtimeApiKey = ENV_HUGGING_FACE_API_KEY || '';

export function getAIConfiguration(): AIConfiguration {
  return {
    apiKey: runtimeApiKey,
  };
}

export function updateAIConfiguration(config: Partial<AIConfiguration>) {
  if ('apiKey' in config) {
    runtimeApiKey = config.apiKey?.trim() || '';
  }
}

function toIsoDate(date: Date) {
  return date.toISOString().split('T')[0];
}

function toIsoDateTimeOrNull(value?: string | null): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function normalizePriority(value: unknown): 1 | 2 | 3 | 4 | 5 {
  const parsed = Number(value);
  if (parsed >= 5) return 5;
  if (parsed >= 4) return 4;
  if (parsed >= 3) return 3;
  if (parsed >= 2) return 2;
  return 1;
}

function normalizeSeverity(value: unknown): AISeverity {
  if (value === 'critical' || value === 'high' || value === 'medium' || value === 'low') {
    return value;
  }
  return 'medium';
}

function normalizeCognitiveLoad(value: unknown): 'high' | 'medium' | 'low' | null {
  if (value === 'high' || value === 'medium' || value === 'low') return value;
  return null;
}

function normalizeClockValue(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim();
  if (/^([01]\d|2[0-3]):[0-5]\d$/.test(normalized)) {
    return normalized;
  }
  return fallback;
}

function withOneHourAfter(startTime: string): string {
  const [h, m] = startTime.split(':').map(Number);
  const minutes = h * 60 + m + 60;
  const wrapped = minutes % (24 * 60);
  const endHour = String(Math.floor(wrapped / 60)).padStart(2, '0');
  const endMinute = String(wrapped % 60).padStart(2, '0');
  return `${endHour}:${endMinute}`;
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function extractFirstJsonObject(text: string): unknown {
  const trimmed = text.trim();
  const direct = safeJsonParse(trimmed);
  if (direct) return direct;

  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenceMatch?.[1]) {
    const fenced = safeJsonParse(fenceMatch[1]);
    if (fenced) return fenced;
  }

  const firstCurly = trimmed.indexOf('{');
  const lastCurly = trimmed.lastIndexOf('}');
  if (firstCurly >= 0 && lastCurly > firstCurly) {
    const objectCandidate = safeJsonParse(trimmed.slice(firstCurly, lastCurly + 1));
    if (objectCandidate) return objectCandidate;
  }

  const firstSquare = trimmed.indexOf('[');
  const lastSquare = trimmed.lastIndexOf(']');
  if (firstSquare >= 0 && lastSquare > firstSquare) {
    const arrayCandidate = safeJsonParse(trimmed.slice(firstSquare, lastSquare + 1));
    if (arrayCandidate) return arrayCandidate;
  }

  return null;
}

function normalizeSuggestion(raw: any): AISuggestion | null {
  const source = raw && typeof raw === 'object' ? raw : {};
  const normalizedType = typeof source.type === 'string' ? source.type.toLowerCase() : 'todo';
  const type = normalizedType === 'event' || normalizedType === 'timeblock' || normalizedType === 'time_block'
    ? (normalizedType === 'event' ? 'event' : 'timeBlock')
    : 'todo';
  const titleValue = source.title ?? source.name ?? source.task ?? source.text ?? source.action;
  const title = typeof titleValue === 'string' && titleValue.trim()
    ? titleValue.trim()
    : 'Untitled action';
  const now = new Date();
  const defaultDate = toIsoDate(now);
  const startTime = normalizeClockValue(source.startTime ?? source.start ?? source.from, '09:00');
  const endTime = normalizeClockValue(source.endTime ?? source.end ?? source.to, withOneHourAfter(startTime));
  const startsAt = toIsoDateTimeOrNull(source.startsAt ?? source.startAt ?? source.when)
    || new Date(`${defaultDate}T${startTime}:00`).toISOString();

  return {
    id: crypto.randomUUID(),
    type,
    title,
    priority: normalizePriority(source.priority ?? source.urgency ?? source.importance),
    cognitiveLoad: normalizeCognitiveLoad(source.cognitiveLoad ?? source.load),
    notes: typeof source.notes === 'string' ? source.notes.trim() : undefined,
    dueAt: toIsoDateTimeOrNull(source.dueAt ?? source.dueDate ?? source.deadline),
    startsAt,
    allDay: Boolean(source.allDay),
    date: typeof source.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(source.date) ? source.date : defaultDate,
    startTime,
    endTime,
    autoTrack: source.autoTrack !== false,
  };
}

function normalizeAIResponse(raw: any): AIAssistantResult {
  const suggestionSource = Array.isArray(raw)
    ? raw
    : Array.isArray(raw?.suggestions)
      ? raw.suggestions
      : Array.isArray(raw?.actions)
        ? raw.actions
        : [];

  const suggestions = suggestionSource
    .map((s: any) => normalizeSuggestion(s))
    .filter((s: any): s is AISuggestion => Boolean(s));

  return {
    summary: typeof raw?.summary === 'string'
      ? raw.summary
      : typeof raw?.message === 'string'
        ? raw.message
        : 'Actions created.',
    severity: normalizeSeverity(raw.severity),
    urgencyHours: raw.urgencyHours ?? null,
    confidence: Math.max(0, Math.min(1, Number(raw.confidence) || 0.8)),
    suggestions,
  };
}

export function isAIConfigured() {
  return Boolean(getAIConfiguration().apiKey);
}

function buildSystemPrompt(mode: AIMode): string {
  const today = new Date().toISOString().split('T')[0];
  const tomorrow = new Date(Date.now() + 86400000)
    .toISOString().split('T')[0];

  const modeDirective = mode === 'agent'
    ? 'You are an autonomous productivity agent. Execute immediately. Infer all missing details. Never ask questions. Be decisive about times, dates, and priorities.'
    : 'You are a productivity planning assistant. Be concise and practical.';

  return `${modeDirective}

Today is ${today}. Tomorrow is ${tomorrow}.
Always output times in 24-hour HH:mm format. "2pm"=14:00, "9am"=09:00, "noon"=12:00, "midnight"=00:00.

Create 2-5 suggestions that directly address the user request.
Hard constraints:
- Never schedule over fixed weekly skeleton commitments.
- Prefer peak focus hours when suggesting focused work.
- Respect location constraints when scheduling.
- Support "skeleton mode" requests by proposing changes to routine structure instead of conflicting timeline blocks.
Mix suggestion types appropriately:
- Use "timeBlock" to schedule focused work sessions (requires date in YYYY-MM-DD, startTime and endTime in HH:mm 24h format)
- Use "event" for deadlines, meetings, or appointments (requires startsAt as full ISO datetime e.g. ${today}T18:00:00.000Z)
- Use "todo" for tasks and action items (optional dueAt as full ISO datetime)
${mode === 'agent' ? '- In agent mode, include "status":"today" for todo suggestions so they appear immediately in the Today list.' : ''}

Priority scale: 5=critical deadline, 4=high importance, 3=normal, 2=low priority, 1=someday.
Cognitive load scale for every todo/timeBlock suggestion: "high" (writing, coding, problem-solving, deep analysis), "medium" (reading, planning, reviewing), "low" (admin, replies, organizing, simple errands). Always include cognitiveLoad in every suggestion.
Confidence is 0.0 to 1.0 representing how well you understood the request.
urgencyHours is how many hours until something is urgent, or null if not time-sensitive.
You can produce timeBlocks for ANY date, not just today. Use the "date" field to specify which day. If user mentions "this week" produce blocks across Mon-Fri. If they mention "tomorrow" use the tomorrow date given above.`;
}

function buildModelCandidates(requestedModel: string) {
  return [requestedModel?.trim() || FIXED_MODEL];
}

function formatAttemptError(status: number | null, endpoint: string, model: string, detail?: string) {
  const statusText = status === null ? 'network failure' : `HTTP ${status}`;
  const detailText = detail ? `: ${detail}` : '';
  return `${statusText} at ${endpoint} using model "${model}"${detailText}`;
}

/** Attempt a single endpoint+model combination. Returns the parsed JSON body on success
 *  or throws with a descriptive message on failure. */
async function attemptRequest(params: {
  apiKey: string;
  model: string;
  systemPrompt: string;
  userPrompt: string;
  endpointUrl: string;
}): Promise<{ ok: boolean; status: number | null; json: unknown; error?: string }> {
  const requestBody = JSON.stringify({
    model: `${params.model}:cerebras`,
    temperature: 0.1,
    max_tokens: 1000,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: params.systemPrompt },
      { role: 'user', content: params.userPrompt },
    ],
  });

  const requestHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${params.apiKey}`,
  };

  // In Electron the main-process bridge is available; it bypasses CORS entirely.
  const electronAPI = typeof window !== 'undefined' && (window as any).electronAPI;
  if (electronAPI?.aiRequest) {
    let raw: { ok: boolean; status: number; body: string };
    try {
      raw = await electronAPI.aiRequest({
        url: params.endpointUrl,
        method: 'POST',
        headers: requestHeaders,
        body: requestBody,
      });
    } catch (err) {
      return { ok: false, status: null, json: null, error: err instanceof Error ? err.message : String(err) };
    }
    let json: unknown = null;
    try { json = JSON.parse(raw.body); } catch { /* non-JSON */ }
    return { ok: raw.ok, status: raw.status, json };
  }

  // Web / browser fallback — subject to CORS but works in plain browser deployments.
  try {
    const response = await fetch(params.endpointUrl, {
      method: 'POST',
      headers: requestHeaders,
      body: requestBody,
    });
    let json: unknown = null;
    try { json = await response.clone().json(); } catch { /* non-JSON */ }
    return { ok: response.ok, status: response.status, json };
  } catch (err) {
    return { ok: false, status: null, json: null, error: err instanceof Error ? err.message : String(err) };
  }
}

async function requestWithFallback(params: {
  apiKey: string;
  model: string;
  systemPrompt: string;
  userPrompt: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
}): Promise<any> {
  const modelCandidates = buildModelCandidates(params.model);
  let attempts = 0;
  let finalError = 'AI request failed.';

  for (const endpoint of CHAT_COMPLETIONS_ENDPOINTS) {
    for (const model of modelCandidates) {
      attempts += 1;
      const endpointUrl = endpoint.buildUrl();
      const result = await attemptRequest({ ...params, model, endpointUrl });

      if (result.ok) {
        return result.json;
      }

      const detail = typeof (result.json as any)?.error?.message === 'string'
        ? (result.json as any).error.message
        : typeof (result.json as any)?.error === 'string'
          ? (result.json as any).error
          : result.error || '';

      finalError = formatAttemptError(result.status, endpointUrl, model, detail);

      if (result.status !== null && AUTH_FAILURE_CODES.has(result.status)) {
        throw new Error('Authentication failed. Check your Hugging Face key and permissions.');
      }
    }
  }

  throw new Error(`AI request failed after ${attempts} attempt(s). Last error: ${finalError}`);
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function validateAndRepairResult(
  raw: any,
  _prompt: string
): { valid: boolean; result?: AIAssistantResult; error?: string } {
  if (!raw || typeof raw !== 'object') {
    return { valid: false, error: 'Response is not a JSON object' };
  }

  if (!Array.isArray(raw.suggestions) || raw.suggestions.length === 0) {
    return { valid: false, error: 'No suggestions in response' };
  }

  // Repair each suggestion rather than silently defaulting
  const today = new Date().toISOString().split('T')[0];
  const repairedSuggestions: AISuggestion[] = [];

  for (const s of raw.suggestions) {
    if (!s || typeof s.title !== 'string' || !s.title.trim()) continue;

    // Repair type
    const validTypes = ['todo', 'event', 'timeBlock'];
    const type = validTypes.includes(s.type) ? s.type : 'todo';

    // Repair priority
    const priority = normalizePriority(s.priority);

    // Repair dates — try multiple common formats the model produces
    let startsAt = s.startsAt;
    if (startsAt && isNaN(new Date(startsAt).getTime())) {
      // Try to parse natural language the model snuck in
      const parsed = new Date(startsAt);
      startsAt = isNaN(parsed.getTime())
        ? new Date().toISOString()
        : parsed.toISOString();
    }

    // Repair timeBlock times — accept "9am", "9:00am", "09:00", "9"
    let startTime = s.startTime || '09:00';
    let endTime = s.endTime || '10:00';

    const parseTime = (t: string): string => {
      if (/^([01]\d|2[0-3]):[0-5]\d$/.test(t)) return t;
      const match = t.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
      if (match) {
        let h = parseInt(match[1]);
        const m = match[2] ? parseInt(match[2]) : 0;
        const meridiem = (match[3] || '').toLowerCase();
        if (meridiem === 'pm' && h !== 12) h += 12;
        if (meridiem === 'am' && h === 12) h = 0;
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
      }
      return t.includes('start') ? '09:00' : '10:00';
    };

    startTime = parseTime(startTime);
    endTime = parseTime(endTime);

    // Ensure endTime is after startTime
    if (endTime <= startTime) {
      const [h, m] = startTime.split(':').map(Number);
      const totalMins = h * 60 + m + 60;
      endTime = `${String(Math.floor(totalMins/60)%24).padStart(2,'0')}:${String(totalMins%60).padStart(2,'0')}`;
    }

    repairedSuggestions.push({
      id: crypto.randomUUID(),
      type,
      title: s.title.trim(),
      priority,
      cognitiveLoad: normalizeCognitiveLoad(s.cognitiveLoad),
      notes: typeof s.notes === 'string' ? s.notes.trim() : undefined,
      dueAt: s.dueAt ? (isNaN(new Date(s.dueAt).getTime()) ? null : new Date(s.dueAt).toISOString()) : null,
      startsAt: startsAt || new Date().toISOString(),
      allDay: Boolean(s.allDay),
      date: /^\d{4}-\d{2}-\d{2}$/.test(s.date) ? s.date : today,
      startTime,
      endTime,
      autoTrack: s.autoTrack !== false,
    });
  }

  if (repairedSuggestions.length === 0) {
    return { valid: false, error: 'All suggestions were malformed' };
  }

  return {
    valid: true,
    result: {
      summary: typeof raw.summary === 'string' ? raw.summary : 'Actions created.',
      severity: normalizeSeverity(raw.severity),
      urgencyHours: Number.isFinite(Number(raw.urgencyHours)) ? Number(raw.urgencyHours) : null,
      confidence: Math.max(0, Math.min(1, Number(raw.confidence) || 0.7)),
      suggestions: repairedSuggestions,
    },
  };
}

export async function generateActionPlan(
  prompt: string,
  context: AIContext,
  options?: { mode?: AIMode }
): Promise<AIAssistantResult> {
  const config = getAIConfiguration();
  const mode = options?.mode ?? 'plan';

  if (!config.apiKey) {
    throw new Error('AI is not configured. Add your Hugging Face API key in-app or via VITE_HUGGINGFACE_API_KEY.');
  }

  const systemPrompt = buildSystemPrompt(mode);

  const now = new Date();
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const localISO = new Date(
    now.getTime() - now.getTimezoneOffset() * 60000
  ).toISOString().slice(0, 19);
  const dayName = now.toLocaleDateString('en-US', { weekday: 'long' });
  const offsetMin = -now.getTimezoneOffset();
  const offsetSign = offsetMin >= 0 ? '+' : '-';
  const offsetHours = String(Math.floor(Math.abs(offsetMin) / 60)).padStart(2, '0');
  const offsetMins = String(Math.abs(offsetMin) % 60).padStart(2, '0');
  const offsetStr = `${offsetSign}${offsetHours}:${offsetMins}`;

  const userPrompt = [
    `Current local date-time: ${localISO} (${dayName})`,
    `User timezone: ${tz} (UTC${offsetStr})`,
    `IMPORTANT: All times you produce must be interpreted in the user's local timezone.`,
    `When user says "2pm" output "14:00". When user says "this Sunday" use the Sunday that comes AFTER today in user's timezone.`,
    `All startsAt values in your JSON output MUST include the timezone offset ${offsetStr} (e.g. 2026-04-19T14:00:00${offsetStr})`,
    `Existing todos: ${context.todoTitles.join(' | ') || 'none'}`,
    `Upcoming events: ${context.upcomingEventTitles.join(' | ') || 'none'}`,
    `Recent time blocks: ${context.recentBlockTitles.join(' | ') || 'none'}`,
    `Unscheduled today todos: ${context.unscheduledTodayTodos.join(' | ') || 'none'}`,
    `Overdue todos: ${context.overdueTodos.join(' | ') || 'none'}`,
    `Current productivity streak: ${context.currentStreak} day${context.currentStreak !== 1 ? 's' : ''}`,
    `Today focused minutes: ${context.todayFocusMinutes}`,
    `Next event: ${context.nextEventDateTime ?? 'none'}`,
    `Weekly skeleton summary: ${context.weeklySkeletonSummary || 'none'}`,
    `Current location: ${context.currentLocation || 'unknown'}`,
    `Peak focus hours today: ${context.peakFocusHoursToday.join(', ') || 'none'}`,
    `Typical activities now: ${context.typicalActivitiesNow.join(', ') || 'none'}`,
    context.activeGoals ? `Active goals: ${context.activeGoals}` : '',
    context.activeGoals ? `When suggesting new todos, link them to a relevant goal (add a "goalNote" field with the goal title) where it makes sense.` : '',
    ``,
    `User request: ${prompt.trim()}`,
  ].filter(Boolean).join('\n');

  const parseResponseOrThrow = (body: any) => {
    const textResponse =
      body?.choices?.[0]?.message?.content ||
      body?.generated_text ||
      body?.[0]?.generated_text || '';

    if (!textResponse || textResponse.trim().length === 0) {
      const error = new Error('AI returned an empty response. Check your API key and try again.');
      (error as Error & { code?: string }).code = 'EMPTY_RESPONSE';
      throw error;
    }

    const parsed = safeJsonParse(textResponse.trim()) ?? extractFirstJsonObject(textResponse);
    if (!parsed) {
      const error = new Error('AI returned malformed JSON.');
      (error as Error & { code?: string }).code = 'PARSE_FAILED';
      throw error;
    }

    const normalized = normalizeAIResponse(parsed);
    if (normalized.suggestions.length === 0) {
      const error = new Error('AI returned no actionable suggestions.');
      (error as Error & { code?: string }).code = 'NO_SUGGESTIONS';
      throw error;
    }

    return normalized;
  };

  const runRequest = async (inputSystemPrompt: string, inputUserPrompt: string) => {
    const body = await requestWithFallback({
      apiKey: config.apiKey,
      model: FIXED_MODEL,
      systemPrompt: inputSystemPrompt,
      userPrompt: inputUserPrompt,
    });
    return parseResponseOrThrow(body);
  };

  try {
    return await runRequest(systemPrompt, userPrompt);
  } catch (firstError) {
    const code = (firstError as Error & { code?: string }).code;
    const shouldRetry = code === 'EMPTY_RESPONSE' || code === 'PARSE_FAILED' || code === 'NO_SUGGESTIONS';
    if (!shouldRetry) throw firstError;

    const retrySystemPrompt = `You are a productivity assistant.
Return only valid JSON.
Return exactly one todo suggestion for the single most important next action.`;
    const retryUserPrompt = [
      'Output JSON shape:',
      '{"summary":"...","suggestions":[{"type":"todo","title":"...","priority":3,"cognitiveLoad":"medium"}]}',
      `User request: ${prompt.trim()}`,
    ].join('\n');

    return runRequest(retrySystemPrompt, retryUserPrompt);
  }
}
