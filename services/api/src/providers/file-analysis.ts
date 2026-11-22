import { randomUUID } from 'node:crypto';
import type { AssistantResult } from '@nexus/core';
import { config } from '../config.js';
import { ProviderError } from './errors.js';
import { firstTextPart, geminiGenerateContentResilient, geminiStreamGenerateContent } from './gemini-client.js';

export interface FileAnalysisInput {
  filename: string;
  mimeType: string;
  data: Uint8Array;
  instruction?: string;
  language?: string;
  sessionId?: string;
}

const TEXT_EXTENSIONS = new Set([
  '.txt', '.md', '.markdown', '.csv', '.tsv', '.json', '.jsonl', '.xml', '.yaml', '.yml', '.toml', '.ini', '.log',
  '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.py', '.java', '.c', '.h', '.cpp', '.hpp', '.cs', '.go', '.rs',
  '.rb', '.php', '.swift', '.kt', '.sql', '.sh', '.ps1', '.bat', '.html', '.css', '.env.example',
]);

const MAX_TEXT_CHARS = 120_000;

function extensionOf(filename: string): string {
  const lower = filename.toLowerCase();
  const dot = lower.lastIndexOf('.');
  return dot >= 0 ? lower.slice(dot) : '';
}

function looksLikeText(data: Uint8Array): boolean {
  const sample = data.subarray(0, Math.min(data.length, 4096));
  let suspicious = 0;
  for (const byte of sample) {
    if (byte === 0) return false;
    if (byte < 9 || (byte > 13 && byte < 32)) suspicious += 1;
  }
  return suspicious / Math.max(sample.length, 1) < 0.05;
}

export function classifyFile(filename: string, mimeType: string, data: Uint8Array):
  | { kind: 'image' | 'pdf' | 'text'; text?: string }
  | { kind: 'unsupported'; reason: string } {
  if (mimeType.startsWith('image/')) return { kind: 'image' };
  if (mimeType === 'application/pdf') return { kind: 'pdf' };

  const ext = extensionOf(filename);
  const textualMime = mimeType.startsWith('text/') || mimeType === 'application/json' || mimeType.endsWith('+json') || mimeType.endsWith('+xml');
  if (TEXT_EXTENSIONS.has(ext) || textualMime) {
    const text = new TextDecoder('utf-8', { fatal: false }).decode(data);
    return { kind: 'text', text: text.slice(0, MAX_TEXT_CHARS) };
  }
  if (looksLikeText(data) && data.length > 0) {
    const text = new TextDecoder('utf-8', { fatal: false }).decode(data);
    return { kind: 'text', text: text.slice(0, MAX_TEXT_CHARS) };
  }
  return { kind: 'unsupported', reason: `Unsupported file type (${mimeType || 'unknown'}). Upload an image, PDF, or text/code file.` };
}

const ANALYSIS_PROMPT = `You are NEXUS, a voice-first assistant. The user uploaded a file for you to inspect.
User instruction: {INSTRUCTION}
File name: {FILENAME}
For IMAGES: read and transcribe ALL visible text verbatim — printed text, handwriting, notes, code, quiz/exam questions and answer choices, error messages, signs, labels. Also describe visual details accurately: objects, people, diagrams, charts, layouts, colors. If the image contains an exam/quiz/test, answer EVERY question completely and correctly. If it contains an error message or buggy code screenshot, explain the error and its cause.
For TEXT/CODE FILES: analyze the content fully; if it contains errors (bugs, syntax errors, typos, broken logic) or the user asks you to fix it, identify them precisely.
For EXAMS/QUIZZES (in images or files): solve every question internally and present ONLY the numbered final answers ("1. …", "2. …") with brief direct explanations only where needed — never repeat or read back the question text.
In "answer" (spoken aloud), summarize what you found and answer the user's request concisely so it can be spoken — for exams this means the numbered answers directly.
In "correctedContent", output the complete corrected file content when a fix is needed (for images, omit or null). Otherwise omit or set null.
Return ONLY JSON: {"answer":"spoken response","language":"BCP-47 code","correctedContent":"full corrected file or null"}`;

const STREAM_PROMPT = `You are NEXUS, a voice-first assistant. The user uploaded a file for you to inspect.
User instruction: {INSTRUCTION}
File name: {FILENAME}
For IMAGES: read and transcribe ALL visible text verbatim — printed text, handwriting, notes, code, quiz/exam questions and answer choices, error messages, signs, labels. Also describe visual details accurately: objects, people, diagrams, charts, layouts, colors. If the image contains an exam/quiz/test, answer EVERY question completely and correctly. If it contains an error message or buggy code screenshot, explain the error and its cause.
For TEXT/CODE FILES: analyze the content fully; if it contains errors (bugs, syntax errors, typos, broken logic) or the user asks you to fix it, identify them precisely.
For EXAMS/QUIZZES (in images or files): solve every question internally and present ONLY the numbered final answers ("1. …", "2. …") with brief direct explanations only where needed — never repeat or read back the question text.
OUTPUT FORMAT — follow exactly:
1. First, write the complete spoken answer as plain readable text (no JSON, no markdown). This is what the user hears and sees typed live.
2. Then, on a new line, write exactly: <<<META>>>
3. After the marker, write ONE JSON object: {"language":"BCP-47 code","correctedContent":"full corrected file content or null"}
Do not put the answer inside the JSON. Do not add any text after the JSON.`;

const META_MARKER = '<<<META>>>';

function visibleStreamText(accumulated: string): string {
  const idx = accumulated.indexOf(META_MARKER);
  return (idx >= 0 ? accumulated.slice(0, idx) : accumulated).trimEnd();
}

