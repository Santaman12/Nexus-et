import cors from 'cors';
import express, { type ErrorRequestHandler } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { config } from './config.js';
import { ProviderError } from './providers/errors.js';
import { registerAllTools } from './tools/index.js';
import { authRouter } from './routes/auth.routes.js';
import { healthRouter } from './routes/health.routes.js';
import { voiceRouter } from './routes/voice.routes.js';

export function createApp() {
  registerAllTools();
  const app = express();

  app.disable('x-powered-by');
  app.use(cors({ origin: config.corsOrigins }));
  app.use(express.json({ limit: '1mb' }));

  app.use('/api', healthRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/voice', voiceRouter);

  app.use((_req, res) => {
    res.status(404).json({ error: 'not-found', message: 'Route not found' });
  });

  const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
    if (error instanceof ProviderError) {
      res.status(error.status).json({ error: error.code, message: error.message });
      return;
    }
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'validation-error', message: 'Invalid request', issues: error.issues });
      return;
    }
    if (error instanceof multer.MulterError) {
      res.status(400).json({ error: 'upload-error', message: error.message });
      return;
    }
    if (error instanceof Error && 'type' in error && (error as { type?: string }).type === 'entity.parse.failed') {
      res.status(400).json({ error: 'invalid-json', message: 'Request body is not valid JSON' });
      return;
    }
    if (error instanceof Error && error.message === 'Only audio or video media uploads are accepted') {
      res.status(400).json({ error: 'unsupported-media', message: error.message });
      return;
    }

    console.error('[api] unhandled error', error);
    res.status(500).json({ error: 'internal-error', message: 'Unexpected server error' });
  };

  app.use(errorHandler);
  return app;
}
