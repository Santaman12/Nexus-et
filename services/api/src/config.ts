import 'dotenv/config';

export const config = {
  port: Number(process.env.PORT ?? 3001),
  jwtSecret: process.env.JWT_SECRET ?? 'nexus-development-secret-change-me',
  databasePath: process.env.DATABASE_PATH ?? './data/nexus.db',
  corsOrigins: (process.env.CORS_ORIGIN ?? 'http://localhost:3000')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  cloudMode: process.env.CLOUD_MODE === 'true' || process.platform !== 'win32',
  sttProvider: process.env.STT_PROVIDER ?? 'gemini',
  llmProvider: process.env.LLM_PROVIDER ?? 'gemini',
  ttsProvider: process.env.TTS_PROVIDER ?? 'gemini',
  openAiApiKey: process.env.OPENAI_API_KEY ?? '',
  openAiSttModel: process.env.OPENAI_STT_MODEL ?? 'whisper-1',
  openAiModel: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
  openAiTtsModel: process.env.OPENAI_TTS_MODEL ?? 'tts-1',
  openAiTtsVoice: process.env.OPENAI_TTS_VOICE ?? 'alloy',
  geminiApiKey: process.env.GEMINI_API_KEY ?? '',
  geminiModel: process.env.GEMINI_MODEL ?? 'gemini-3.5-flash-lite',
  geminiTtsModel: process.env.GEMINI_TTS_MODEL ?? 'gemini-3.8-flash-tts',
  geminiTtsVoice: process.env.GEMINI_TTS_VOICE ?? 'Fenrir',
  geminiModelFallbacks: (process.env.GEMINI_MODEL_FALLBACKS ?? 'gemini-3.5-flash,gemini-3.6-flash,gemini-3.1-flash-lite')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean),
  geminiTtsModelFallbacks: (process.env.GEMINI_TTS_MODEL_FALLBACKS ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean),
} as const;
