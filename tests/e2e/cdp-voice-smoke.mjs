// Edge CDP smoke test for the NEXUS voice path.
// Requires Edge running with:
//   --remote-debugging-port=9222 --use-fake-ui-for-media-stream --use-fake-device-for-media-stream
// Run: node tests/e2e/cdp-voice-smoke.mjs

const WEB_URL = process.env.NEXUS_WEB_URL ?? 'http://localhost:3000';
const API_URL = process.env.NEXUS_API_URL ?? 'http://localhost:3001';
const CDP_HTTP = process.env.NEXUS_CDP_HTTP ?? 'http://localhost:9222';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function registerUser() {
  const email = `nexus-e2e-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`;
  const response = await fetch(`${API_URL}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'E2E User', email, password: 'e2e-password-123' }),
  });
  if (!response.ok) throw new Error(`register failed: ${response.status}`);
  return response.json();
}

const auth = await registerUser();
const targets = await fetch(`${CDP_HTTP}/json/list`).then((r) => r.json());
const page = targets.find((target) => target.type === 'page');
if (!page) throw new Error('No CDP page target found. Launch Edge with --remote-debugging-port=9222.');

const ws = new WebSocket(page.webSocketDebuggerUrl);
let nextId = 0;
const pending = new Map();
const consoleEvents = [];
const pageErrors = [];

ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(JSON.stringify(message.error)));
    else resolve(message.result);
    return;
  }
  if (message.method === 'Runtime.consoleAPICalled') {
    consoleEvents.push({ type: message.params.type, args: message.params.args.map((arg) => arg.value ?? arg.description ?? '') });
  }
  if (message.method === 'Runtime.exceptionThrown') {
    pageErrors.push(message.params.exceptionDetails);
  }
};

await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = reject;
});

function send(method, params = {}) {
  const id = ++nextId;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}

await send('Page.enable');
await send('Runtime.enable');

await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `
    localStorage.setItem('nexus.accessToken', ${JSON.stringify(auth.accessToken)});
    localStorage.setItem('nexus.refreshToken', ${JSON.stringify(auth.refreshToken)});
    localStorage.setItem('nexus.user', ${JSON.stringify(JSON.stringify(auth.user))});
  `,
});

await send('Page.navigate', { url: `${WEB_URL}/dashboard` });
await sleep(4000);

const before = await evaluate(`({
  url: location.href,
  text: document.body.innerText.slice(0, 1200),
  hasCoreDisplay: !!document.querySelector('.core-display'),
  hasMicButton: !!document.querySelector('.mic-btn'),
  hasUploadButton: !!document.querySelector('.upload-btn'),
  showsApiDiagnostics: document.body.innerText.includes('API connected'),
})`);

await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' }))`);
await sleep(2000);

const listening = await evaluate(`({
  stateChip: document.querySelector('.state-chip')?.textContent ?? null,
  displayClass: document.querySelector('.core-display')?.className ?? null,
})`);

await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' }))`);
await sleep(8000);

const after = await evaluate(`({
  url: location.href,
  text: document.body.innerText.slice(0, 2000),
  stateChip: document.querySelector('.state-chip')?.textContent ?? null,
})`);

const result = { before, listening, after, consoleEvents: consoleEvents.slice(-80), pageErrors };
console.log(JSON.stringify(result, null, 2));
ws.close();
