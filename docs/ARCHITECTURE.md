# NEXUS Architecture

## Repository layout

```
apps/web          React + TypeScript + Vite PWA (port 3000)
services/api      Node.js + TypeScript + Express API (port 3001)
packages/core     Shared types and provider interfaces
tests/e2e         Browser-level smoke tests (Edge via CDP)
docs              Architecture, security, privacy, testing, languages, performance
```

Planned later: `apps/desktop` (Windows wrapper), `apps/mobile` (Android/iOS), `packages/tools`, `packages/security`, `packages/voice`.

## Request flow (current M1)

1. Web dashboard captures microphone audio with `getUserMedia` (noise suppression, echo cancellation, AGC) and `MediaRecorder`.
2. Client-side VAD detects speech start/end, silence timeout, and a 20 s maximum.
3. `POST /api/voice/stt` uploads the audio; the configured STT provider returns `{ text, language }`.
4. `POST /api/voice/chat` sends the transcript plus recent session history to the configured LLM provider, which returns `{ answer, language, displayPayload?, actions? }`.
5. `POST /api/voice/tts` synthesizes the answer; the client plays backend audio with browser speech synthesis as fallback.
6. Every voice state change is reflected in the dashboard orb, status label, and MIC indicator.

## Provider interfaces (`packages/core`)

- `SpeechToTextProvider.transcribe(AudioInput)`
- `LanguageModelProvider.respond(AssistantRequest)`
- `TextToSpeechProvider.synthesize(SpeechRequest)`
- `WakeWordProvider` (interface only; M4)
- `SpeechOutputProvider` (client-side playback)

Implementations: `gemini-*` (primary) and `openai-*` (alternative), selected by env config.

## Backend

- Express routers: `/api/health`, `/api/auth/*`, `/api/voice/*`.
- Auth: email/password registration, JWT access token + refresh token, bcrypt password hashing, per-user session isolation.
- DB: SQLite via `node:sqlite` (users, refresh tokens, sessions, messages). PostgreSQL is the production target.
- Validation: Zod schemas on all request bodies; Multer memory-storage upload with mimetype and 25 MB limits.
- Provider errors are typed (`ProviderError`) and surface as honest JSON errors; secrets never appear in responses or logs.

## Frontend

- No chat UI, no message bubbles, no typing box. Voice is primary; Space is push-to-talk, Escape is emergency stop.
- `VoiceController` owns the state machine and serializes operations so a single microphone session exists at a time.
- Display Panel is reserved for M2; `displayPayload` is already transported end-to-end.
- Manual service worker + web manifest provide installable-PWA baseline.

## Tool execution layer (initial M5 groundwork)

- `services/api/src/tools/registry.ts` — typed tool registry: name, description, Zod arg schema, risk level (`safe`/`sensitive`/`dangerous`), handler. `executeAction()` validates args, enforces confirmation for non-safe tools, executes with error capture, and writes a tamper-evident `audit_log` row for every decision.
- `services/api/src/tools/system.ts` — first registered SAFE tools: `get_system_info`, `get_datetime` (real data from the API host).
- `POST /api/voice/chat` injects the tool catalog into the Gemini prompt; the model may return `actions[]`. Each action is validated/executed server-side — the model can never emit shell commands, only registered tool names.
- When tools run, a second LLM pass folds the real tool results into the spoken answer (verified: "what time is it" → `get_datetime` → "2:31 PM Arabia Standard Time").
- `actionResults` are returned to the client and shown in the HUD terminal panel (`ACT · tool: status`).
- Confirmation flow for sensitive/dangerous tools is designed (`needs-confirmation` status + audit) but the spoken/on-screen confirm UX lands fully in M5.

## Planned additions

- M2: Display Panel renderer for `AssistantDisplayPayload` kinds.
- M4: on-device wake word (openWakeWord/Porcupine) with pre-activation audio discard.
- M5: tool registry with risk levels, allowlists, confirmations, audit log, memory.
- M6/M7: Windows desktop wrapper and Android app with native bridges.
