import { Router } from 'express';
import { z } from 'zod';
import { AuthError, login, logout, refresh, register } from '../auth/auth.service.js';

export const authRouter = Router();

const credentialsSchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(8).max(200),
});

const registerSchema = credentialsSchema.extend({
  name: z.string().min(1).max(120),
});

const asyncHandler =
  (fn: (req: any, res: any, next: any) => Promise<unknown>) =>
  (req: any, res: any, next: any) => {
    fn(req, res, next).catch(next);
  };

authRouter.post('/register', asyncHandler(async (req, res) => {
  const input = registerSchema.parse(req.body);
  res.status(201).json(await register(input));
}));

authRouter.post('/login', asyncHandler(async (req, res) => {
  const input = credentialsSchema.parse(req.body);
  res.json(await login(input));
}));

authRouter.post('/refresh', asyncHandler(async (req, res) => {
  const input = z.object({ refreshToken: z.string().min(1) }).parse(req.body);
  res.json(refresh(input.refreshToken));
}));

authRouter.post('/logout', asyncHandler(async (req, res) => {
  const input = z.object({ refreshToken: z.string().optional() }).parse(req.body ?? {});
  logout(input.refreshToken);
  res.status(204).end();
}));

authRouter.use((error: unknown, _req: any, res: any, _next: any) => {
  if (error instanceof AuthError) {
    res.status(error.status).json({ error: 'auth-error', message: error.message });
    return;
  }
  if (error instanceof z.ZodError) {
    res.status(400).json({ error: 'validation-error', message: 'Invalid request body', issues: error.issues });
    return;
  }
  res.status(500).json({ error: 'internal-error', message: 'Authentication request failed' });
});
