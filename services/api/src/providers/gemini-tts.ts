
import type {
  SpeechRequest,
  SynthesizedSpeech,
  TextToSpeechProvider,
} from '@nexus/core';

import { config } from '../config.js';
import { ProviderError } from './errors.js';
import {
  firstInlineData,
  geminiGenerateContentResilient,
} from './gemini-client.js';

// NEXUS fixed male voice
const NEXUS_MALE_VOICE = 'Fenrir';

function pcmToWav(
  pcm: Uint8Array,
  sampleRate: number,
): Uint8Array {
  const header = new ArrayBuffer(44);
  const view = new DataView(header);

  const writeString = (
    offset: number,
    value: string,
  ) => {
    for (let i = 0; i < value.length; i += 1) {
      view.setUint8(offset + i, value.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + pcm.length, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, pcm.length, true);

  const wav = new Uint8Array(44 + pcm.length);
  wav.set(new Uint8Array(header), 0);
  wav.set(pcm, 44);

  return wav;
}

export class GeminiTextToSpeechProvider
  implements TextToSpeechProvider
{
  readonly name = 'gemini-tts';

  async synthesize(
    request: SpeechRequest,
  ): Promise<SynthesizedSpeech> {
    if (!config.geminiApiKey) {
      throw new ProviderError(
        503,
        'provider-not-configured',
        'Text-to-speech is not configured. Set GEMINI_API_KEY on the backend.',
      );
    }

    const voice = NEXUS_MALE_VOICE;

    const style =
      request.rate && request.rate !== 1
        ? `Speak at ${request.rate}x pace. `
        : '';

    const payload =
      await geminiGenerateContentResilient(
        config.geminiTtsModel,
        {
          contents: [
            {
              role: 'user',
              parts: [
                {
                  text: `${style}${request.text}`,
                },
              ],
            },
          ],
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: {
                  voiceName: voice,
                },
              },
            },
          },
        },
        config.geminiTtsModelFallbacks,
      );

    const inline = firstInlineData(payload);

    if (!inline?.data) {
      throw new ProviderError(
        502,
        'empty-speech',
        'Text-to-speech returned no audio.',
      );
    }

    const audio = new Uint8Array(
      Buffer.from(inline.data, 'base64'),
    );

    const mimeType = inline.mimeType ?? '';

    const rateMatch = /rate=(\d+)/i.exec(mimeType);
    const sampleRate = rateMatch
      ? Number(rateMatch[1])
      : 24000;

    if (/wav|mpeg|mp3|ogg/i.test(mimeType)) {
      return {
        audio,
        mimeType,
      };
    }

    return {
      audio: pcmToWav(audio, sampleRate),
      mimeType: 'audio/wav',
    };
  }
}
