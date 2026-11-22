// Tool-execution smoke test: asks Gemini to use a registered safe tool.
// Run: node tests/e2e/tool-smoke.mjs

const API_URL = process.env.NEXUS_API_URL ?? 'http://localhost:3001';

const email = `nexus-tools-${Date.now()}@example.com`;
const register = await fetch(`${API_URL}/api/auth/register`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'Tool Smoke', email, password: 'tool-smoke-pass' }),
});
if (!register.ok) throw new Error(`register failed: ${register.status}`);
const { accessToken } = await register.json();

const chat = await fetch(`${API_URL}/api/voice/chat`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
  body: JSON.stringify({ transcript: 'Use your tools: what time is it on the server right now?', language: 'en-US' }),
});
const body = await chat.json();
console.log(JSON.stringify({ status: chat.status, answer: body.answer, actionResults: body.actionResults, error: body.error, message: body.message }, null, 2));
