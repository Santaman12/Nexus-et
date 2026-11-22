import type { LanguageModelProvider, SpeechToTextProvider, TextToSpeechProvider } from '@nexus/core';
import { config } from '../config.js';
import { ProviderError } from './errors.js';
import { GeminiLanguageModelProvider } from './gemini-language-model.js';
import { GeminiSpeechToTextProvider } from './gemini-speech-to-text.js';
import { GeminiTextToSpeechProvider } from './gemini-tts.js';
import { OpenAiLanguageModelProvider } from './openai-language-model.js';
import { OpenAiSpeechToTextProvider } from './openai-speech-to-text.js';
import { OpenAiTextToSpeechProvider } from './openai-tts.js';

export function getSpeechToTextProvider(): SpeechToTextProvider {
  switch (config.sttProvider) {
    case 'openai':
      return new OpenAiSpeechToTextProvider();
    case 'gemini':
      return new GeminiSpeechToTextProvider();
    default:
      throw new ProviderError(501, 'unsupported-provider', `Unsupported STT provider: ${config.sttProvider}`);
  }
}

export function getLanguageModelProvider(): LanguageModelProvider {
  switch (config.llmProvider) {
    case 'openai':
      return new OpenAiLanguageModelProvider();
    case 'gemini':
      return new GeminiLanguageModelProvider();
    default:
      throw new ProviderError(501, 'unsupported-provider', `Unsupported language-model provider: ${config.llmProvider}`);
  }
}

export function getTextToSpeechProvider(): TextToSpeechProvider {
  switch (config.ttsProvider) {
    case 'openai':
      return new OpenAiTextToSpeechProvider();
    case 'gemini':
      return new GeminiTextToSpeechProvider();
    default:
      throw new ProviderError(501, 'unsupported-provider', `Unsupported TTS provider: ${config.ttsProvider}`);
  }
}
