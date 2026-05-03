export type AISeverity = 'low' | 'medium' | 'high' | 'critical';

export interface AISuggestion {
  id: string;
  type: 'todo' | 'event' | 'timeBlock';
  title: string;
  priority: 1 | 2 | 3 | 4 | 5;
  status?: 'today' | 'inbox';
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

/**
 * Parses the tagged text format produced by the AI model.
 * Extracts suggestion blocks between === SUGGESTIONS START === and === SUGGESTIONS END ===
 * and maps them to AISuggestion objects. Never throws — returns [] on any error.
 */
export function parseTaggedSuggestions(raw: string): AISuggestion[] {
  try {
    const START_MARKER = '=== SUGGESTIONS START ===';
    const END_MARKER = '=== SUGGESTIONS END ===';

    let content = raw;
    const startIdx = raw.indexOf(START_MARKER);
    const endIdx = raw.indexOf(END_MARKER);
    if (startIdx !== -1 && endIdx > startIdx) {
      content = raw.slice(startIdx + START_MARKER.length, endIdx);
    }

    content = content.trim();
    if (!content || content === 'NO_SUGGESTIONS') return [];

    // Split on lines that begin with CREATE_ to get individual blocks
    const blocks = content.split(/^(?=CREATE_)/m).map(b => b.trim()).filter(Boolean);

    const suggestions: AISuggestion[] = [];
    const now = new Date();
    const defaultDate = toIsoDate(now);

    for (const block of blocks) {
      const lines = block.split('\n');
      const typeTag = lines[0].trim().toUpperCase();

      const fields: Record<string, string> = {};
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        const colonIdx = line.indexOf(':');
        if (colonIdx < 1) continue;
        const key = line.slice(0, colonIdx).trim().toUpperCase();
        const value = line.slice(colonIdx + 1).trim();
        if (key && value) fields[key] = value;
      }

      const title = fields['TITLE'] || 'Untitled action';
      const priority = normalizePriority(fields['PRIORITY'] ?? '3');
      const cognitiveLoad = normalizeCognitiveLoad(
        (fields['COGNITIVE_LOAD'] ?? fields['COGNITIVE'] ?? '').toLowerCase() || null
      );

      if (typeTag === 'CREATE_TODO') {
        const rawStatus = (fields['STATUS'] ?? '').toLowerCase();
        const status: 'today' | 'inbox' = rawStatus === 'inbox' ? 'inbox' : 'today';
        suggestions.push({
          id: crypto.randomUUID(),
          type: 'todo',
          title,
          priority,
          status,
          cognitiveLoad,
          notes: fields['NOTES'] || undefined,
          dueAt: toIsoDateTimeOrNull(fields['DUE_AT'] ?? fields['DUE'] ?? null),
          startsAt: undefined,
          allDay: false,
          date: defaultDate,
          startTime: '09:00',
          endTime: '10:00',
          autoTrack: true,
        });
      } else if (typeTag === 'CREATE_EVENT') {
        const startsAtRaw = fields['STARTS_AT'] ?? fields['STARTS'] ?? fields['DATE'] ?? null;
        const startsAt = toIsoDateTimeOrNull(startsAtRaw) ?? new Date(`${defaultDate}T09:00:00`).toISOString();
        const allDay = (fields['ALL_DAY'] ?? '').toLowerCase() === 'true';
        suggestions.push({
          id: crypto.randomUUID(),
          type: 'event',
          title,
          priority,
          cognitiveLoad,
          notes: fields['NOTES'] || undefined,
          dueAt: null,
          startsAt,
          allDay,
          date: defaultDate,
          startTime: '09:00',
          endTime: '10:00',
          autoTrack: false,
        });
      } else if (typeTag === 'CREATE_TIMEBLOCK') {
        const date = /^\d{4}-\d{2}-\d{2}$/.test(fields['DATE'] ?? '') ? fields['DATE'] : defaultDate;
        const startTime = normalizeClockValue(fields['START_TIME'] ?? fields['STARTTIME'] ?? '09:00', '09:00');
        const endTime = normalizeClockValue(fields['END_TIME'] ?? fields['ENDTIME'] ?? '', withOneHourAfter(startTime));
        suggestions.push({
          id: crypto.randomUUID(),
          type: 'timeBlock',
          title,
          priority,
          cognitiveLoad,
          notes: fields['NOTES'] || undefined,
          dueAt: null,
          startsAt: new Date(`${date}T${startTime}:00`).toISOString(),
          allDay: false,
          date,
          startTime,
          endTime,
          autoTrack: true,
        });
      }
      // Unknown type tag — skip
    }

    return suggestions;
  } catch (err) {
    console.error('[parseTaggedSuggestions] Failed to parse response:', err, '\nRaw:', raw);
    return [];
  }
}

