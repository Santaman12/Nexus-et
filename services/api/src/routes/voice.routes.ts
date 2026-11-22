import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import type { AssistantAction } from '@nexus/core';
import { requireAuth } from '../auth/auth.middleware.js';
import { addMessage, ensureSession, getRecentMessages, getUserSetting, grantToolPermission, listToolPermissions, resetPermissionPrompts, revokeToolPermission, setUserSetting } from '../db.js';
import { analyzeFile, analyzeFileStream } from '../providers/file-analysis.js';
import { getLanguageModelProvider, getSpeechToTextProvider, getTextToSpeechProvider } from '../providers/index.js';
import { executeAction, getTool, toolCatalogForPrompt } from '../tools/registry.js';

export const voiceRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    if (file.mimetype.startsWith('audio/') || file.mimetype.startsWith('video/')) {
      callback(null, true);
    } else {
      callback(new Error('Only audio or video media uploads are accepted'));
    }
  },
});

const fileUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});

const pendingConfirmations = new Map<string, Array<{ action: AssistantAction; expiresAt: number }>>();
const PENDING_TTL_MS = 10 * 60 * 1000;

function pendingKey(userId: string, sessionId: string): string {
  return `${userId}:${sessionId}`;
}

function storePending(userId: string, sessionId: string, action: AssistantAction): void {
  const key = pendingKey(userId, sessionId);
  const list = (pendingConfirmations.get(key) ?? []).filter((entry) => entry.expiresAt > Date.now());
  const signature = `${action.tool}:${JSON.stringify(action.arguments ?? {})}`;
  const deduped = list.filter((entry) => `${entry.action.tool}:${JSON.stringify(entry.action.arguments ?? {})}` !== signature);
  deduped.push({ action, expiresAt: Date.now() + PENDING_TTL_MS });
  pendingConfirmations.set(key, deduped.slice(-5));
}

function takePending(userId: string, sessionId: string, tool: string): AssistantAction | undefined {
  const key = pendingKey(userId, sessionId);
  const list = (pendingConfirmations.get(key) ?? []).filter((entry) => entry.expiresAt > Date.now());
  const index = list.findIndex((entry) => entry.action.tool === tool);
  if (index < 0) {
    pendingConfirmations.set(key, list);
    return undefined;
  }
  const [entry] = list.splice(index, 1);
  pendingConfirmations.set(key, list);
  return entry?.action;
}

const asyncHandler =
  (fn: (req: any, res: any, next: any) => Promise<unknown>) =>
  (req: any, res: any, next: any) => {
    fn(req, res, next).catch(next);
  };

const chatSchema = z.object({
  transcript: z.string().min(1).max(4000),
  language: z.string().min(2).max(35).optional(),
  sessionId: z.string().min(1).max(100).optional(),
});

const ttsSchema = z.object({
  text: z.string().min(1).max(8000),
  language: z.string().min(2).max(35).optional(),
  voice: z.string().min(1).max(80).optional(),
  rate: z.number().min(0.25).max(2).optional(),
  volume: z.number().min(0).max(1).optional(),
});

voiceRouter.post('/stt', requireAuth, upload.single('audio'), asyncHandler(async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: 'missing-audio', message: 'Audio file is required' });
    return;
  }

  const languageHint = typeof req.body?.language === 'string' ? req.body.language : undefined;
  const result = await getSpeechToTextProvider().transcribe({
    data: new Uint8Array(req.file.buffer),
    filename: req.file.originalname || 'recording.webm',
    mimeType: req.file.mimetype || 'audio/webm',
    languageHint,
  });

  res.json(result);
}));

