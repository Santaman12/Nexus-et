# Technical Decisions

## Stack

- Frontend: React + TypeScript + Vite, packaged as a PWA.
- Backend: Node.js + TypeScript + Express.
- Shared contracts: TypeScript interfaces/types in `packages/core`.
- Development database: SQLite through Node's built-in `node:sqlite`; PostgreSQL remains the production target.
- Package management: npm workspaces. pnpm/Yarn/Bun are not installed on the audit host.
- AI provider: **Google Gemini**, selected by the owner. One `GEMINI_API_KEY` powers three adapters: audio-understanding STT, generateContent LLM, and `gemini-2.5-flash-preview-tts` TTS.
- OpenAI adapters are kept as a swappable alternative behind the same provider interfaces.

## Voice providers

Speech-to-text, language model, text-to-speech, and wake word are interfaces in `packages/core`. Provider implementations are selected by backend environment configuration (`STT_PROVIDER`, `LLM_PROVIDER`, `TTS_PROVIDER`) and can be replaced without changing voice-pipeline logic.

- Gemini STT uses `generateContent` with inline audio and a JSON transcription prompt. This is audio understanding, not a dedicated ASR model; accuracy must be validated per language in `docs/LANGUAGES.md`.
- **STT audio format (verified fix):** the browser recorder captures raw PCM via `ScriptProcessorNode` and encodes 16-bit WAV client-side. WebM/Opus (`MediaRecorder`) is NOT in Gemini's supported audio formats and produced empty transcripts; WAV is supported and verified end-to-end. A 90 Hz high-pass filter plus AGC/noise-suppression/echo-cancellation constraints clean the capture, and a minimum-peak gate rejects silent recordings before upload.
- TTS playback uses WebAudio (`decodeAudioData` + `AudioBufferSourceNode`) on a shared `AudioContext` that is unlocked by the mic-button/text-submit user gesture — `HTMLAudioElement.play()` on blob URLs was unreliable under autoplay policy.
- TTS voice is pinned to a male prebuilt voice (`GEMINI_TTS_VOICE=Fenrir`) per owner request.
- NEXUS identity is fixed in the system prompt: created by Mister Sintayehu Gedfew (ስንታየሁ ገድፈወ), never by Google/Gemini — enforced for EN and AM phrasing.
- File/picture uploads go through `POST /api/voice/file` → `providers/file-analysis.ts`: images/PDF sent as Gemini `inlineData`, text/code decoded as text (15 MB cap). Response carries a spoken `answer` plus optional `correctedContent` which the UI types live while TTS speaks.
- Sensitive PC actions (`open_file`, `open_music`) are gated by the tool registry's confirmation flow: chat returns `needs-confirmation`, the action is stored server-side (10 min TTL, per user+session), and `POST /api/voice/confirm` executes it with `confirmed: true` after explicit user approval (ALLOW button). `get_battery_status` is safe and runs immediately. Process spawning uses `spawn`/`execFile`-style arg arrays — never shell string interpolation.
- Gemini TTS (`gemini-3.8-flash-tts`) returns WAV audio directly; the API passes it through when the mime type is already playable.
- Current verified-working models (2026-11-21): chat/STT `gemini-3.5-flash-lite`; TTS `gemini-3.8-flash-tts`. `gemini-3.8-flash`/`3.7-flash`/`flash-latest` returned 503 high-demand during testing; `gemini-2.5-flash`/`2.5-flash-lite` return 404 for new users. Model names are env-configurable (`GEMINI_MODEL`, `GEMINI_TTS_MODEL`).
- Browser `SpeechRecognition` is not treated as the production wake-word engine. The planned M4 wake word must run on-device through a dedicated engine such as openWakeWord or Porcupine.

## Assistant states

`NexusState` in `packages/core` models the full required state set: `booting`, `standby`, `listening`, `processing`, `planning`, `requesting-permission`, `waiting-for-user`, `executing`, `speaking`, `completed`, `error`, `emergency-stopped`. The dashboard maps every state to a label, orb style, and MIC status (`MIC OFF` / `MIC WAITING` / `MIC LISTENING` / `MIC PROCESSING` / `MIC SPEAKING`).

## Honesty rules

If a provider key or platform capability is missing, the app must return a clear not-configured/unavailable result and say so by voice where possible. It must not invent answers or pretend a feature works.
