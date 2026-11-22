import { createHash, randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { config } from '../config.js';
import {
  createRefreshToken,
  createUser,
  findRefreshTokenByHash,
  findUserByEmail,
  findUserById,
  revokeRefreshToken,
  type UserRecord,
} from '../db.js';

const ACCESS_TOKEN_TTL = '15m';
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export class AuthError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const hashRefreshToken = (token: string) => createHash('sha256').update(token).digest('hex');

const publicUser = (user: UserRecord) => ({
  id: user.id,
  email: user.email,
  name: user.name,
});

const signAccessToken = (user: UserRecord) =>
  jwt.sign({ sub: user.id, email: user.email }, config.jwtSecret, { expiresIn: ACCESS_TOKEN_TTL });

const createRefreshTokenValue = () => randomUUID() + randomUUID();

export async function register(input: { email: string; name: string; password: string }) {
  const existing = findUserByEmail(input.email);
  if (existing) {
    throw new AuthError(409, 'An account with this email already exists');
  }

  const passwordHash = await bcrypt.hash(input.password, 12);
  const user = createUser({ email: input.email, name: input.name, passwordHash });
  const refreshToken = createRefreshTokenValue();
  createRefreshToken({
    userId: user.id,
    tokenHash: hashRefreshToken(refreshToken),
    expiresAt: Date.now() + REFRESH_TOKEN_TTL_MS,
  });

  return {
    user: publicUser(user),
    accessToken: signAccessToken(user),
    refreshToken,
    expiresIn: 900,
  };
}

export async function login(input: { email: string; password: string }) {
  const user = findUserByEmail(input.email);
  if (!user || !(await bcrypt.compare(input.password, user.password_hash))) {
    throw new AuthError(401, 'Invalid email or password');
  }

  const refreshToken = createRefreshTokenValue();
  createRefreshToken({
    userId: user.id,
    tokenHash: hashRefreshToken(refreshToken),
    expiresAt: Date.now() + REFRESH_TOKEN_TTL_MS,
  });

  return {
    user: publicUser(user),
    accessToken: signAccessToken(user),
    refreshToken,
    expiresIn: 900,
  };
}

export function refresh(refreshToken: string) {
  const tokenHash = hashRefreshToken(refreshToken);
  const stored = findRefreshTokenByHash(tokenHash);
  if (!stored || stored.revoked_at || stored.expires_at <= Date.now()) {
    throw new AuthError(401, 'Invalid or expired refresh token');
  }

  const user = findUserById(stored.user_id);
  if (!user) {
    throw new AuthError(401, 'Invalid or expired refresh token');
  }

  revokeRefreshToken(stored.id);
  const nextRefreshToken = createRefreshTokenValue();
  createRefreshToken({
    userId: user.id,
    tokenHash: hashRefreshToken(nextRefreshToken),
    expiresAt: Date.now() + REFRESH_TOKEN_TTL_MS,
  });

  return {
    user: publicUser(user),
    accessToken: signAccessToken(user),
    refreshToken: nextRefreshToken,
    expiresIn: 900,
  };
}

export function logout(refreshToken?: string) {
  if (!refreshToken) return;
  const stored = findRefreshTokenByHash(hashRefreshToken(refreshToken));
  if (stored && !stored.revoked_at) {
    revokeRefreshToken(stored.id);
  }
}