voiceRouter.post('/chat', requireAuth, asyncHandler(async (req, res) => {
  const input = chatSchema.parse(req.body);
  const userId = req.authUser!.id;
  const sessionId = ensureSession(userId, input.sessionId);
  const history = getRecentMessages(sessionId, 12);

  const webSearch = /\b(search|google|look\s?up|find out|latest news|news|weather|score|price of|near me|who is)\b/i.test(input.transcript);
  const result = await getLanguageModelProvider().respond({
    transcript: input.transcript,
    language: input.language,
    sessionId,
    history,
    toolCatalog: toolCatalogForPrompt(),
    webSearch,
  });

  const actionResults = [];
  const countedPromptTools = new Set<string>();
  let current = result;
  // Up to two tool rounds so chained actions work (e.g. find_files → open_file).
  for (let round = 0; round < 2; round += 1) {
    const seen = new Set<string>();
    const actions = (current.actions ?? []).filter((action) => {
      const signature = `${action.tool}:${JSON.stringify(action.arguments ?? {})}`;
      if (seen.has(signature)) return false;
      seen.add(signature);
      return true;
    });
    if (actions.length === 0) break;

    const roundResults = [];
    for (const action of actions) {
      const actionResult = await executeAction(action, {
        userId,
        sessionId,
        requestText: input.transcript,
        countedPromptTools,
      });
      if (actionResult.status === 'needs-confirmation') {
        storePending(userId, sessionId, action);
      }
      roundResults.push(actionResult);
    }
    actionResults.push(...roundResults);

    const followUp = await getLanguageModelProvider().respond({
      transcript: `${input.transcript}\n\nTool execution results so far (JSON): ${JSON.stringify(actionResults)}\n${
        round === 0
          ? 'If more tool calls are needed to finish the request (for example opening or reading a file found by find_files), return them in "actions"; otherwise give the final spoken answer now with "actions": [].'
          : 'Give the final spoken answer now, truthfully including the real results. Do not request tools — return "actions": [].'
      }`,
      language: input.language,
      sessionId,
      history,
      toolCatalog: toolCatalogForPrompt(),
      webSearch,
    });
    current = followUp;
  }
  result.answer = current.answer;
  result.language = current.language || result.language;
  result.displayPayload = current.displayPayload ?? result.displayPayload;
  if (actionResults.length > 0) {
    result.actionResults = actionResults;
  }

  addMessage({
    sessionId,
    userId,
    role: 'user',
    content: input.transcript,
    language: input.language,
  });
  addMessage({
    sessionId,
    userId,
    role: 'assistant',
    content: result.answer,
    language: result.language,
  });

  res.json(result);
}));

const fileSchema = z.object({
  instruction: z.string().max(2000).optional(),
  language: z.string().min(2).max(35).optional(),
  sessionId: z.string().min(1).max(100).optional(),
});

voiceRouter.post('/file', requireAuth, fileUpload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: 'missing-file', message: 'A file is required' });
    return;
  }
  const input = fileSchema.parse(req.body ?? {});
  const userId = req.authUser!.id;
  const sessionId = ensureSession(userId, input.sessionId);

  const result = await analyzeFile({
    filename: req.file.originalname || 'upload',
    mimeType: req.file.mimetype || 'application/octet-stream',
    data: new Uint8Array(req.file.buffer),
    instruction: input.instruction,
    language: input.language,
    sessionId,
  });

  addMessage({
    sessionId,
    userId,
    role: 'user',
    content: `[file: ${result.filename}] ${input.instruction ?? ''}`.trim(),
    language: input.language,
  });
  addMessage({
    sessionId,
    userId,
    role: 'assistant',
    content: result.answer,
    language: result.language,
  });

  res.json(result);
}));

voiceRouter.post('/file/stream', requireAuth, fileUpload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: 'missing-file', message: 'A file is required' });
    return;
  }
  const input = fileSchema.parse(req.body ?? {});
  const userId = req.authUser!.id;
  const sessionId = ensureSession(userId, input.sessionId);

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();

  const send = (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const result = await analyzeFileStream(
      {
        filename: req.file.originalname || 'upload',
        mimeType: req.file.mimetype || 'application/octet-stream',
        data: new Uint8Array(req.file.buffer),
        instruction: input.instruction,
        language: input.language,
        sessionId,
      },
      (visible) => send('token', { text: visible }),
    );

    addMessage({
      sessionId,
      userId,
      role: 'user',
      content: `[file: ${result.filename}] ${input.instruction ?? ''}`.trim(),
      language: input.language,
    });
    addMessage({
      sessionId,
      userId,
      role: 'assistant',
      content: result.answer,
      language: result.language,
    });

    send('done', { result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'File analysis failed';
    const status = error && typeof error === 'object' && 'status' in error ? (error as { status?: number }).status : 500;
    send('error', { status, message });
  } finally {
    res.end();
  }
}));

