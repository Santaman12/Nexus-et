import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';

export interface UserRecord {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  created_at: number;
}

export interface RefreshTokenRecord {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: number;
  revoked_at: number | null;
  created_at: number;
}

export interface MessageRecord {
  id: string;
  session_id: string;
  user_id: string;
  role: 'user' | 'assistant';
  content: string;
  language: string | null;
  created_at: number;
}

mkdirSync(dirname(config.databasePath), { recursive: true });

export const db = new DatabaseSync(config.databasePath);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS refresh_tokens (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at INTEGER NOT NULL,
    revoked_at INTEGER,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    language TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_messages_session_created
    ON messages(session_id, created_at);

  CREATE TABLE IF NOT EXISTS audit_log (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    session_id TEXT,
    request_text TEXT,
    tool_name TEXT NOT NULL,
    arguments_json TEXT NOT NULL,
    risk_level TEXT NOT NULL,
    permission_decision TEXT NOT NULL,
    confirmation TEXT,
    result_status TEXT NOT NULL,
    result_output TEXT,
    error TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_audit_user_created
    ON audit_log(user_id, created_at);

  CREATE TABLE IF NOT EXISTS permission_grants (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tool_name TEXT NOT NULL,
    granted_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, tool_name)
  );

  CREATE TABLE IF NOT EXISTS permission_prompts (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tool_name TEXT NOT NULL,
    prompt_count INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, tool_name)
  );

  CREATE TABLE IF NOT EXISTS user_settings (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, key)
  );
`);

const now = () => Date.now();

export function createUser(input: { email: string; name: string; passwordHash: string }): UserRecord {
  const id = randomUUID();
  db.prepare(
    'INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(id, input.email, input.name, input.passwordHash, now());
  return findUserById(id)!;
}

export function findUserByEmail(email: string): UserRecord | null {
  const row = db.prepare('SELECT * FROM users WHERE email = ?').get(email) as UserRecord | undefined;
  return row ?? null;
}

export function findUserById(id: string): UserRecord | null {
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRecord | undefined;
  return row ?? null;
}

export function createRefreshToken(input: { userId: string; tokenHash: string; expiresAt: number }): RefreshTokenRecord {
  const id = randomUUID();
  db.prepare(
    'INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at, revoked_at, created_at) VALUES (?, ?, ?, ?, NULL, ?)'
  ).run(id, input.userId, input.tokenHash, input.expiresAt, now());
  return db.prepare('SELECT * FROM refresh_tokens WHERE id = ?').get(id) as unknown as RefreshTokenRecord;
}

export function findRefreshTokenByHash(tokenHash: string): RefreshTokenRecord | null {
  const row = db.prepare('SELECT * FROM refresh_tokens WHERE token_hash = ?').get(tokenHash) as RefreshTokenRecord | undefined;
  return row ?? null;
}

export function revokeRefreshToken(id: string): void {
  db.prepare('UPDATE refresh_tokens SET revoked_at = ? WHERE id = ?').run(now(), id);
}

export function createSession(userId: string): string {
  const id = randomUUID();
  db.prepare('INSERT INTO sessions (id, user_id, created_at, last_seen_at) VALUES (?, ?, ?, ?)')
    .run(id, userId, now(), now());
  return id;
}

export function ensureSession(userId: string, sessionId?: string): string {
  if (sessionId) {
    const row = db.prepare('SELECT id FROM sessions WHERE id = ? AND user_id = ?').get(sessionId, userId);
    if (row) {
      db.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?').run(now(), sessionId);
      return sessionId;
    }
  }
  return createSession(userId);
}

export function addMessage(input: {
  sessionId: string;
  userId: string;
  role: 'user' | 'assistant';
  content: string;
  language?: string;
}): MessageRecord {
  const id = randomUUID();
  db.prepare(
    'INSERT INTO messages (id, session_id, user_id, role, content, language, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(id, input.sessionId, input.userId, input.role, input.content, input.language ?? null, now());
  return db.prepare('SELECT * FROM messages WHERE id = ?').get(id) as unknown as MessageRecord;
}

export function getRecentMessages(sessionId: string, limit = 12): Array<{ role: 'user' | 'assistant'; content: string }> {
  const rows = db.prepare(
    'SELECT role, content FROM messages WHERE session_id = ? ORDER BY created_at DESC LIMIT ?'
  ).all(sessionId, limit) as Array<{ role: 'user' | 'assistant'; content: string }>;
  return rows.reverse();
}

export interface AuditLogEntry {
  id: string;
  user_id: string;
  session_id: string | null;
  request_text: string | null;
  tool_name: string;
  arguments_json: string;
  risk_level: string;
  permission_decision: string;
  confirmation: string | null;
  result_status: string;
  result_output: string | null;
  error: string | null;
  created_at: number;
}

export function addAuditLog(entry: Omit<AuditLogEntry, 'id' | 'created_at'>): void {
  db.prepare(
    `INSERT INTO audit_log
     (id, user_id, session_id, request_text, tool_name, arguments_json, risk_level,
      permission_decision, confirmation, result_status, result_output, error, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    randomUUID(),
    entry.user_id,
    entry.session_id,
    entry.request_text,
    entry.tool_name,
    entry.arguments_json,
    entry.risk_level,
    entry.permission_decision,
    entry.confirmation,
    entry.result_status,
    entry.result_output,
    entry.error,
    now(),
  );
}

