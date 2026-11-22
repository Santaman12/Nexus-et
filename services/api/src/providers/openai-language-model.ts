import { randomUUID } from 'node:crypto';
import type {
  AssistantRequest,
  AssistantResult,
  LanguageModelProvider,
} from '@nexus/core';
import { config } from '../config.js';
import { ProviderError } from './errors.js';

const SYSTEM_PROMPT = `You are NEXUS, a voice-first personal assistant.
Answer the user's spoken request naturally and concisely so it can be spoken aloud.
Detect the language of the transcript and answer in that language unless the user explicitly asks for another language.
Support code-switching. If you cannot answer truthfully, say so honestly.
Return ONLY JSON with this shape:
{"answer":"spoken response","language":"BCP-47 language code","displayPayload":null}
Optional displayPayload kinds: text, list, table, weather, news, search, media, code, image, map.
Do not include markdown in the spoken answer. Use displayPayload for structured visual content when appropriate.`;

export class OpenAiLanguageModelProvider implements LanguageModelProvider {
  readonly name = 'openai-chat';

  async respond(request: AssistantRequest): Promise<AssistantResult> {
    if (!config.openAiApiKey) {
      throw new ProviderError(503, 'provider-not-configured', 'The language model is not configured. Set OPENAI_API_KEY on the backend.');
    }

    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...(request.history ?? []).slice(-12),
      {
        role: 'user',
        content: `Transcript: ${request.transcript}\nDetected or requested language: ${request.language ?? 'auto'}\nSession: ${request.sessionId ?? 'new'}`,
      },
    ];

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.openAiApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: config.openAiModel,
        messages,
        temperature: 0.7,
        max_tokens: 900,
        response_format: { type: 'json_object' },
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new ProviderError(response.status, 'llm-provider-error', `Language model provider failed with status ${response.status}${detail ? `: ${detail.slice(0, 300)}` : ''}`);
    }

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) {
      throw new ProviderError(502, 'empty-model-response', 'Language model returned an empty response.');
    }

    let parsed: {
      answer?: string;
      language?: string;
      displayPayload?: AssistantResult['displayPayload'];
      actions?: AssistantResult['actions'];
    };

    try {
      parsed = JSON.parse(content) as typeof parsed;
    } catch {
      parsed = { answer: content };
    }

    const answer = parsed.answer?.trim();
    if (!answer) {
      throw new ProviderError(502, 'invalid-model-response', 'Language model response did not contain an answer.');
    }

    return {
      answer,
      language: parsed.language ?? request.language ?? 'und',
      sessionId: request.sessionId ?? randomUUID(),
      displayPayload: parsed.displayPayload ?? undefined,
      actions: parsed.actions ?? undefined,
    };
  }
}
