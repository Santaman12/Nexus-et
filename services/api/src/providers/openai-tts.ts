import type { SpeechRequest, SynthesizedSpeech, TextToSpeechProvider } from '@nexus/core';
import { config } from '../config.js';
import { ProviderError } from './errors.js';

export class OpenAiTextToSpeechProvider implements TextToSpeechProvider {
  readonly name = 'openai-tts';

  async synthesize(request: SpeechRequest): Promise<SynthesizedSpeech> {
    if (!config.openAiApiKey) {
      throw new ProviderError(503, 'provider-not-configured', 'Text-to-speech is not configured. Set OPENAI_API_KEY on the backend.');
    }

    const rate = Math.min(1.5, Math.max(0.25, request.rate ?? 1));
    const response = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.openAiApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: config.openAiTtsModel,
        input: request.text,
        voice: request.voice ?? config.openAiTtsVoice,
        response_format: 'mp3',
        speed: rate,
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new ProviderError(response.status, 'tts-provider-error', `Text-to-speech provider failed with status ${response.status}${detail ? `: ${detail.slice(0, 300)}` : ''}`);
    }

    return {
      audio: new Uint8Array(await response.arrayBuffer()),
      mimeType: response.headers.get('content-type') ?? 'audio/mpeg',
    };
  }
}
