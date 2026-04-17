export type AISeverity = 'low' | 'medium' | 'high' | 'critical';

export interface AISuggestion {
  id: string;
  type: 'todo' | 'event' | 'timeBlock';
  title: string;
  priority: 1 | 2 | 3 | 4 | 5;
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
}

const ENV_HUGGING_FACE_API_KEY = import.meta.env.VITE_HUGGINGFACE_API_KEY;
export const DEFAULT_HUGGING_FACE_MODEL = 'google/gemma-3-27b-it';
const ENV_HUGGING_FACE_MODEL = import.meta.env.VITE_HUGGINGFACE_MODEL || DEFAULT_HUGGING_FACE_MODEL;

const CHAT_COMPLETIONS_ENDPOINTS = [
  { buildUrl: () => 'https://router.huggingface.co/v1/chat/completions' },
];
const AUTH_FAILURE_CODES = new Set([401, 403]);
export type AIMode = 'plan' | 'agent';

/** A single entry in the curated model list. */
export interface PresetModel {
  /** Exact model identifier used in API calls. */
  id: string;
  /** Short display label. */
  label: string;
  /** Longer description shown in tooltips / sub-labels. */
  description: string;
  /** Approximate context window in tokens. */
  contextTokens?: number;
  /** Speed/quality tier: fast | balanced | quality */
  tier: 'fast' | 'balanced' | 'quality';
}

/**
 * Curated list of Hugging Face models that work well with the
 * chat-completions endpoint for structured JSON output.
 * Listed in recommended-first order.
 */
export const PRESET_MODELS: PresetModel[] = [
  {
    id: 'google/gemma-3-27b-it',
    label: 'Gemma 3 27B (Best Free)',
    description: 'Google Gemma 3 — 27B instruction-tuned, top free Gemma on HF router, 128k context, excellent JSON output (recommended)',
    contextTokens: 131072,
    tier: 'quality',
  },
  {
    id: 'google/gemma-3-27b-it',
    label: 'Gemma 3 27B',
    description: 'Google Gemma 3 — dense 27 B instruction-tuned, strong reasoning & structured output',
    contextTokens: 131072,
    tier: 'quality',
  },
  {
    id: 'google/gemma-3-12b-it',
    label: 'Gemma 3 12B',
    description: 'Google Gemma 3 — compact 12 B, good balance of speed and quality',
    contextTokens: 131072,
    tier: 'balanced',
  },
  {
    id: 'google/gemma-3-4b-it',
    label: 'Gemma 3 4B',
    description: 'Google Gemma 3 — lightweight 4 B, fastest Gemma option',
    contextTokens: 131072,
    tier: 'fast',
  },
  {
    id: 'mistralai/Mistral-7B-Instruct-v0.3',
    label: 'Mistral 7B Instruct v0.3',
    description: 'Mistral 7 B — fast, reliable, very good at following JSON schemas',
    contextTokens: 32768,
    tier: 'fast',
  },
  {
    id: 'mistralai/Mixtral-8x7B-Instruct-v0.1',
    label: 'Mixtral 8×7B Instruct',
    description: 'Mistral sparse MoE — 8×7 B, strong quality at moderate speed',
    contextTokens: 32768,
    tier: 'balanced',
  },
  {
    id: 'mistralai/Mistral-Nemo-Instruct-2407',
    label: 'Mistral NeMo 12B',
    description: 'Mistral × NVIDIA — 12 B, 128 k context, excellent structured generation',
    contextTokens: 128000,
    tier: 'balanced',
  },
  {
    id: 'meta-llama/Llama-3.3-70B-Instruct',
    label: 'Llama 3.3 70B Instruct',
    description: 'Meta Llama 3.3 — 70 B, top-tier reasoning, best for complex plans',
    contextTokens: 131072,
    tier: 'quality',
  },
  {
    id: 'meta-llama/Meta-Llama-3.1-8B-Instruct',
    label: 'Llama 3.1 8B Instruct',
    description: 'Meta Llama 3.1 — 8 B, snappy responses with solid JSON output',
    contextTokens: 131072,
    tier: 'fast',
  },
  {
    id: 'Qwen/Qwen2.5-72B-Instruct',
    label: 'Qwen 2.5 72B Instruct',
    description: 'Alibaba Qwen 2.5 — 72 B, excellent multilingual & code/JSON quality',
    contextTokens: 131072,
    tier: 'quality',
  },
  {
    id: 'Qwen/Qwen2.5-14B-Instruct',
    label: 'Qwen 2.5 14B Instruct',
    description: 'Alibaba Qwen 2.5 — 14 B, fast with great structured output',
    contextTokens: 131072,
    tier: 'balanced',
  },
  {
    id: 'microsoft/phi-4',
    label: 'Phi-4 14B',
    description: 'Microsoft Phi-4 — 14 B, punches above its weight for reasoning & JSON',
    contextTokens: 16384,
    tier: 'balanced',
  },
  {
    id: 'deepseek-ai/DeepSeek-V3-0324',
    label: 'DeepSeek V3',
    description: 'DeepSeek V3 — 671 B sparse MoE, top-tier quality for complex prompts',
    contextTokens: 131072,
    tier: 'quality',
  },
];