function parseStreamResult(accumulated: string, input: FileAnalysisInput) {
  const idx = accumulated.indexOf(META_MARKER);
  const answer = (idx >= 0 ? accumulated.slice(0, idx) : accumulated).trim();
  let language: string | undefined;
  let correctedContent: string | null | undefined;
  if (idx >= 0) {
    try {
      const meta = JSON.parse(accumulated.slice(idx + META_MARKER.length).trim()) as {
        language?: string;
        correctedContent?: string | null;
      };
      language = meta.language;
      correctedContent = typeof meta.correctedContent === 'string' && meta.correctedContent.trim() ? meta.correctedContent : undefined;
    } catch {
      // Meta parse failure: keep the spoken answer, drop metadata.
    }
  }
  if (!answer) {
    throw new ProviderError(502, 'invalid-model-response', 'File analysis did not contain an answer.');
  }
  return {
    answer,
    language: language ?? input.language ?? 'und',
    sessionId: input.sessionId ?? randomUUID(),
    correctedContent,
    filename: input.filename,
  };
}

function prepareAnalysis(input: FileAnalysisInput, promptTemplate: string = ANALYSIS_PROMPT): { parts: Array<Record<string, unknown>> } {
  const classified = classifyFile(input.filename, input.mimeType, input.data);
  if (classified.kind === 'unsupported') {
    throw new ProviderError(415, 'unsupported-file', classified.reason);
  }

  const instruction = input.instruction?.trim() || 'Inspect this file and tell me what it contains. If it has errors, explain them and provide the corrected version.';
  const prompt = promptTemplate
    .replace('{INSTRUCTION}', instruction)
    .replace('{FILENAME}', input.filename);

  if (classified.kind === 'text') {
    return { parts: [{ text: `${prompt}\n\nFILE CONTENT:\n\`\`\`\n${classified.text}\n\`\`\`` }] };
  }
  return {
    parts: [
      {
        inlineData: {
          mimeType: input.mimeType,
          data: Buffer.from(input.data).toString('base64'),
        },
      },
      { text: prompt },
    ],
  };
}

function parseAnalysisJson(content: string): { answer?: string; language?: string; correctedContent?: string | null } {
  try {
    return JSON.parse(content) as { answer?: string; language?: string; correctedContent?: string | null };
  } catch {
    return { answer: content };
  }
}

function toResult(
  parsed: { answer?: string; language?: string; correctedContent?: string | null },
  input: FileAnalysisInput,
): AssistantResult & { correctedContent?: string | null; filename: string } {
  const answer = parsed.answer?.trim();
  if (!answer) {
    throw new ProviderError(502, 'invalid-model-response', 'File analysis did not contain an answer.');
  }
  return {
    answer,
    language: parsed.language ?? input.language ?? 'und',
    sessionId: input.sessionId ?? randomUUID(),
    correctedContent: typeof parsed.correctedContent === 'string' && parsed.correctedContent.trim() ? parsed.correctedContent : undefined,
    filename: input.filename,
  };
}

export async function analyzeFile(input: FileAnalysisInput): Promise<AssistantResult & { correctedContent?: string | null; filename: string }> {
  if (!config.geminiApiKey) {
    throw new ProviderError(503, 'provider-not-configured', 'File analysis is not configured. Set GEMINI_API_KEY on the backend.');
  }

  const { parts } = prepareAnalysis(input);
  const payload = await geminiGenerateContentResilient(config.geminiModel, {
    contents: [{ role: 'user', parts }],
    generationConfig: {
      temperature: 0.4,
      maxOutputTokens: 8192,
      responseMimeType: 'application/json',
    },
  }, config.geminiModelFallbacks);

  const content = firstTextPart(payload);
  if (!content) {
    throw new ProviderError(502, 'empty-model-response', 'File analysis returned an empty response.');
  }
  return toResult(parseAnalysisJson(content), input);
}

/**
 * Streaming variant: yields the raw model text incrementally via onToken
 * (the JSON contract text), then resolves with the parsed result.
 * Falls back across models only if the stream fails before the first token.
 */
export async function analyzeFileStream(
  input: FileAnalysisInput,
  onToken: (delta: string, accumulated: string) => void,
): Promise<AssistantResult & { correctedContent?: string | null; filename: string }> {
  if (!config.geminiApiKey) {
    throw new ProviderError(503, 'provider-not-configured', 'File analysis is not configured. Set GEMINI_API_KEY on the backend.');
  }

  const { parts } = prepareAnalysis(input, STREAM_PROMPT);
  const body = {
    contents: [{ role: 'user', parts }],
    generationConfig: {
      temperature: 0.4,
      maxOutputTokens: 8192,
    },
  };

  const models = [config.geminiModel, ...config.geminiModelFallbacks.filter((name) => name !== config.geminiModel)];
  let accumulated = '';
  let streamed = false;
  let lastError: unknown = null;

  for (const model of models) {
    try {
      for await (const delta of geminiStreamGenerateContent(model, body)) {
        streamed = true;
        accumulated += delta;
        onToken(visibleStreamText(accumulated), accumulated);
      }
      lastError = null;
      break;
    } catch (error) {
      lastError = error;
      if (streamed) throw error; // mid-stream failure: partial JSON is unusable
      accumulated = '';
    }
  }

  if (lastError) throw lastError;
  if (!accumulated.trim()) {
    throw new ProviderError(502, 'empty-model-response', 'File analysis returned an empty response.');
  }
  return parseStreamResult(accumulated, input);
}
