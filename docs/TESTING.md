# Testing

## Automated tests

- `npm test` — Vitest suites. `app.test.ts` covers health/auth/validation/provider errors; `tools/registry.test.ts` covers safe execution, unknown-tool rejection, invalid-arg rejection, and confirmation gating (10 API tests total); `voiceController.test.ts` covers the voice state pipeline (3 web tests).
- `tests/e2e/gemini-smoke.mjs` — real Gemini STT→LLM→TTS round-trip.
- `tests/e2e/tool-smoke.mjs` — real Gemini tool selection + execution + spoken result.
- `npm run typecheck` / `npm run build` — must pass before any milestone is claimed.
- `npm audit` — currently reports 0 vulnerabilities.

## Browser smoke test (Edge via CDP)

`tests/e2e/cdp-voice-smoke.mjs` drives real Edge with fake microphone media:

1. `npm run dev` (web :3000, API :3001)
2. Launch Edge with `--remote-debugging-port=9222 --use-fake-ui-for-media-stream --use-fake-device-for-media-stream`
3. `node tests/e2e/cdp-voice-smoke.mjs`

It registers a temp user, opens the dashboard, performs Start/Stop listening, and prints page state + console errors. With no provider keys it must end in the honest `provider-not-configured` error — never a fake answer.

## Manual checklist (per milestone)

- Real microphone capture and permission grant/deny paths.
- Spoken questions in each target language; verify STT and TTS separately.
- Stop / Emergency Stop during listening, processing, and speaking.
- Barge-in (M4), wake word in quiet/noisy rooms (M4).
- Display Panel open/close/navigate by voice for each content type (M2).
- Permission denial handling on Windows/Android.
- Offline behavior: disconnect network and verify honest offline messages.
- Gemini quota/network/auth failure behavior.

## Performance measurement (M9 target)

Measure and record in `docs/PERFORMANCE.md`: wake-word latency, STT latency, LLM time-to-first-token, TTS latency, end-to-end time to first spoken word, API cost per request, CPU/RAM. Target ≈2 s to first spoken word on a good connection where providers allow.
