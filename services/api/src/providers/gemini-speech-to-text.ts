import type { AudioInput, SpeechToTextProvider, TranscriptionResult } from '@nexus/core';
import { config } from '../config.js';
import { ProviderError } from './errors.js';
import { firstTextPart, geminiGenerateContentResilient } from './gemini-client.js';

const TRANSCRIPTION_PROMPT = `Transcribe the user's speech in this audio recording.
Return ONLY JSON: {"text":"exact transcript","language":"BCP-47 code of the spoken language"}.
If multiple languages are spoken, use the dominant language code and keep code-switched words in the transcript.
If there is no intelligible speech, return {"text":"","language":"und"}.`;

export class GeminiSpeechToTextProvider implements SpeechToTextProvider {
  readonly name = 'gemini-audio';

  async transcribe(input: AudioInput): Promise<TranscriptionResult> {
    if (!config.geminiApiKey) {
      throw new ProviderError(503, 'provider-not-configured', 'Speech-to-text is not configured. Set GEMINI_API_KEY on the backend.');
    }

    const payload = await geminiGenerateContentResilient(config.geminiModel, {
      contents: [
        {
          role: 'user',
          parts: [
            { text: TRANSCRIPTION_PROMPT },
            {
              inlineData: {
                mimeType: input.mimeType || 'audio/webm',
                data: Buffer.from(input.data).toString('base64'),
              },
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 1024,
        responseMimeType: 'application/json',
      },
    }, config.geminiModelFallbacks);

    const content = firstTextPart(payload);
    if (!content) {
      throw new ProviderError(502, 'empty-transcript', 'Speech-to-text returned an empty response.');
    }

    let parsed: { text?: string; language?: string };
    try {
      parsed = JSON.parse(content) as typeof parsed;
    } catch {
      parsed = { text: content };
    }

    const text = parsed.text?.trim();
    if (!text) {
      throw new ProviderError(422, 'empty-transcript', 'Speech-to-text returned an empty transcript.');
    }

    return {
      text,
      language: parsed.language ?? input.languageHint ?? 'und',
    };
  }
}