export const CUSTOM_MODEL_ID = '__custom__';

/** Returns true if the given model ID appears in the preset list. */
export function isPresetModel(modelId: string): boolean {
  return PRESET_MODELS.some((m) => m.id === modelId);
}

export interface AIConfiguration {
  apiKey: string;
  model: string;
}

let runtimeApiKey = ENV_HUGGING_FACE_API_KEY || '';
let runtimeModel = ENV_HUGGING_FACE_MODEL || DEFAULT_HUGGING_FACE_MODEL;

export function getAIConfiguration(): AIConfiguration {
  return {
    apiKey: runtimeApiKey,
    model: runtimeModel,
  };
}

export function updateAIConfiguration(config: Partial<AIConfiguration>) {
  if ('apiKey' in config) {
    runtimeApiKey = config.apiKey?.trim() || '';
  }
  if ('model' in config) {
    runtimeModel = config.model?.trim() || DEFAULT_HUGGING_FACE_MODEL;
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
    return safeJsonParse(trimmed.slice(firstCurly, lastCurly + 1));
  }

  return null;
}

function normalizeSuggestion(raw: any): AISuggestion | null {
  if (!raw || typeof raw !== 'object' || typeof raw.title !== 'string') return null;
  const type = raw.type === 'event' || raw.type === 'timeBlock' ? raw.type : 'todo';
  const now = new Date();
  const defaultDate = toIsoDate(now);
  const startTime = normalizeClockValue(raw.startTime, '09:00');
  const endTime = normalizeClockValue(raw.endTime, withOneHourAfter(startTime));
  const startsAt = toIsoDateTimeOrNull(raw.startsAt) || new Date(`${defaultDate}T${startTime}:00`).toISOString();

  return {
    id: crypto.randomUUID(),
    type,
    title: raw.title.trim(),
    priority: normalizePriority(raw.priority),
    notes: typeof raw.notes === 'string' ? raw.notes.trim() : undefined,
    dueAt: toIsoDateTimeOrNull(raw.dueAt),
    startsAt,
    allDay: Boolean(raw.allDay),
    date: typeof raw.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.date) ? raw.date : defaultDate,
    startTime,
    endTime,
    autoTrack: raw.autoTrack !== false,
  };
}

function normalizeAIResponse(raw: any): AIAssistantResult {
  const suggestionsRaw = Array.isArray(raw?.suggestions) ? raw.suggestions : [];
  const suggestions = suggestionsRaw
    .map((suggestion) => normalizeSuggestion(suggestion))
    .filter((suggestion): suggestion is AISuggestion => Boolean(suggestion));

  const confidenceValue = Number(raw?.confidence);
  const confidence = Number.isFinite(confidenceValue)
    ? Math.max(0, Math.min(1, confidenceValue))
    : 0.7;

  const urgencyValue = Number(raw?.urgencyHours);
  const urgencyHours = Number.isFinite(urgencyValue) && urgencyValue >= 0 ? Math.round(urgencyValue) : null;

  return {
    summary: typeof raw?.summary === 'string' && raw.summary.trim().length > 0
      ? raw.summary.trim()
      : 'Plan generated successfully.',
    severity: normalizeSeverity(raw?.severity),
    urgencyHours,
    confidence,
    suggestions,
  };
}

