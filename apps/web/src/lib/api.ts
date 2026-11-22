import type { AssistantDisplayPayload, AssistantResult, TranscriptionResult } from '@nexus/core';
import { clearAuth, getStoredAuth, setAuth, updateAccessToken, type AuthUser } from './auth';

const API_URL = import.meta.env.VITE_API_URL ?? '/api';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface AuthResponse {
  user: AuthUser;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

let refreshPromise: Promise<boolean> | null = null;

async function refreshTokens(): Promise<boolean> {
  const auth = getStoredAuth();
  if (!auth) return false;

  try {
    const response = await fetch(`${API_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: auth.refreshToken }),
    });
    if (!response.ok) return false;
    const data = (await response.json()) as AuthResponse;
    updateAccessToken(data.accessToken, data.refreshToken);
    return true;
  } catch {
    return false;
  }
}

async function request(path: string, options: RequestInit = {}, retry = true): Promise<Response> {
  const auth = getStoredAuth();
  const headers = new Headers(options.headers);
  if (auth && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${auth.accessToken}`);
  }
  if (options.body && !(options.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(`${API_URL}${path}`, { ...options, headers });

  if (response.status === 401 && retry && auth) {
    refreshPromise ??= refreshTokens().finally(() => {
      refreshPromise = null;
    });
    const refreshed = await refreshPromise;
    if (refreshed) {
      return request(path, options, false);
    }
    clearAuth();
  }

  return response;
}

async function parseError(response: Response): Promise<ApiError> {
  let code = 'request-failed';
  let message = `Request failed with status ${response.status}`;
  try {
    const body = (await response.json()) as { error?: string; message?: string };
    code = body.error ?? code;
    message = body.message ?? message;
  } catch {
    // Keep the status-based fallback.
  }
  return new ApiError(response.status, code, message);
}

export async function apiJson<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await request(path, options);
  if (!response.ok) throw await parseError(response);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

async function apiBlob(path: string, options: RequestInit = {}): Promise<Blob> {
  const response = await request(path, options);
  if (!response.ok) throw await parseError(response);
  return response.blob();
}

export interface HealthStatus {
  status: string;
  service: string;
  deployment?: 'cloud' | 'desktop';
  providers: {
    stt: { provider: string; configured: boolean };
    llm: { provider: string; configured: boolean };
    tts: { provider: string; configured: boolean };
  };
}

export const api = {
  health: () => apiJson<HealthStatus>('/health'),

  register: async (input: { name: string; email: string; password: string }) => {
    const data = await apiJson<AuthResponse>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    setAuth({ accessToken: data.accessToken, refreshToken: data.refreshToken, user: data.user });
    return data.user;
  },

  login: async (input: { email: string; password: string }) => {
    const data = await apiJson<AuthResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    setAuth({ accessToken: data.accessToken, refreshToken: data.refreshToken, user: data.user });
    return data.user;
  },

  logout: async () => {
    const auth = getStoredAuth();
    try {
      await apiJson('/auth/logout', {
        method: 'POST',
        body: JSON.stringify({ refreshToken: auth?.refreshToken }),
      });
    } finally {
      clearAuth();
    }
  },

  transcribeAudio: async (audio: Blob, languageHint?: string): Promise<TranscriptionResult> => {
    const form = new FormData();
    form.append('audio', audio, 'recording.webm');
    if (languageHint) form.append('language', languageHint);
    return apiJson<TranscriptionResult>('/voice/stt', { method: 'POST', body: form });
  },

  chat: async (input: { transcript: string; language?: string; sessionId?: string }): Promise<AssistantResult> =>
    apiJson<AssistantResult>('/voice/chat', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  synthesizeSpeech: async (input: {
    text: string;
    language?: string;
    voice?: string;
    rate?: number;
    volume?: number;
  }): Promise<Blob> => apiBlob('/voice/tts', { method: 'POST', body: JSON.stringify(input) }),

  analyzeFile: async (file: File, instruction?: string, sessionId?: string): Promise<FileAnalysisResult> => {
    const form = new FormData();
    form.append('file', file, file.name);
    if (instruction) form.append('instruction', instruction);
    if (sessionId) form.append('sessionId', sessionId);
    return apiJson<FileAnalysisResult>('/voice/file', { method: 'POST', body: form });
  },

  analyzeFileStream: async (
    file: File,
    instruction: string | undefined,
    sessionId: string | undefined,
    onToken: (text: string) => void,
  ): Promise<FileAnalysisResult> => {
    const form = new FormData();
    form.append('file', file, file.name);
    if (instruction) form.append('instruction', instruction);
    if (sessionId) form.append('sessionId', sessionId);

    const response = await request('/voice/file/stream', { method: 'POST', body: form });
    if (!response.ok) throw await parseError(response);
    if (!response.body) throw new ApiError(502, 'empty-stream', 'File analysis stream was empty.');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let result: FileAnalysisResult | null = null;

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split('\n\n');
      buffer = blocks.pop() ?? '';
      let eventName = 'message';
      for (const block of blocks) {
        for (const line of block.split('\n')) {
          if (line.startsWith('event:')) {
            eventName = line.slice(6).trim();
          } else if (line.startsWith('data:')) {
            const data = JSON.parse(line.slice(5).trim()) as Record<string, unknown>;
            if (eventName === 'token') {
              onToken(typeof data.text === 'string' ? data.text : '');
            } else if (eventName === 'done') {
              result = data.result as FileAnalysisResult;
            } else if (eventName === 'error') {
              throw new ApiError(
                typeof data.status === 'number' ? data.status : 500,
                'stream-error',
                typeof data.message === 'string' ? data.message : 'File analysis failed',
              );
            }
          }
        }
      }
    }

    if (!result) throw new ApiError(502, 'empty-stream', 'File analysis stream ended without a result.');
    return result;
  },

  confirmAction: async (sessionId: string, tool: string): Promise<AssistantResult> =>
    apiJson<AssistantResult>('/voice/confirm', {
      method: 'POST',
      body: JSON.stringify({ sessionId, tool }),
    }),

  getSettings: async (): Promise<{ settings: Record<string, unknown> | null }> =>
    apiJson<{ settings: Record<string, unknown> | null }>('/voice/settings'),

  putSettings: async (settings: Record<string, unknown>): Promise<{ settings: Record<string, unknown> }> =>
    apiJson<{ settings: Record<string, unknown> }>('/voice/settings', {
      method: 'PUT',
      body: JSON.stringify(settings),
    }),

  listPermissions: async (): Promise<{ permissions: string[] }> =>
    apiJson<{ permissions: string[] }>('/voice/permissions'),

  setPermission: async (tool: string, action: 'grant' | 'revoke' | 'reset'): Promise<{ permissions: string[] }> =>
    apiJson<{ permissions: string[] }>('/voice/permissions', {
      method: 'POST',
      body: JSON.stringify({ tool, action }),
    }),

  lockWorkstation: async (): Promise<{ actionResult: { status: string; message?: string } }> =>
    apiJson<{ actionResult: { status: string; message?: string } }>('/voice/lock-workstation', { method: 'POST' }),
};

export interface FileAnalysisResult extends AssistantResult {
  correctedContent?: string | null;
  filename?: string;
}

export type { AssistantDisplayPayload };