export function isAIConfigured() {
  return Boolean(getAIConfiguration().apiKey);
}

function buildSystemPrompt(mode: AIMode): string {
  const modeDirective = mode === 'agent'
    ? 'You are an autonomous productivity agent. Execute immediately. Infer all missing details. Never ask questions. Be decisive. Create 2-5 suggestions that directly address the request.'
    : 'You are a productivity planning assistant. Be concise and practical. Create 1-3 focused suggestions.';

  return `${modeDirective}

Output ONLY suggestion blocks between the markers below. Nothing else outside the markers matters.

Format rules:
- Wrap all output between === SUGGESTIONS START === and === SUGGESTIONS END ===
- Each block starts with CREATE_TODO, CREATE_EVENT, or CREATE_TIMEBLOCK on its own line
- Each field is FIELDNAME: value on its own line
- Blocks are separated by one blank line
- Times in 24-hour HH:mm format. "2pm"=14:00, "9am"=09:00, "noon"=12:00
- Always include the timezone offset in STARTS_AT (e.g. 2026-04-21T14:00:00+08:00)
- If nothing should be created output exactly: NO_SUGGESTIONS between the markers

Fields for CREATE_TODO: TITLE (required), PRIORITY 1-5 (default 3), STATUS today or inbox (default today), DURATION minutes (default 60), COGNITIVE_LOAD high/medium/low, DUE_AT ISO datetime (optional), NOTES (optional)
Fields for CREATE_EVENT: TITLE (required), STARTS_AT full ISO datetime with timezone offset (required), PRIORITY 1-5 (default 3), ALL_DAY true/false (default false), NOTES (optional)
Fields for CREATE_TIMEBLOCK: TITLE (required), DATE YYYY-MM-DD (required), START_TIME HH:mm (required), END_TIME HH:mm (required), PRIORITY 1-5 (default 3), COGNITIVE_LOAD high/medium/low

Priority scale: 5=critical, 4=high, 3=normal, 2=low, 1=minimal.
Cognitive load: "high" (coding, writing, deep analysis), "medium" (reading, planning, reviewing), "low" (admin, replies, errands).

--- EXAMPLE 1: Creating a todo ---
User request: I need to review my autonomous code for FTC before Saturday
Current date-time: 2026-04-20T09:00:00 (Monday)
Timezone: Asia/Singapore (UTC+08:00)
Today todos: Write report | Email coach
Upcoming events: FTC scrimmage on 2026-04-25
Active goals: Win FTC regionals

Generate suggestions now.

=== SUGGESTIONS START ===
CREATE_TODO
TITLE: Review FTC autonomous code
PRIORITY: 4
STATUS: today
DURATION: 90
COGNITIVE_LOAD: high
=== SUGGESTIONS END ===

--- EXAMPLE 2: Creating a time block ---
User request: Block out time tomorrow morning for deep coding work on the robot
Current date-time: 2026-04-20T09:00:00 (Monday)
Timezone: Asia/Singapore (UTC+08:00)
Today todos: FTC code review
Upcoming events: none
Active goals: none

Generate suggestions now.

=== SUGGESTIONS START ===
CREATE_TIMEBLOCK
TITLE: Deep coding session — robot
DATE: 2026-04-21
START_TIME: 09:00
END_TIME: 11:00
PRIORITY: 3
COGNITIVE_LOAD: high
=== SUGGESTIONS END ===

--- EXAMPLE 3: Creating an event ---
User request: Add FTC submission deadline on April 25th at 5pm Singapore time
Current date-time: 2026-04-20T09:00:00 (Monday)
Timezone: Asia/Singapore (UTC+08:00)
Today todos: none
Upcoming events: none
Active goals: none

Generate suggestions now.

=== SUGGESTIONS START ===
CREATE_EVENT
TITLE: FTC Submission Deadline
STARTS_AT: 2026-04-25T17:00:00+08:00
PRIORITY: 5
ALL_DAY: false
=== SUGGESTIONS END ===`;
}

