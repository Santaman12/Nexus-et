import type { Request, Response, NextFunction } from 'express';

declare global {
  namespace Express {
    interface Request {
      authUser?: {
        id: string;
        email: string;
        name: string;
      };
    }
  }
}

export {};