export function isAIConfigured() {
  return Boolean(getAIConfiguration().apiKey);
}

function buildSystemPrompt(mode: AIMode): string {
  const today = new Date().toISOString().split('T')[0];
  const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];

  const modeDirective = mode === 'agent'
    ? 'You are executing as an autonomous agent. Infer all details. Never ask questions.'
    : 'You are a planning assistant. Be concise.';

  return `You are GHCountdown Action AI. ${modeDirective}

CRITICAL OUTPUT RULE: Your entire response must be a single raw JSON object. 
No markdown. No code fences. No explanation. Start with { and end with }.

Today is ${today}.

VALID TYPES: "todo", "event", "timeBlock" — no other values are accepted.

FIELD RULES:
- type "todo": requires title, priority, optional dueAt (ISO datetime string)
- type "event": requires title, priority, startsAt (ISO datetime string like "${today}T18:00:00.000Z"), allDay (boolean)
- type "timeBlock": requires title, priority, date (YYYY-MM-DD like "${today}"), startTime (HH:mm like "09:00"), endTime (HH:mm like "11:00"), autoTrack (boolean)

EXAMPLE OF CORRECT OUTPUT (do not copy the content, only the structure):
{
  "summary": "Created a deep work block tomorrow morning and a review task.",
  "severity": "medium",
  "urgencyHours": 18,
  "confidence": 0.85,
  "suggestions": [
    {
      "type": "timeBlock",
      "title": "Deep Work: FTC Code Review",
      "priority": 4,
      "date": "${tomorrow}",
      "startTime": "09:00",
      "endTime": "11:00",
      "autoTrack": true,
      "notes": "Focus on autonomous routine"
    },
    {
      "type": "todo",
      "title": "Prepare autonomous routine test cases",
      "priority": 3,
      "dueAt": "${tomorrow}T23:59:00.000Z",
      "notes": ""
    },
    {
      "type": "event",
      "title": "Rowing Practice",
      "priority": 3,
      "startsAt": "${tomorrow}T18:00:00.000Z",
      "allDay": false,
      "notes": ""
    }
  ]
}

Now respond to the user request below with the same JSON structure.`;
}

function buildModelCandidates(requestedModel: string) {
  return [requestedModel?.trim() || DEFAULT_HUGGING_FACE_MODEL];
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
    model: params.model,
    temperature: 0.25,
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

  const userPrompt = [
    `Current date: ${new Date().toISOString().split('T')[0]}`,
    `Day of week: ${new Date().toLocaleDateString('en-US', {weekday:'long'})}`,
    `Current time: ${new Date().toLocaleTimeString('en-US', {hour:'2-digit',minute:'2-digit'})}`,
    `Existing todos: ${context.todoTitles.join(' | ') || 'none'}`,
    `Upcoming events: ${context.upcomingEventTitles.join(' | ') || 'none'}`,
    `Recent time blocks: ${context.recentBlockTitles.join(' | ') || 'none'}`,
    ``,
    `User request: ${prompt.trim()}`,
    ``,
    `REMINDER: Respond with raw JSON only. No markdown. No explanation.`,
  ].join('\n');

  const body = await requestWithFallback({
    apiKey: config.apiKey,
    model: config.model,
    systemPrompt,
    userPrompt,
  });
  const textResponse =
    body?.choices?.[0]?.message?.content ||
    body?.generated_text ||
    body?.[0]?.generated_text ||
    '';

  if (typeof textResponse !== 'string' || textResponse.trim().length === 0) {
    throw new Error('AI returned an empty response.');
  }

  const cleanedResponse = textResponse
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .replace(/^[^{]*/s, (match) => (match.includes('{') ? '' : match))
    .trim();

  const parsed = extractFirstJsonObject(cleanedResponse);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('AI response was not valid JSON.');
  }

  return normalizeAIResponse(parsed);
}
