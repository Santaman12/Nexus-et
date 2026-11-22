# NEXUS

NEXUS is a voice-first personal assistant. The product name is exactly **NEXUS**.

## Current milestone

M1 — Voice core on the web: authentication, dashboard, microphone control, speech-to-text, real language-model answers, text-to-speech, status indicators, and Stop controls.

## Repository layout

- `apps/web` — React + TypeScript PWA frontend
- `services/api` — Node.js + TypeScript backend API
- `packages/core` — shared provider interfaces and types
- `apps/desktop`, `apps/mobile` — planned wrappers for later milestones
- `docs` — environment, decisions, testing, languages, performance
- `tests` — cross-package integration and security tests

## Local development

Requirements: Node.js 20+ and npm 10+.

```powershell
npm install
npm run dev
```

Frontend: `http://localhost:3000`  
Backend: `http://localhost:3001`

## Environment variables

Copy `services/api/.env.example` to `services/api/.env` and configure provider keys on the backend only. Never put API keys in frontend code or commit `.env` files.

## Honest status

See `PROGRESS.md` for the current implementation state, blockers, and next steps.