const confirmSchema = z.object({
  sessionId: z.string().min(1).max(100),
  tool: z.string().min(1).max(100),
});

voiceRouter.post('/confirm', requireAuth, asyncHandler(async (req, res) => {
  const input = confirmSchema.parse(req.body);
  const userId = req.authUser!.id;
  const sessionId = ensureSession(userId, input.sessionId);
  const action = takePending(userId, sessionId, input.tool);
  if (!action) {
    res.status(409).json({ error: 'no-pending-action', message: 'There is no pending action awaiting confirmation for that tool.' });
    return;
  }

  const actionResult = await executeAction(action, {
    userId,
    sessionId,
    requestText: `User confirmed: ${action.tool}`,
    confirmed: true,
  });
  if (actionResult.status === 'completed') {
    grantToolPermission(userId, action.tool);
  }

  const llm = getLanguageModelProvider();
  const followUp = await llm.respond({
    transcript: `The user explicitly confirmed the pending action. Tool execution result (JSON): ${JSON.stringify(actionResult)}. Give the final spoken answer now, truthfully including the real result. Do not request tools again — return "actions": [].`,
    sessionId,
    toolCatalog: toolCatalogForPrompt(),
  });

  const result = {
    answer: followUp.answer,
    language: followUp.language,
    sessionId,
    actionResults: [actionResult],
  };

  addMessage({ sessionId, userId, role: 'assistant', content: result.answer, language: result.language });
  res.json(result);
}));

const appSettingsSchema = z.object({
  showHeardCaption: z.boolean(),
  voiceRate: z.number().min(0.5).max(1.5),
  voiceVolume: z.number().min(0).max(1),
  handsFree: z.boolean(),
  wakeWord: z.boolean(),
  mediaControl: z.boolean(),
  screenContext: z.boolean(),
});

voiceRouter.get('/settings', requireAuth, asyncHandler(async (req, res) => {
  const raw = getUserSetting(req.authUser!.id, 'app');
  res.json({ settings: raw ? JSON.parse(raw) : null });
}));

voiceRouter.put('/settings', requireAuth, asyncHandler(async (req, res) => {
  const settings = appSettingsSchema.parse(req.body);
  setUserSetting(req.authUser!.id, 'app', JSON.stringify(settings));
  res.json({ settings });
}));

voiceRouter.get('/permissions', requireAuth, asyncHandler(async (req, res) => {
  res.json({ permissions: listToolPermissions(req.authUser!.id) });
}));

const permissionActionSchema = z.object({
  tool: z.string().min(1).max(100),
  action: z.enum(['grant', 'revoke', 'reset']),
});

voiceRouter.post('/permissions', requireAuth, asyncHandler(async (req, res) => {
  const input = permissionActionSchema.parse(req.body);
  const userId = req.authUser!.id;
  const tool = getTool(input.tool);
  if (!tool) {
    res.status(404).json({ error: 'unknown-tool', message: `Unknown tool "${input.tool}".` });
    return;
  }
  if (input.action === 'grant') {
    grantToolPermission(userId, tool.name);
    resetPermissionPrompts(userId, tool.name);
  } else if (input.action === 'revoke') {
    revokeToolPermission(userId, tool.name);
    resetPermissionPrompts(userId, tool.name);
  } else {
    resetPermissionPrompts(userId, tool.name);
  }
  res.json({ permissions: listToolPermissions(userId) });
}));

voiceRouter.post('/lock-workstation', requireAuth, asyncHandler(async (req, res) => {
  const userId = req.authUser!.id;
  const sessionId = ensureSession(userId);
  const action: AssistantAction = { tool: 'lock_workstation', arguments: {} };
  const actionResult = await executeAction(action, {
    userId,
    sessionId,
    requestText: 'User clicked Lock this PC in Settings',
    confirmed: true,
  });
  res.json({ actionResult });
}));

voiceRouter.post('/tts', requireAuth, asyncHandler(async (req, res) => {
  const input = ttsSchema.parse(req.body);
  const speech = await getTextToSpeechProvider().synthesize(input);
  res.setHeader('Content-Type', speech.mimeType);
  res.setHeader('Cache-Control', 'no-store');
  res.send(Buffer.from(speech.audio));
}));
