# Security Model

## Secrets

- All provider API keys (`GEMINI_API_KEY`, `OPENAI_API_KEY`, `JWT_SECRET`) live only in `services/api/.env` or a secrets manager.
- `.env` files are git-ignored; only `.env.example` (empty values) is committed.
- The frontend never receives keys; `/api/health` reports only `{ provider, configured }` booleans.
- Provider error messages truncate upstream detail to 300 chars and never include request headers or keys.

## Authentication and sessions

- Email + password registration/login; bcrypt-hashed passwords.
- Short-lived JWT access token + rotating refresh token stored hashed server-side.
- All `/api/voice/*` routes require `requireAuth`; user data is scoped by `userId`.
- Session context (`sessionId`) is bound to the owning user; messages are isolated per user.

## Input validation

- Zod schemas validate every JSON body; Multer restricts uploads to audio/video mimetypes and 25 MB.
- Provider responses are parsed defensively; malformed model JSON falls back to raw text only when it contains an answer.

## Voice and privacy

- Microphone is off until the user presses Start listening / Space (push-to-talk). No always-on capture exists yet.
- Audio is sent to the configured STT provider only after the user stops recording; it is not persisted by NEXUS.
- Wake-word phase (M4) must discard pre-activation audio on-device and never transmit it.
- Emergency Stop halts speech, recording, and (later) scheduled automation immediately.

## Tool safety (partially implemented)

- Implemented: typed tool registry (`services/api/src/tools/registry.ts`), Zod-validated arguments, risk levels (SAFE runs immediately; SENSITIVE/DANGEROUS require `confirmed: true` and currently return `needs-confirmation`), tamper-evident `audit_log` table recording user, request, tool, args, decision, result, error.
- The model can only name registered tools — there is no path from natural language to shell execution.
- Registered now: `get_system_info`, `get_datetime` (SAFE, read-only, API host).
- Still planned (M5+): user allowlists for apps/folders/sites, spoken/on-screen confirmation UX, dangerous-action second factor, scheduled automation with per-step confirmation.
- Web content retrieved by tools is treated as untrusted data, never as instructions (prompt-injection defense).

## Transport and storage

- Development runs on localhost HTTP; production must terminate TLS at a reverse proxy/load balancer.
- SQLite is acceptable for development; production moves to PostgreSQL with encrypted volumes.
- Sensitive memory entries (M5) will be encrypted at rest; users can view/edit/delete all memory.
