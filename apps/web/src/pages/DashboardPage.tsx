import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { ActionResult, AssistantDisplayPayload, NexusState } from '@nexus/core';
import { api } from '../lib/api';
import { getStoredAuth } from '../lib/auth';
import { defaultSettings, loadSettings, saveSettings } from '../lib/settings';
import { BackendSpeechOutput, BrowserSpeechOutput, unlockAudioPlayback } from '../voice/outputs';
import { VoiceController } from '../voice/voiceController';

const STATE_LABELS: Record<NexusState, string> = {
  booting: 'BOOTING',
  standby: 'STANDBY',
  listening: 'LISTENING',
  processing: 'PROCESSING',
  planning: 'PLANNING',
  'requesting-permission': 'REQUESTING PERMISSION',
  'waiting-for-user': 'WAITING FOR USER',
  executing: 'EXECUTING',
  speaking: 'SPEAKING',
  completed: 'COMPLETED',
  error: 'ERROR',
  'emergency-stopped': 'EMERGENCY STOP',
};

const FILE_ACCEPT = [
  'image/*',
  'application/pdf',
  '.txt', '.md', '.markdown', '.csv', '.tsv', '.json', '.jsonl', '.xml', '.yaml', '.yml', '.toml', '.ini', '.log',
  '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.py', '.java', '.c', '.h', '.cpp', '.hpp', '.cs', '.go', '.rs',
  '.rb', '.php', '.swift', '.kt', '.sql', '.sh', '.ps1', '.bat', '.html', '.css',
].join(',');

interface PendingPermission {
  tool: string;
  message: string;
}

const DISPLAY_CHAR_LIMIT = 6000;

function payloadText(data: unknown): string {
  if (typeof data === 'string') return data;
  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    for (const key of ['text', 'content', 'answer', 'summary', 'body']) {
      if (typeof obj[key] === 'string') return obj[key] as string;
    }
  }
  try {
    return JSON.stringify(data, null, 2);
  } catch {
    return String(data);
  }
}

function buildPreviewDocument(language: string | undefined, code: string): string | null {
  const lang = (language ?? '').toLowerCase();
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  if (lang === 'css') {
    return `<!doctype html><html><head><meta charset="utf-8"><style>${code}</style></head><body style="margin:0;background:#0b1220;color:#e2e8f0;font-family:sans-serif"><div style="padding:24px">CSS preview — styles above apply to this page.</div></body></html>`;
  }
  if (lang === 'html' || lang === 'htm') {
    const doc = /<html[\s>]/i.test(code) ? code : `<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:system-ui,sans-serif;background:#0b1220;color:#e2e8f0;margin:0;padding:24px}</style></head><body>${code}</body></html>`;
    return doc;
  }
  if (lang === 'javascript' || lang === 'js' || lang === 'typescript' || lang === 'ts') {
    return `<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:ui-monospace,monospace;background:#0b1220;color:#e2e8f0;margin:0;padding:24px;white-space:pre-wrap}</style></head><body><div id="out">Running preview…</div><script>
try {
${code}
} catch (err) {
  document.getElementById('out').textContent = 'Preview runtime error: ' + (err && err.message ? err.message : err);
}
<\/script></body></html>`;
  }
  if (lang === 'jsx' || lang === 'tsx') {
    // JSX needs a transpiler — show an honest rendered-code view instead of fake execution.
    return null;
  }
  return null;
}

function CodePreviewModal({ language, code, onClose }: { language?: string; code: string; onClose: () => void }) {
  const doc = buildPreviewDocument(language, code);
  const renderable = doc !== null;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="preview-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label="Code preview">
      <div className="preview-panel" onClick={(e) => e.stopPropagation()}>
        <div className="preview-bar">
          <span className="preview-title">{renderable ? 'Live preview' : 'Code preview'} · {language || 'code'}</span>
          <button type="button" className="preview-close" onClick={onClose} aria-label="Close preview">✕</button>
        </div>
        {renderable ? (
          <iframe
            className="preview-frame"
            title="Code preview"
            sandbox="allow-scripts"
            srcDoc={doc ?? ''}
          />
        ) : (
          <div className="preview-static">
            <pre className="preview-static-code">{code}</pre>
          </div>
        )}
      </div>
    </div>
  );
}

function CodeBlock({ language, code }: { language?: string; code: string }) {
  const [copied, setCopied] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="term-code-wrap">
      <div className="term-code-bar">
        <span className="term-code-lang">{language || 'code'}</span>
        <span className="term-code-actions">
          <button type="button" className="copy-btn preview-btn" onClick={() => setPreviewOpen(true)}>
            Preview
          </button>
          <button type="button" className={`copy-btn${copied ? ' copied' : ''}`} onClick={() => void handleCopy()}>
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </span>
      </div>
      <pre className="term-code">{code}</pre>
      {previewOpen && <CodePreviewModal language={language} code={code} onClose={() => setPreviewOpen(false)} />}
    </div>
  );
}