/** Shorter prompt used on retry attempt 2: format rules + one example, no mode context. */
function buildShortSystemPrompt(): string {
  return `You are a productivity assistant.
Output ONLY suggestion blocks between the markers below. Nothing outside the markers is read.

Format rules:
- Wrap output between === SUGGESTIONS START === and === SUGGESTIONS END ===
- Each block starts with CREATE_TODO, CREATE_EVENT, or CREATE_TIMEBLOCK on its own line
- Each field is FIELDNAME: value on its own line
- Blocks separated by one blank line
- Times in 24-hour HH:mm. Always include timezone offset in STARTS_AT.
- If nothing to create: output NO_SUGGESTIONS between the markers.

Fields for CREATE_TODO: TITLE, PRIORITY 1-5 (default 3), STATUS today or inbox, COGNITIVE_LOAD high/medium/low
Fields for CREATE_EVENT: TITLE, STARTS_AT full ISO datetime with offset, PRIORITY 1-5, ALL_DAY true/false
Fields for CREATE_TIMEBLOCK: TITLE, DATE YYYY-MM-DD, START_TIME HH:mm, END_TIME HH:mm, PRIORITY 1-5, COGNITIVE_LOAD high/medium/low

Example:
User request: Review FTC code before Saturday

=== SUGGESTIONS START ===
CREATE_TODO
TITLE: Review FTC autonomous code
PRIORITY: 4
STATUS: today
COGNITIVE_LOAD: high
=== SUGGESTIONS END ===`;
}

/** Minimal prompt used on retry attempt 3: just the bare format rules and user input. */
function buildMinimalSystemPrompt(): string {
  return `Output suggestion blocks using this exact format:
=== SUGGESTIONS START ===
CREATE_TODO
TITLE: <action>
PRIORITY: 3
STATUS: today
COGNITIVE_LOAD: medium
=== SUGGESTIONS END ===
If nothing to create output NO_SUGGESTIONS between the markers. No other text.`;
}

function buildModelCandidates(requestedModel: string) {
  return [requestedModel?.trim() || FIXED_MODEL];
}

