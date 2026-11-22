import { config } from '../config.js';
import { ProviderError } from './errors.js';

export interface GeminiPart {
  text?: string;
  inlineData?: { mimeType: string; data: string };
  inline_data?: { mime_type: string; data: string };
}

export interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: GeminiPart[]; role?: string };
    finishReason?: string;
  }>;
  error?: { code?: number; message?: string; status?: string };
  groundingMetadata?: {
    groundingChunks?: Array<{ web?: { uri?: string; title?: string } }>;
    searchEntryPoint?: unknown;
  };
}

export async function geminiGenerateContent(
  model: string,
  body: Record<string, unknown>,
): Promise<GeminiResponse> {
  if (!config.geminiApiKey) {
    throw new ProviderError(503, 'provider-not-configured', 'Google Gemini is not configured. Set GEMINI_API_KEY on the backend.');
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.geminiApiKey },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(90_000),
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new ProviderError(504, 'gemini-timeout', 'Gemini did not respond within 90 seconds. Try again.');
    }
    throw new ProviderError(502, 'gemini-unreachable', 'Could not reach the Gemini API. Check the network connection.');
  }

  const payload = (await response.json().catch(() => ({}))) as GeminiResponse;

  if (!response.ok) {
    const detail = payload.error?.message ?? '';
    const code = payload.error?.status ?? '';
    throw new ProviderError(
      response.status,
      'gemini-provider-error',
      `Gemini request failed with status ${response.status}${code ? ` (${code})` : ''}${detail ? `: ${detail.slice(0, 300)}` : ''}`,
    );
  }

  return payload;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function isRetryable(error: unknown): boolean {
  if (!(error instanceof ProviderError)) return false;
  if (error.status === 401 || error.status === 403) return false;
  return (
    error.status === 404 ||
    error.status === 429 ||
    error.status >= 500 ||
    error.code === 'gemini-timeout' ||
    error.code === 'gemini-unreachable'
  );
}

/**
 * Calls Gemini with automatic retry and model fallback.
 * Retries transient failures (429/5xx/timeouts) once per model, then walks
 * the fallback model list. Auth errors (401/403) fail immediately.
 */
export async function geminiGenerateContentResilient(
  model: string,
  body: Record<string, unknown>,
  fallbacks: string[] = [],
): Promise<GeminiResponse> {
  const models = [model, ...fallbacks.filter((name) => name && name !== model)];
  let lastError: unknown = null;

  for (const candidate of models) {
    const attempts = candidate === model ? 2 : 1;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        return await geminiGenerateContent(candidate, body);
      } catch (error) {
        lastError = error;
        if (error instanceof ProviderError && (error.status === 401 || error.status === 403)) {
          throw error;
        }
        if (!isRetryable(error) || (error instanceof ProviderError && error.status === 404)) break;
        if (attempt + 1 < attempts) {
          await sleep(1200 + attempt * 1500);
        }
      }
    }
  }

  if (lastError instanceof ProviderError) {
    throw new ProviderError(
      lastError.status >= 500 || lastError.status === 429 ? 503 : lastError.status,
      'gemini-overloaded',
      'The AI service is busy right now. NEXUS will keep retrying automatically — please try again in a moment.',
    );
  }
  throw lastError;
}

/**
 * Streams Gemini generateContent (SSE). Yields text deltas as they arrive.
 * Throws ProviderError for HTTP/transport failures before or during the stream.
 */
export async function* geminiStreamGenerateContent(
  model: string,
  body: Record<string, unknown>,
): AsyncGenerator<string> {
  if (!config.geminiApiKey) {
    throw new ProviderError(503, 'provider-not-configured', 'Google Gemini is not configured. Set GEMINI_API_KEY on the backend.');
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.geminiApiKey },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(180_000),
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new ProviderError(504, 'gemini-timeout', 'Gemini did not respond within 180 seconds. Try again.');
    }
    throw new ProviderError(502, 'gemini-unreachable', 'Could not reach the Gemini API. Check the network connection.');
  }

  if (!response.ok || !response.body) {
    const payload = (await response.json().catch(() => ({}))) as GeminiResponse;
    const detail = payload.error?.message ?? '';
    const code = payload.error?.status ?? '';
    throw new ProviderError(
      response.status,
      'gemini-provider-error',
      `Gemini request failed with status ${response.status}${code ? ` (${code})` : ''}${detail ? `: ${detail.slice(0, 300)}` : ''}`,
    );
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const processBlock = function* (block: string): Generator<string> {
    for (const line of block.split(/\r?\n/)) {
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      try {
        const parsed = JSON.parse(data) as GeminiResponse;
        const parts = parsed.candidates?.[0]?.content?.parts ?? [];
        for (const part of parts) {
          if (part.text) yield part.text;
        }
      } catch {
        // Skip malformed SSE payloads.
      }
    }
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split(/\r?\n\r?\n/);
      buffer = events.pop() ?? '';
      for (const event of events) {
        yield* processBlock(event);
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) {
      yield* processBlock(buffer);
    }
  } finally {
    reader.releaseLock();
  }
}

export function firstTextPart(payload: GeminiResponse): string | null {
  const parts = payload.candidates?.[0]?.content?.parts ?? [];
  for (const part of parts) {
    if (part.text?.trim()) return part.text;
  }
  return null;
}

export function firstInlineData(payload: GeminiResponse): { mimeType: string; data: string } | null {
  const parts = payload.candidates?.[0]?.content?.parts ?? [];
  for (const part of parts) {
    const inline = part.inlineData ?? (part.inline_data ? { mimeType: part.inline_data.mime_type, data: part.inline_data.data } : undefined);
    if (inline?.data) return inline;
  }
  return null;
}
