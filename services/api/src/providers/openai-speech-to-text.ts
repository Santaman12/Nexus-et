import type { AudioInput, SpeechToTextProvider, TranscriptionResult } from '@nexus/core';
import { config } from '../config.js';
import { ProviderError } from './errors.js';

export class OpenAiSpeechToTextProvider implements SpeechToTextProvider {
  readonly name = 'openai-whisper';

  async transcribe(input: AudioInput): Promise<TranscriptionResult> {
    if (!config.openAiApiKey) {
      throw new ProviderError(503, 'provider-not-configured', 'Speech-to-text is not configured. Set OPENAI_API_KEY on the backend.');
    }

    const form = new FormData();
    form.append('file', new Blob([input.data], { type: input.mimeType }), input.filename);
    form.append('model', config.openAiSttModel);
    form.append('response_format', 'verbose_json');
    if (input.languageHint) {
      form.append('language', input.languageHint.split('-')[0]);
    }

    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.openAiApiKey}` },
      body: form,
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new ProviderError(response.status, 'stt-provider-error', `Speech-to-text provider failed with status ${response.status}${detail ? `: ${detail.slice(0, 300)}` : ''}`);
    }

    const payload = (await response.json()) as {
      text?: string;
      language?: string;
      duration?: number;
    };

    if (!payload.text?.trim()) {
      throw new ProviderError(422, 'empty-transcript', 'Speech-to-text returned an empty transcript.');
    }

    return {
      text: payload.text.trim(),
      language: payload.language ?? input.languageHint ?? 'und',
      durationMs: payload.duration ? Math.round(payload.duration * 1000) : undefined,
    };
  }
}