export function getAuditLog(userId: string, limit = 100): AuditLogEntry[] {
  return db.prepare(
    'SELECT * FROM audit_log WHERE user_id = ? ORDER BY created_at DESC LIMIT ?'
  ).all(userId, limit) as unknown as AuditLogEntry[];
}

export function hasToolPermission(userId: string, toolName: string): boolean {
  const row = db.prepare('SELECT 1 AS ok FROM permission_grants WHERE user_id = ? AND tool_name = ?')
    .get(userId, toolName) as { ok: number } | undefined;
  return Boolean(row);
}

export function grantToolPermission(userId: string, toolName: string): void {
  db.prepare(
    'INSERT INTO permission_grants (user_id, tool_name, granted_at) VALUES (?, ?, ?) ON CONFLICT(user_id, tool_name) DO NOTHING'
  ).run(userId, toolName, now());
}

export function revokeToolPermission(userId: string, toolName: string): void {
  db.prepare('DELETE FROM permission_grants WHERE user_id = ? AND tool_name = ?').run(userId, toolName);
}

export function listToolPermissions(userId: string): string[] {
  const rows = db.prepare('SELECT tool_name FROM permission_grants WHERE user_id = ? ORDER BY tool_name')
    .all(userId) as Array<{ tool_name: string }>;
  return rows.map((row) => row.tool_name);
}

export function getPermissionPromptCount(userId: string, toolName: string): number {
  const row = db.prepare('SELECT prompt_count FROM permission_prompts WHERE user_id = ? AND tool_name = ?')
    .get(userId, toolName) as { prompt_count: number } | undefined;
  return row?.prompt_count ?? 0;
}

export function incrementPermissionPromptCount(userId: string, toolName: string): void {
  db.prepare(
    `INSERT INTO permission_prompts (user_id, tool_name, prompt_count, updated_at)
     VALUES (?, ?, 1, ?)
     ON CONFLICT(user_id, tool_name) DO UPDATE SET prompt_count = prompt_count + 1, updated_at = excluded.updated_at`
  ).run(userId, toolName, now());
}

export function resetPermissionPrompts(userId: string, toolName?: string): void {
  if (toolName) {
    db.prepare('DELETE FROM permission_prompts WHERE user_id = ? AND tool_name = ?').run(userId, toolName);
  } else {
    db.prepare('DELETE FROM permission_prompts WHERE user_id = ?').run(userId);
  }
}

export function getUserSetting(userId: string, key: string): string | null {
  const row = db.prepare('SELECT value FROM user_settings WHERE user_id = ? AND key = ?')
    .get(userId, key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setUserSetting(userId: string, key: string, value: string): void {
  db.prepare(
    `INSERT INTO user_settings (user_id, key, value, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).run(userId, key, value, now());
}
