// Gemini provider smoke test: register → chat → TTS → STT round-trip.
// Requires API on :3001 with GEMINI_API_KEY configured.
// Run: node tests/e2e/gemini-smoke.mjs

const API_URL = process.env.NEXUS_API_URL ?? 'http://localhost:3001';

const email = `nexus-gemini-${Date.now()}@example.com`;

async function api(path, options = {}, token) {
  const headers = new Headers(options.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const response = await fetch(`${API_URL}/api${path}`, { ...options, headers });
  return response;
}

const register = await api('/auth/register', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'Gemini Smoke', email, password: 'gemini-smoke-pass' }),
});
if (!register.ok) throw new Error(`register failed: ${register.status} ${await register.text()}`);
const auth = await register.json();
const token = auth.accessToken;
console.log('register: ok');

const chat = await api('/voice/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ transcript: 'What is the capital of France? Answer in one short sentence.', language: 'en-US' }),
}, token);
const chatBody = await chat.json().catch(() => ({}));
console.log('chat:', chat.status, JSON.stringify({ answer: chatBody.answer, language: chatBody.language, error: chatBody.error, message: chatBody.message }));
if (!chat.ok) process.exit(1);

const tts = await api('/voice/tts', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ text: 'What is the capital of France?', language: 'en-US' }),
}, token);
if (!tts.ok) {
  console.log('tts:', tts.status, await tts.text());
  process.exit(1);
}
const audio = Buffer.from(await tts.arrayBuffer());
const mime = tts.headers.get('content-type') ?? 'audio/wav';
console.log('tts:', tts.status, mime, `${audio.length} bytes`);

const form = new FormData();
form.append('audio', new Blob([audio], { type: mime }), 'question.wav');
const stt = await api('/voice/stt', { method: 'POST', body: form }, token);
const sttBody = await stt.json().catch(() => ({}));
console.log('stt:', stt.status, JSON.stringify(sttBody));
