import { Router } from 'express';
import { config } from '../config.js';

function providerConfigured(provider: string): boolean {
  if (provider === 'openai') return Boolean(config.openAiApiKey);
  if (provider === 'gemini') return Boolean(config.geminiApiKey);
  return false;
}

export const healthRouter = Router();

healthRouter.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'nexus-api',
    deployment: config.cloudMode ? 'cloud' : 'desktop',
    providers: {
      stt: { provider: config.sttProvider, configured: providerConfigured(config.sttProvider) },
      llm: { provider: config.llmProvider, configured: providerConfigured(config.llmProvider) },
      tts: { provider: config.ttsProvider, configured: providerConfigured(config.ttsProvider) },
    },
  });
});
