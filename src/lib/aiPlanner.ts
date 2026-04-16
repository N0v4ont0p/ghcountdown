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
export const DEFAULT_HUGGING_FACE_MODEL = 'google/gemma-4-26b-it';
const ENV_HUGGING_FACE_MODEL = import.meta.env.VITE_HUGGINGFACE_MODEL || DEFAULT_HUGGING_FACE_MODEL;
const CHAT_COMPLETIONS_URL = 'https://api-inference.huggingface.co/v1/chat/completions';

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

export async function generateActionPlan(prompt: string, context: AIContext): Promise<AIAssistantResult> {
  const config = getAIConfiguration();

  if (!config.apiKey) {
    throw new Error('AI is not configured. Add your Hugging Face API key in-app or via VITE_HUGGINGFACE_API_KEY.');
  }

  const systemPrompt = [
    'You are GHCountdown Action AI.',
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

  const userPrompt = [
    `Current date-time: ${new Date().toISOString()}`,
    `Existing todos: ${context.todoTitles.join(' | ') || 'none'}`,
    `Upcoming events: ${context.upcomingEventTitles.join(' | ') || 'none'}`,
    `Recent timeline blocks: ${context.recentBlockTitles.join(' | ') || 'none'}`,
    'User request:',
    prompt,
  ].join('\n');

  const response = await fetch(CHAT_COMPLETIONS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      temperature: 0.25,
      max_tokens: 1000,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    }),
  });

  if (!response.ok) {
    let message = `AI request failed (${response.status})`;
    try {
      const body = await response.json();
      const detail = body?.error?.message || body?.error || body?.message;
      if (detail) message = `${message}: ${detail}`;
    } catch {
      // ignore JSON parse failures
    }
    throw new Error(message);
  }

  const body = await response.json();
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
