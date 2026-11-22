# NEXUS Implementation Plan

This plan follows `NEXUS — Project Specification v2`.

## Ground rules

- Product name is exactly NEXUS.
- Voice is primary; no chat UI, bubbles, history page, typing requirement, or language selector.
- Providers stay behind interfaces so they can be replaced without changing application logic.
- No fake features or canned answers.
- Missing credentials or platform capabilities are documented honestly.
- `PROGRESS.md` is updated after every work session.

## Milestones

### M0 — Foundation

- Environment audit (`docs/ENVIRONMENT.md`)
- Monorepo scaffold
- Shared provider interfaces
- Backend health/auth foundation
- Web app shell and dashboard
- PWA baseline

### M1 — Voice core on the web

- Authentication
- Microphone capture with noise suppression/echo cancellation
- Push-to-talk and keyboard activation
- Voice activity detection
- Speech-to-text provider interface and backend endpoint
- Language-model provider interface and backend endpoint
- Text-to-speech provider interface and playback
- Central state visualization and status indicators
- Stop speech/action and emergency stop
- Acceptance: five different general-knowledge questions answered aloud with real model output

### M2 — Display Panel

- "Show me" / "close it" intent handling
- Panel for text, lists, tables, weather, news, search, media, code
- Voice navigation and close control

### M3 — Automatic multilingual

- Automatic language identification
- Language-matched voices
- Language switching on request
- Code-switching
- Truthful `docs/LANGUAGES.md` matrix

### M4 — Wake word and privacy

- On-device wake-word engine behind `WakeWord` interface
- Push-to-talk fallback
- Barge-in
- Always-visible microphone status
- Proof that pre-activation audio is not stored or transmitted

### M5 — Tools, memory, audit

- Typed tool registry with risk levels
- Allowlist and confirmations
- Tamper-evident audit log
- User-approved encrypted memory
- Scheduled reminders/workflows

### M6-M9

- Windows, Android, iOS wrappers and native integrations
- Hardening, performance, accessibility, installers, release documentation

## Current work

M0/M1 are in progress. The first implementation target is a working authenticated web voice loop with provider-backed STT/LLM/TTS and honest unconfigured-provider errors.
