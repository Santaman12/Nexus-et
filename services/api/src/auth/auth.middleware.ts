import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { findUserById } from '../db.js';

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'unauthorized', message: 'Authentication required' });
    return;
  }

  try {
    const payload = jwt.verify(header.slice('Bearer '.length), config.jwtSecret) as { sub?: string };
    if (!payload.sub) throw new Error('missing subject');
    const user = findUserById(payload.sub);
    if (!user) throw new Error('user not found');
    req.authUser = { id: user.id, email: user.email, name: user.name };
    next();
  } catch {
    res.status(401).json({ error: 'unauthorized', message: 'Invalid or expired access token' });
  }
}