function renderGenericPayload(payload: AssistantDisplayPayload) {
  const { kind, data } = payload;

  if (kind === 'list' && Array.isArray(data)) {
    return (
      <div className="term-results">
        {data.slice(0, 20).map((item, index) => (
          <div key={index} className="term-result term-result-static">
            {typeof item === 'string' ? item : payloadText(item)}
          </div>
        ))}
      </div>
    );
  }

  if (kind === 'table') {
    const obj = data as { columns?: unknown; rows?: unknown } | undefined;
    let columns: string[] = [];
    let rows: unknown[][] = [];
    if (Array.isArray(obj?.columns) && Array.isArray(obj?.rows)) {
      columns = obj.columns.map(String);
      rows = obj.rows.map((row) => (Array.isArray(row) ? row : [row]));
    } else if (Array.isArray(data) && data.length > 0 && typeof data[0] === 'object') {
      columns = Object.keys(data[0] as Record<string, unknown>);
      rows = (data as Record<string, unknown>[]).map((row) => columns.map((col) => row[col]));
    }
    if (columns.length > 0) {
      return (
        <div className="term-table-wrap">
          <table className="term-table">
            <thead>
              <tr>{columns.map((col) => <th key={col}>{col}</th>)}</tr>
            </thead>
            <tbody>
              {rows.slice(0, 30).map((row, i) => (
                <tr key={i}>{columns.map((_, j) => <td key={j}>{String(row[j] ?? '')}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
  }

  const text = payloadText(data);
  if (!text.trim()) return null;
  return <pre className="term-file term-generic">{text.slice(0, DISPLAY_CHAR_LIMIT)}</pre>;
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const auth = getStoredAuth();
  const controllerRef = useRef<VoiceController | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [ready, setReady] = useState(false);
  const [voiceState, setVoiceState] = useState<NexusState>('standby');
  const [statusMessage, setStatusMessage] = useState('Say "Hi Nexus" to activate.');
  const [error, setError] = useState('');
  const [transcript, setTranscript] = useState('');
  const [lastAction, setLastAction] = useState('');
  const [lastAnswer, setLastAnswer] = useState('');
  const [speechProgress, setSpeechProgress] = useState(1);
  const [fileContent, setFileContent] = useState('');
  const [fileTyped, setFileTyped] = useState('');
  const [streamText, setStreamText] = useState('');
  const [uploadPreview, setUploadPreview] = useState<{ name: string; url: string } | null>(null);
  const [display, setDisplay] = useState<AssistantDisplayPayload | null>(null);
  const [pendingPermission, setPendingPermission] = useState<PendingPermission | null>(null);
  const [textInput, setTextInput] = useState('');
  const [now, setNow] = useState(new Date());
  const settings = useMemo(loadSettings, []);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  useEffect(() => {
    setVoiceState('standby');
    setStatusMessage('Say "Hi Nexus" to activate.');
    setError('');
    setTranscript('');
    setLastAction('');
    setLastAnswer('');
    setSpeechProgress(1);
    setFileContent('');
    setFileTyped('');
    setStreamText('');
    setUploadPreview(null);
    setDisplay(null);
    setPendingPermission(null);
    setTextInput('');

    const controller = new VoiceController(
      {
        onState: (state, message) => {
          setVoiceState(state);
          setStatusMessage(message ?? STATE_LABELS[state]);
          if (state !== 'error') setError('');
          if (state === 'standby' || state === 'completed') setPendingPermission(null);
          if (state === 'speaking') {
            setStreamText('');
            setSpeechProgress(0);
          }
          if (state === 'listening' || state === 'processing') {
            setLastAnswer('');
            setStreamText('');
          }
          if (state === 'standby' || state === 'completed' || state === 'error') {
            setUploadPreview((prev) => {
              if (prev) URL.revokeObjectURL(prev.url);
              return null;
            });
            setSpeechProgress(1);
          }
          if (state === 'completed' && settingsRef.current.handsFree) {
            window.setTimeout(() => {
              const current = controllerRef.current;
              if (current && (current.getState() === 'standby' || current.getState() === 'completed')) {
                void current.startListening();
              }
            }, 1200);
          }
        },
        onLevel: () => undefined,
        onTranscript: (text) => setTranscript(text),
        onDisplayPayload: (payload: AssistantDisplayPayload) => setDisplay(payload),
        onAction: (result: ActionResult) => {
          const detail = result.message ? ` — ${result.message}` : '';
          setLastAction(`ACT · ${result.tool}: ${result.status}${detail}`.slice(0, 140));
          // Only a needs-confirmation result may SET the prompt — never clear it
          // here, because a completed action can arrive after it in the same batch.
          if (result.status === 'needs-confirmation') {
            setPendingPermission({ tool: result.tool, message: result.message ?? 'requires your permission' });
            controllerRef.current?.setPendingConfirmation(result.tool);
          }
        },
        onAnswer: (text) => {
          setLastAnswer(text);
          setSpeechProgress(0);
          setFileTyped('');
        },
        onFileContent: (text) => {
          setFileContent(text);
          setFileTyped('');
        },
        onStreamToken: (text) => setStreamText(text),
        onPendingCleared: () => setPendingPermission(null),
        onNavigate: (target) => {
          if (target === 'settings') navigate('/settings');
        },
        onSpeechProgress: (fraction) => setSpeechProgress(fraction),
        onError: (errorMessage) => {
          setError(errorMessage);
          setUploadPreview((prev) => {
            if (prev) URL.revokeObjectURL(prev.url);
            return null;
          });
        },
      },
      new BackendSpeechOutput(),
      new BrowserSpeechOutput(),
      { rate: settings.voiceRate, volume: settings.voiceVolume },
    );
    controllerRef.current = controller;
    controller.warmup();
    api.getSettings()
      .then((res) => {
        if (!res.settings) return;
        const merged = { ...defaultSettings, ...(res.settings as Partial<typeof defaultSettings>) };
        saveSettings(merged);
        settingsRef.current = merged;
        controller.setSettings({ rate: merged.voiceRate, volume: merged.voiceVolume });
      })
      .catch(() => undefined);
    setReady(true);

    const clock = window.setInterval(() => setNow(new Date()), 1000);

    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(target.tagName) || target.isContentEditable)
      ) {
        return;
      }
      if (event.code === 'Space') {
        event.preventDefault();
        void controller.toggleListening();
      }
      if (event.code === 'Escape') {
        controller.emergencyStop();
      }
    };
    window.addEventListener('keydown', onKeyDown);

    return () => {
      window.clearInterval(clock);
      window.removeEventListener('keydown', onKeyDown);
      controller.dispose();
      controllerRef.current = null;
    };
  }, [settings.voiceRate, settings.voiceVolume]);

  useEffect(() => {
    if (!fileContent) return;
    if (voiceState !== 'speaking') {
      setFileTyped(fileContent);
      return;
    }
    const startedAt = performance.now();
    const durationMs = Math.min(30000, Math.max(2000, fileContent.length * 12));
    const timer = window.setInterval(() => {
      const progress = Math.min(1, (performance.now() - startedAt) / durationMs);
      setFileTyped(fileContent.slice(0, Math.floor(fileContent.length * progress)));
      if (progress >= 1) window.clearInterval(timer);
    }, 50);
    return () => window.clearInterval(timer);
  }, [voiceState, fileContent]);

  function handleFileSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !ready) return;
    unlockAudioPlayback();
    const instruction = textInput.trim() || undefined;
    setTextInput('');
    setPendingPermission(null);
    controllerRef.current?.setPendingConfirmation(null);
    setStreamText('');
    setFileContent('');
    setFileTyped('');
    setSpeechProgress(1);
    setDisplay(null);
    setUploadPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev.url);
      return file.type.startsWith('image/') ? { name: file.name, url: URL.createObjectURL(file) } : null;
    });
    void controllerRef.current?.submitFile(file, instruction);
  }

  function handleAllowPermission() {
    if (!pendingPermission) return;
    unlockAudioPlayback();
    setPendingPermission(null);
    void controllerRef.current?.confirmAction(pendingPermission.tool);
  }

  function handleCancelPermission() {
    setPendingPermission(null);
    controllerRef.current?.setPendingConfirmation(null);
    setLastAction('ACT · action cancelled by user');
  }

  async function logout() {
    await api.logout().catch(() => undefined);
    navigate('/login');
  }

  const speaking = voiceState === 'speaking';
  const generating = voiceState === 'processing' && Boolean(streamText);
  // Answers render the instant they arrive — no waiting for TTS audio.
  const displayReply = streamText || lastAnswer;
  const showReply = Boolean(displayReply) && (speaking || generating || voiceState === 'processing');
  const replyActive = speaking || generating || voiceState === 'processing';
  const showStatus = !showReply && !error;
  const searchSources =
    display?.kind === 'search'
      ? (display.sources ?? (display.data as { sources?: Array<{ title: string; url: string }> } | undefined)?.sources ?? [])
      : [];
  const codeData = display?.kind === 'code' ? (display.data as { language?: string; code?: string } | undefined) : undefined;
  const genericDisplay = display && display.kind !== 'search' && display.kind !== 'code' ? renderGenericPayload(display) : null;

  return (
    <main className="dashboard hud">
      <header className="hud-top">
        <div className="hud-brand">
          <img className="hud-logo-img" src="/brand/nexus-logo.png" alt="NEXUS" />
          <div className="hud-brand-text">
            <strong>NEXUS</strong>
            <i>[NEXUS CORE]</i>
          </div>
        </div>
        <div className="hud-top-right">
          <span className="hud-clock">{now.toLocaleDateString()} · {now.toLocaleTimeString()}</span>
          <span className={`state-chip state-${voiceState}`}>{STATE_LABELS[voiceState]}</span>
          <Link className="hud-icon" to="/settings" title="Settings" aria-label="Settings">⚙</Link>
          <button className="hud-icon" onClick={() => void logout()} title="Sign out" aria-label="Sign out">⏻</button>
        </div>
      </header>

      <section className="hud-stage">
        <div className={`core-display core-${voiceState}`} role="img" aria-label={`NEXUS display, ${STATE_LABELS[voiceState]}`}>
          <div className="core-head">
            <span className="term-logo">NEXUS</span>
            <span className="term-role">VOICE-FIRST AI OPERATING SYSTEM</span>
          </div>

          {transcript && voiceState !== 'standby' && voiceState !== 'completed' && (
            <div className="term-line term-heard">YOU · {transcript}</div>
          )}

          {uploadPreview && (
            <div className="upload-preview">
              <img src={uploadPreview.url} alt={uploadPreview.name} />
              <span>{uploadPreview.name}</span>
            </div>
          )}

          {showReply && displayReply && (
            <div className="term-line term-reply">
              NEXUS ▸ {displayReply}
              {replyActive && <span className="term-caret">▍</span>}
            </div>
          )}

          {showReply && !displayReply && voiceState === 'speaking' && (
            <div className="term-line term-reply">NEXUS ▸ <span className="term-caret">▍</span></div>
          )}

          {fileTyped && (
            <pre className="term-file">{fileTyped}{voiceState === 'speaking' && <span className="term-caret">▍</span>}</pre>
          )}

          {searchSources.length === 0 && display?.kind === 'search' && (
            <div className="term-line term-dim">
              SEARCH · {String((display.data as { query?: string } | undefined)?.query ?? display.title ?? 'results')}
            </div>
          )}

          {searchSources.length > 0 && (
            <div className="term-results">
              {searchSources.slice(0, 6).map((source) => (
                <a key={source.url} className="term-result" href={source.url} target="_blank" rel="noreferrer">
                  {source.title || source.url}
                </a>
              ))}
            </div>
          )}

          {codeData?.code && (
            <CodeBlock language={codeData.language} code={codeData.code} />
          )}

          {genericDisplay}

          {pendingPermission && (
            <div className="term-permission">
              <span>PERMISSION · {pendingPermission.tool} — {pendingPermission.message}</span>
              <span className="term-permission-actions">
                <button className="allow-btn" onClick={handleAllowPermission} title="Allow and remember for future actions">ALLOW</button>
                <button className="deny-btn" onClick={handleCancelPermission}>DON'T ALLOW</button>
              </span>
            </div>
          )}

          {lastAction && !pendingPermission && (
            <div className="term-line term-act">{lastAction}</div>
          )}

          {error && <div className="term-line term-error">ERR · {error}</div>}

          {showStatus && (
            <div className="term-line term-dim">{statusMessage}</div>
          )}
        </div>

        <div className="voice-bar">
          <form
            className="voice-input-wrap"
            onSubmit={(event) => {
              event.preventDefault();
              unlockAudioPlayback();
              const value = textInput;
              setTextInput('');
              setPendingPermission(null);
              setStreamText('');
              setFileContent('');
              setFileTyped('');
              setSpeechProgress(1);
              setDisplay(null);
              void controllerRef.current?.submitText(value);
            }}
          >
            <input
              className="voice-input"
              type="text"
              value={textInput}
              onChange={(event) => setTextInput(event.target.value)}
              placeholder="Ask NEXUS anything…"
              aria-label="Ask NEXUS anything"
              maxLength={2000}
            />
            <button type="submit" className="send-btn" disabled={!textInput.trim() || voiceState === 'processing'} aria-label="Send">
              ➤
            </button>
          </form>
          <button
            className="upload-btn"
            disabled={!ready || voiceState === 'processing'}
            onClick={() => fileInputRef.current?.click()}
            aria-label="Upload picture or file"
            title="Upload picture or file"
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="3" width="18" height="18" rx="3" />
              <circle cx="9" cy="9" r="2" />
              <path d="M21 15l-5-5L5 21" />
            </svg>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept={FILE_ACCEPT}
            onChange={handleFileSelected}
            hidden
          />
        </div>

        <p className="hud-footer">
          Signed in as {auth?.user.name} · Space = push-to-talk · Esc = emergency stop · 📎 uploads pictures/files · Wake word (“Hey NEXUS”) arrives with the on-device engine in M4.
        </p>
      </section>
    </main>
  );
}
