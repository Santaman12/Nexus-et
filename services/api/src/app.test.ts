import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

process.env.DATABASE_PATH = ':memory:';
process.env.JWT_SECRET = 'vitest-secret';
process.env.OPENAI_API_KEY = '';
process.env.GEMINI_API_KEY = '';

let server: Server;
let baseUrl = '';

beforeAll(async () => {
  const { createApp } = await import('./app.js');
  server = createApp().listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}/api`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

async function json(path: string, options: RequestInit = {}) {
  const response = await fetch(`${baseUrl}${path}`, options);
  const body = await response.json().catch(() => ({}));
  return { response, body: body as Record<string, any> };
}

async function registerUser() {
  const email = `nexus-${randomUUID()}@example.com`;
  const registered = await json('/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Test User', email, password: 'correct horse battery' }),
  });
  expect(registered.response.status).toBe(201);
  return registered.body.accessToken as string;
}

describe('NEXUS API foundation', () => {
  it('reports health and provider configuration without secrets', async () => {
    const { response, body } = await json('/health');
    expect(response.status).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.providers.stt.configured).toBe(false);
    expect(body.providers.llm.configured).toBe(false);
    expect(body.providers.tts.configured).toBe(false);
    expect(body.providers.stt.provider).toBe('gemini');
    expect(body.providers.llm.provider).toBe('gemini');
    expect(body.providers.tts.provider).toBe('gemini');
    expect(JSON.stringify(body)).not.toContain('GEMINI_API_KEY');
    expect(JSON.stringify(body)).not.toContain('OPENAI_API_KEY');
  });

  it('registers and authenticates a user', async () => {
    const token = await registerUser();
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(20);
  });

  it('rejects unauthenticated voice requests', async () => {
    const { response, body } = await json('/voice/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transcript: 'hello' }),
    });
    expect(response.status).toBe(401);
    expect(body.error).toBe('unauthorized');
  });

  it('validates chat input', async () => {
    const token = await registerUser();
    const { response, body } = await json('/voice/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(400);
    expect(body.error).toBe('validation-error');
  });

  it('returns an honest not-configured error when the LLM provider has no key', async () => {
    const token = await registerUser();
    const { response, body } = await json('/voice/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ transcript: 'What is the capital of France?', language: 'en-US' }),
    });
    expect(response.status).toBe(503);
    expect(body.error).toBe('provider-not-configured');
    expect(body.message).toContain('GEMINI_API_KEY');
  });

  it('requires audio for transcription', async () => {
    const token = await registerUser();
    const { response, body } = await json('/voice/stt', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(response.status).toBe(400);
    expect(body.error).toBe('missing-audio');
  });
});