/** Pause execution for the given number of milliseconds. */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
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
  const electronAPI = typeof window !== 'undefined' && (window as {
    electronAPI?: {
      aiRequest?: (opts: { url: string; method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; body: string }>;
    };
  }).electronAPI;
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
}): Promise<unknown> {
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

      const errJson = result.json as { error?: { message?: string } | string } | null;
      const detail = typeof (errJson?.error as { message?: string } | undefined)?.message === 'string'
        ? (errJson!.error as { message: string }).message
        : typeof errJson?.error === 'string'
          ? errJson.error
          : result.error || '';

      finalError = formatAttemptError(result.status, endpointUrl, model, detail);

      if (result.status !== null && AUTH_FAILURE_CODES.has(result.status)) {
        throw new Error('Authentication failed. Check your Hugging Face key and permissions.');
      }

      if (result.status === 429) {
        throw new Error('Rate limit reached. Please wait a moment before trying again.');
      }
    }
  }

  throw new Error(`AI request failed after ${attempts} attempt(s). Last error: ${finalError}`);
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function validateAndRepairResult(
  raw: unknown,
  _prompt: string
): { valid: boolean; result?: AIAssistantResult; error?: string } {
  if (!raw || typeof raw !== 'object') {
    return { valid: false, error: 'Response is not a JSON object' };
  }

  const rawObj = raw as Record<string, unknown>;

  if (!Array.isArray(rawObj.suggestions) || rawObj.suggestions.length === 0) {
    return { valid: false, error: 'No suggestions in response' };
  }

  // Repair each suggestion rather than silently defaulting
  const today = new Date().toISOString().split('T')[0];
  const repairedSuggestions: AISuggestion[] = [];

  for (const s of rawObj.suggestions) {
    const sObj = s as Record<string, unknown>;
    if (!sObj || typeof sObj.title !== 'string' || !(sObj.title as string).trim()) continue;

    // Repair type
    const validTypes = ['todo', 'event', 'timeBlock'];
    const type = validTypes.includes(sObj.type as string) ? sObj.type as 'todo' | 'event' | 'timeBlock' : 'todo';

    // Repair priority
    const priority = normalizePriority(sObj.priority);

    // Repair dates — try multiple common formats the model produces
    let startsAt = sObj.startsAt as string | undefined;
    if (startsAt && isNaN(new Date(startsAt).getTime())) {
      // Try to parse natural language the model snuck in
      const parsed = new Date(startsAt);
      startsAt = isNaN(parsed.getTime())
        ? new Date().toISOString()
        : parsed.toISOString();
    }

    // Repair timeBlock times — accept "9am", "9:00am", "09:00", "9"
    let startTime = (sObj.startTime as string) || '09:00';
    let endTime = (sObj.endTime as string) || '10:00';

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
      title: (sObj.title as string).trim(),
      priority,
      cognitiveLoad: normalizeCognitiveLoad(sObj.cognitiveLoad),
      notes: typeof sObj.notes === 'string' ? sObj.notes.trim() : undefined,
      dueAt: sObj.dueAt ? (isNaN(new Date(sObj.dueAt as string).getTime()) ? null : new Date(sObj.dueAt as string).toISOString()) : null,
      startsAt: startsAt || new Date().toISOString(),
      allDay: Boolean(sObj.allDay),
      date: /^\d{4}-\d{2}-\d{2}$/.test(sObj.date as string) ? sObj.date as string : today,
      startTime,
      endTime,
      autoTrack: sObj.autoTrack !== false,
    });
  }

  if (repairedSuggestions.length === 0) {
    return { valid: false, error: 'All suggestions were malformed' };
  }

  return {
    valid: true,
    result: {
      summary: typeof rawObj.summary === 'string' ? rawObj.summary : 'Actions created.',
      severity: normalizeSeverity(rawObj.severity),
      urgencyHours: Number.isFinite(Number(rawObj.urgencyHours)) ? Number(rawObj.urgencyHours) : null,
      confidence: Math.max(0, Math.min(1, Number(rawObj.confidence) || 0.7)),
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

  const todoTitles = context.todoTitles.join(' | ') || 'none';
  const eventTitles = context.upcomingEventTitles.join(' | ') || 'none';
  const goalTitles = context.activeGoals || 'none';

  const userPrompt = [
    `User request: ${prompt.trim()}`,
    `Current date-time: ${localISO} (${dayName})`,
    `Timezone: ${tz} (UTC${offsetStr})`,
    `Today todos: ${todoTitles}`,
    `Upcoming events: ${eventTitles}`,
    `Active goals: ${goalTitles}`,
    ``,
    `Generate suggestions now.`,
  ].join('\n');

  const parseResponseOrThrow = (body: unknown): AIAssistantResult => {
    const bodyAny = body as { choices?: Array<{ message?: { content?: string } }>; generated_text?: string } | Array<{ generated_text?: string }> | null;
    const textResponse =
      Array.isArray(bodyAny)
        ? (bodyAny[0]?.generated_text || '')
        : ((bodyAny as { choices?: Array<{ message?: { content?: string } }> })?.choices?.[0]?.message?.content ||
           (bodyAny as { generated_text?: string })?.generated_text || '');

    if (!textResponse || textResponse.trim().length === 0) {
      const error = new Error('AI returned an empty response. Check your API key and try again.');
      (error as Error & { code?: string }).code = 'EMPTY_RESPONSE';
      throw error;
    }

    const suggestions = parseTaggedSuggestions(textResponse);
    if (suggestions.length === 0) {
      const error = new Error('AI returned no actionable suggestions.');
      (error as Error & { code?: string }).code = 'NO_SUGGESTIONS';
      throw error;
    }

    return {
      summary: 'Actions created.',
      severity: 'medium',
      urgencyHours: null,
      confidence: 0.85,
      suggestions,
    };
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

  /** Returns true for errors that should be retried (empty/no suggestions).
   *  Returns false for errors that must surface immediately (auth, rate limit, network). */
  const isRetryable = (err: unknown): boolean => {
    const code = (err as Error & { code?: string }).code;
    return code === 'EMPTY_RESPONSE' || code === 'NO_SUGGESTIONS';
  };

  const attemptDescriptions: string[] = [];

  // Attempt 1 — full system prompt with mode directive and 3 examples
  try {
    return await runRequest(systemPrompt, userPrompt);
  } catch (err1) {
    if (!isRetryable(err1)) throw err1;
    attemptDescriptions.push(`attempt 1 (full prompt): ${(err1 as Error).message}`);
  }

  // Attempt 2 — short system prompt (format rules + 1 example), simple user prompt
  await sleep(1000);
  const shortUserPrompt = [
    `User request: ${prompt.trim()}`,
    `Current date-time: ${localISO} (${dayName})`,
    `Timezone: ${tz} (UTC${offsetStr})`,
    ``,
    `Generate suggestions now.`,
  ].join('\n');
  try {
    return await runRequest(buildShortSystemPrompt(), shortUserPrompt);
  } catch (err2) {
    if (!isRetryable(err2)) throw err2;
    attemptDescriptions.push(`attempt 2 (short prompt): ${(err2 as Error).message}`);
  }

  // Attempt 3 — minimal system prompt, bare user input
  await sleep(2000);
  const minimalUserPrompt = `User request: ${prompt.trim()}\n\nGenerate suggestions now.`;
  try {
    return await runRequest(buildMinimalSystemPrompt(), minimalUserPrompt);
  } catch (err3) {
    if (!isRetryable(err3)) throw err3;
    attemptDescriptions.push(`attempt 3 (minimal prompt): ${(err3 as Error).message}`);
  }

  throw new Error(`AI failed after 3 attempts. ${attemptDescriptions.join('; ')}`);
}
