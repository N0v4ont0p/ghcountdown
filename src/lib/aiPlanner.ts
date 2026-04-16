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
export const DEFAULT_HUGGING_FACE_MODEL = 'google/gemma-4-26B-A4B';
const ENV_HUGGING_FACE_MODEL = import.meta.env.VITE_HUGGINGFACE_MODEL || DEFAULT_HUGGING_FACE_MODEL;
const CHAT_COMPLETIONS_URLS = [
  'https://router.huggingface.co/v1/chat/completions',
  'https://api-inference.huggingface.co/v1/chat/completions',
];
const FALLBACK_HUGGING_FACE_MODELS = [
  'google/gemma-4-26b-it',
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
    id: 'google/gemma-4-26B-A4B',
    label: 'Gemma 4 26B (A4B)',
    description: 'Google Gemma 4 — 26 B sparse MoE, excellent instruction following & JSON output (recommended)',
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

function buildSystemPrompt(mode: AIMode) {
  const modeDirective = mode === 'agent'
    ? 'Use a natural, supportive tone in "summary" while still being concise and practical.'
    : 'Keep "summary" brief and operational.';

  return [
    'You are GHCountdown Action AI.',
    modeDirective,
    'Return strict JSON only with this shape:',
    '{',
    '  "summary": "short summary",',
    '  "severity": "low|medium|high|critical",',
    '  "urgencyHours": number|null,',
    '  "confidence": 0..1,',
    '  "suggestions": [',
    '    {',
    '      "type": "todo|event|timeBlock",',
    '      "title": "string",',
    '      "priority": 1..5,',
    '      "notes": "string optional",',
    '      "dueAt": "ISO date-time optional",',
    '      "startsAt": "ISO date-time optional",',
    '      "allDay": "boolean optional",',
    '      "date": "YYYY-MM-DD optional",',
    '      "startTime": "HH:mm optional",',
    '      "endTime": "HH:mm optional",',
    '      "autoTrack": "boolean optional"',
    '    }',
    '  ]',
    '}',
    'Infer priority and urgency. Keep suggestions practical and directly actionable.',
  ].join('\n');
}

async function parseErrorDetail(response: Response): Promise<string> {
  try {
    const body = await response.clone().json();
    const detail = body?.error?.message || body?.error || body?.message;
    if (typeof detail === 'string' && detail.trim()) return detail.trim();
  } catch {
    // ignore JSON parse failures
  }

  try {
    const text = await response.clone().text();
    if (text.trim()) return text.trim();
  } catch {
    // ignore text parse failures
  }

  return '';
}

function buildModelCandidates(requestedModel: string) {
  return Array.from(new Set([requestedModel, DEFAULT_HUGGING_FACE_MODEL, ...FALLBACK_HUGGING_FACE_MODELS]));
}

function formatAttemptError(status: number | null, endpoint: string, model: string, detail?: string) {
  const statusText = status === null ? 'network failure' : `HTTP ${status}`;
  const detailText = detail ? `: ${detail}` : '';
  return `${statusText} at ${endpoint} using model "${model}"${detailText}`;
}

async function requestWithFallback(params: {
  apiKey: string;
  model: string;
  systemPrompt: string;
  userPrompt: string;
}) {
  const modelCandidates = buildModelCandidates(params.model);
  const totalAttempts = CHAT_COMPLETIONS_URLS.length * modelCandidates.length;
  let attempts = 0;
  let finalError = 'AI request failed.';

  for (const endpoint of CHAT_COMPLETIONS_URLS) {
    for (const model of modelCandidates) {
      attempts += 1;
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${params.apiKey}`,
          },
          body: JSON.stringify({
            model,
            temperature: 0.25,
            max_tokens: 1000,
            messages: [
              { role: 'system', content: params.systemPrompt },
              { role: 'user', content: params.userPrompt },
            ],
          }),
        });

        if (response.ok) {
          return await response.json();
        }

        const detail = await parseErrorDetail(response);
        finalError = formatAttemptError(response.status, endpoint, model, detail);

        if (AUTH_FAILURE_CODES.has(response.status)) {
          throw new Error('Authentication failed. Check your Hugging Face key and permissions.');
        }
      } catch (error) {
        if (error instanceof Error && error.message.startsWith('Authentication failed')) {
          throw error;
        }
        const detail = error instanceof Error ? error.message : '';
        finalError = formatAttemptError(null, endpoint, model, detail);
      }
    }
  }

  throw new Error(`AI request failed after ${attempts} attempts across available endpoints/models. Last error: ${finalError}`);
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
    `Assistant mode: ${mode}`,
    `Current date-time: ${new Date().toISOString()}`,
    `Existing todos: ${context.todoTitles.join(' | ') || 'none'}`,
    `Upcoming events: ${context.upcomingEventTitles.join(' | ') || 'none'}`,
    `Recent timeline blocks: ${context.recentBlockTitles.join(' | ') || 'none'}`,
    'User request:',
    prompt,
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

  const parsed = extractFirstJsonObject(textResponse);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('AI response was not valid JSON.');
  }

  return normalizeAIResponse(parsed);
}
