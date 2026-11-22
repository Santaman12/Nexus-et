# NEXUS Progress

Last updated: 2026-11-21

## Done

- Created the new from-scratch workspace at `C:\Sintayehu Nexus`.
- Confirmed the older prototype at `C:\Users\Sintayehu\NEXUS` is not being modified.
- Completed the environment audit (`docs/ENVIRONMENT.md`) and wrote the required doc set: `ARCHITECTURE.md`, `DECISIONS.md`, `TESTING.md`, `SECURITY.md`, `PRIVACY.md`, `LANGUAGES.md`, `PERFORMANCE.md`, `OFFLINE_CAPABILITIES.md`, `PLAN.md`.
- Scaffolded the npm-workspaces monorepo: `apps/web`, `services/api`, `packages/core`, `tests/e2e`.
- Implemented backend foundation: config, SQLite via `node:sqlite`, auth (register/login/refresh/logout, bcrypt, JWT), health route, STT/chat/TTS routes, Zod validation, Multer upload limits (10 MB for Gemini inline-audio limits).
- **Google Gemini is the configured AI provider.** `GEMINI_API_KEY` is set in `services/api/.env` (git-ignored). Adapters: `gemini-language-model.ts`, `gemini-speech-to-text.ts`, `gemini-tts.ts`, `gemini-client.ts` (90 s timeout, typed provider errors). OpenAI adapters remain as a swappable alternative.
- Verified-working models after live probing: chat/STT `gemini-3.5-flash-lite`; TTS `gemini-3.8-flash-tts`. `gemini-3.8/3.7-flash` and `flash-latest` returned 503 high-demand; `gemini-2.5-flash*` return 404 for new users. All model names are env-configurable.
- **Real Gemini smoke test passed** (`tests/e2e/gemini-smoke.mjs`): register → chat returned `The capital of France is Paris.` (en-US) → TTS returned 115 KB WAV → STT transcribed the synthesized speech back as `What is the capital of France?` (en). Full STT→LLM→TTS loop verified with real API calls.
- Expanded `NexusState` to the full required 12-state set; dashboard shows state + MIC status (MIC OFF/WAITING/LISTENING/PROCESSING/SPEAKING) + orb styling.
- Web foundation: React/Vite PWA, login/register, dashboard, settings, API client, service worker + manifest, recorder/VAD, speech output with browser fallback, `VoiceController`, Stop speech, Emergency stop, Space/Escape.
- Fixed StrictMode dispose bug (no more false "Emergency stopped" on load).
- Dependencies upgraded; `vite-plugin-pwa` removed; `npm audit` = **0 vulnerabilities**.
- Tests: 6 API integration tests + 3 `VoiceController` unit tests — all pass. `typecheck` and `build` pass.
- Edge CDP smoke re-verified with Gemini configured: dashboard shows `STT/LLM/TTS: gemini`, fake-mic audio reaches real Gemini STT, and the UI honestly reports `Speech-to-text returned an empty transcript.` (fake device tone is not speech). No page errors.
- **Premium HUD redesign implemented** per owner's visual spec: pure-black background, large central energy orb (cyan upper ring / violet lower ring, counter-rotating), breathing/pulse animations per state, floating glass terminal panel inside the orb showing real state/operation/heard/error/provider lines, rounded glass voice bar with mic button + live level-reactive waveform bars, minimal top controls (clock, state chip, MIC tag, settings, power), big state title, honest wake-word note. Verified via Edge CDP — renders all real states, no page errors.
- **Persona card + text input added**: in-orb panel now shows NEXUS persona header ("VOICE-FIRST AI OPERATING SYSTEM"), state, heard transcript, last action, errors, provider line. Bottom bar has "Ask NEXUS anything…" text field sharing the exact same chat→speak pipeline as voice (`VoiceController.submitText`).
- **Tool execution layer (initial M5 groundwork)**: `tools/registry.ts` (typed registry, Zod arg validation, risk levels, confirmation gating, tamper-evident `audit_log` table), `tools/system.ts` (SAFE tools `get_system_info`, `get_datetime`), chat route injects tool catalog into Gemini prompt, executes `actions[]` server-side, second LLM pass folds real results into the spoken answer. Verified live: "what time is it" → `get_datetime` → "2:31 PM Arabia Standard Time".
- Tests now 13 total (6 API foundation + 4 tool-registry + 3 voice-controller), all passing; build green.
- **Voice I/O root-cause fixes (this session):**
  - STT: recorder switched from `MediaRecorder` WebM/Opus to raw PCM → 16-bit WAV (Gemini does not support WebM — this was the empty-transcript bug). Added 90 Hz high-pass, min-peak silence gate, 30 s max, mute-aware VAD.
  - TTS: playback moved from `HTMLAudioElement` blob URL to WebAudio `decodeAudioData` on a gesture-unlocked shared `AudioContext` (autoplay-policy fix).
  - Mic button is now a **mute toggle**: while listening it pauses PCM capture and VAD without ending the session; idle click starts listening; Space still push-to-talk/send; Esc emergency stop.
  - Center card enlarged (82% width, 0.72 rem, high-contrast) and is now a live transcript display: `YOU ·` heard line, `NEXUS ▸` typewriter of the exact spoken answer with caret, `ACT`/`ERR`/provider lines.
  - Bottom bar decluttered: text input + mic button only; state heading, hint, error pill, Stop buttons removed (errors/state live in the card; Esc still emergency-stops).
  - Edge CDP smoke updated for mute flow — verified LISTENING → mute → unmute → send reaches PROCESSING with no page errors.
- **Owner-requested update (this session), all verified live:**
  - **Identity:** system prompt now answers who made NEXUS as "Mister Sintayehu Gedfew" (ስንታየሁ ገድፈወ) in English AND Amharic — verified: "Who created you?" → "I was created by Mister Sintayehu Gedfew."; "ማን ነው የፈጠረህ?" → answer contains ስንታየሁ/ገድፈወ. Never claims Gemini/Google made it.
  - **Center ring removed** → clean large `.core-display` panel (min 780px, high-contrast mono type); state shown only via border/glow color + top state chip.
  - **Text on screen only while active:** reply typewriter while SPEAKING, `YOU ·` live transcript while listening, `FILE` corrected-content typing, `PERMISSION` prompt, `ERR`/`ACT` lines. "API connected"/provider diagnostics removed entirely.
  - **Mic button removed** from bottom bar → text input + send + **picture/file upload button** (📎). Voice input remains via Space push-to-talk; Esc emergency stop.
  - **Male TTS voice:** `GEMINI_TTS_VOICE=Fenrir` (was Kore) in `.env`, `.env.example`, and config default.
  - **File/picture upload pipeline:** `POST /api/voice/file` + `providers/file-analysis.ts` + `classifyFile` — images & PDF via Gemini inlineData, text/code files decoded to text (15 MB limit). Returns spoken `answer` + `correctedContent`. Verified: broken `broken.js` (missing `)`) → explained error + cause + full corrected file; PNG → described contents.
  - **PC-control tools with permission gating:** new `tools/pc.ts` — `get_battery_status` (safe; verified live: "Your battery is at 89 percent and is currently charging"), `open_file` + `open_music` (sensitive → needs-confirmation). New `POST /api/voice/confirm` executes pending actions; verified live: "Open my music folder" → needs-confirmation → confirm → `C:\Users\Sintayehu\Music` opened, spoken confirmation.
  - **Exam/homework:** prompt instructs correct concise answers with brief reasoning; answers type live via the existing speak typewriter.
  - Error handler now returns 400 (not 500) for malformed JSON bodies.
  - Tests 14 total pass; typecheck + production build green; Edge CDP smoke re-run: `.core-display` renders, no mic button, upload button present, no API diagnostics, Space→LISTENING→STT honest empty-transcript, zero page errors.
- **Resilience + speed fixes (this session):**
  - `geminiGenerateContentResilient` in `gemini-client.ts`: automatic retry (2 attempts on primary) + model fallback chain for chat/STT/TTS/file-analysis. Transient 429/5xx/timeouts retry then advance through `GEMINI_MODEL_FALLBACKS` (default `gemini-3.5-flash,gemini-3.6-flash,gemini-3.1-flash-lite`); 404 advances immediately; 401/403 fail fast; total exhaustion returns friendly 503 "The AI service is busy right now…". TTS fallbacks via `GEMINI_TTS_MODEL_FALLBACKS`.
  - `get_battery_status` rewritten: `wmic` fast path (~1.3 s, 10 s timeout) → PowerShell `Get-CimInstance` fallback (45 s) → 30 s result cache. Verified: full chat round-trip with battery answer in ~4.2 s (was >15 s timeout); repeat call ~2.3 s. Answer: "Your battery is at 97 percent and is currently charging."
- **Streaming file/photo analysis (this session):**
  - `geminiStreamGenerateContent` (SSE `streamGenerateContent`) added to `gemini-client.ts`; fixed CRLF event-splitting and end-of-stream buffer flush bugs found during live testing.
  - `POST /api/voice/file/stream` SSE endpoint: emits `token` events with the visible answer text as it generates, then `done` with the full result (answer + language + correctedContent); `error` event on failure. Session/messages persisted on completion.
  - `analyzeFileStream` uses a plain-text-then-`<<<META>>>` contract so live tokens are readable (not raw JSON); model fallback chain applies until first token.
  - Prompt strengthened for OCR/visual: transcribe ALL visible text (print, handwriting, code, quiz questions, error messages) + describe objects/diagrams; exam images answered completely.
  - Frontend: `api.analyzeFileStream` SSE client, `VoiceController.onStreamToken`, dashboard shows live-typed `NEXUS ▸` text while tokens arrive (caret during processing), image thumbnail preview chip while analyzing, buffered `/voice/file` fallback if stream fails before first token.
  - Verified live: exam.png (rendered "NEXUS EXAM: 2+2=?") → streamed "The text in the image is: NEXUS EXAM: 2+2=? / The answer to the question 2+2 is 4." token-by-token; dot.png described accurately; broken.js fix path unchanged. TTS speaks the final answer via male Fenrir voice.
- **Exam handling + voice/typing sync (this session):**
  - All three prompts (chat SYSTEM_PROMPT, file ANALYSIS_PROMPT, stream STREAM_PROMPT) now require exam/quiz answers as numbered final answers only — questions are never repeated or read back. Verified live: exam2.png (3 questions) → streamed `1. 60 / 2. Tokyo / 3. Water`.
  - `SpeechCallbacks.onProgress` added to `@nexus/core`; `BackendSpeechOutput` reports real playback fraction from `AudioContext.currentTime` vs buffer duration every 100 ms; `BrowserSpeechOutput` fallback uses utterance `onboundary` charIndex with a timed safety net.
  - `VoiceController.onSpeechProgress` forwards progress; dashboard typing is now driven by actual speech progress (chars = len × fraction) instead of a guessed duration — typed words appear in sync with the spoken male voice. Text shows only while streaming (generation) or speaking; hidden again when idle/completed. During generation, stream tokens still type live.
- **Creator attribution tightened (this session):** removed "created by Mister Sintayehu Gedfew" from the identity line of all prompts (chat, file analysis, stream) — creator is now stated ONLY when the user explicitly asks who made/built/created NEXUS (EN + AM), with an explicit never-volunteer rule. Verified live: "Hey NEXUS, good morning!" → no creator mention; "Who built you?" → "I was created by Mister Sintayehu Gedfew."
- **New capabilities (this session), all verified live unless noted:**
  - `find_files` (safe): recursive filename search across Desktop/Documents/Downloads/Pictures/Music/Videos, 12 s deadline, 25-result cap. Verified: "find files named awtalgn" → found `awtalgn-report.txt`.
  - `get_system_status` (safe): parallel `wmic` queries (fixed: `path` needs full class names — `win32_processor`/`win32_operatingsystem`/`win32_logicaldisk`) + battery cache. Verified: real CPU 95%, mem 61%/16 GB, disk 327 GB free, battery 70%.
  - `open_app` (sensitive→confirm): resolves via `where.exe` → registry App Paths → Start Menu .lnk scan.
  - `media_control` (sensitive→confirm): mute/vol up/down/next/prev/play-pause via SendKeys. **Not yet live-verified.**
  - `play_youtube` (safe): opens YouTube/YouTube Music search for the query. Verified: "Play Happy by Pharrell Williams" → opened youtube.com results.
  - `open_url` (safe): http(s)-only URL opener.
  - Google Search grounding: `tools:[{googleSearch:{}}]` sent ONLY when the transcript matches search intent (heuristic in chat route); grounding chunks → `displayPayload.sources` rendered as clickable results; code answers → `displayPayload kind:'code'` rendered as a formatted block. **Honest limitation:** Gemini's Google-Search grounding quota is separate and was exhausted on this key (429) — the provider now auto-degrades to a normal answer, and the model itself opened a real Google results page via `open_url` (verified). Sources display will populate when grounding quota is available.
  - `AssistantRequest.webSearch` flag added; `displayPayload` now rendered in dashboard (search sources list + code block + search-query fallback line).
- **Open/show command fixes (this session):**
  - Chat route now runs up to **two tool rounds** so chained actions complete in one request (e.g. `find_files` → `open_file`/`read_file`).
  - New `read_file` tool (safe): reads a located text file (≤2 MB, ~100k chars) — verified live: "find awtalgn-report.txt and read it" → `find_files`+`read_file` both completed, file content rendered on screen.
  - Prompt now requires real results via `displayPayload` for show/search/read/check requests and treats Amharic "ክፈትልኝ" (open) / "አሳየኝ" (show me) like their English equivalents.
  - Dashboard renders **all** displayPayload kinds: search sources, code blocks, plus new generic renderers for `text` (pre block), `list`, and `table` ({columns,rows} or object arrays → real table). Verified: "show my system status" → `get_system_status` + `text` payload rendered in the display area.

## Official brand logo integration (this session)

- Source: `Futuristic NEXUS Orbital App Icon.png` (1254×1254) → `apps/web/public/brand/nexus-logo.png` + `assets/brand/nexus-logo-master.png`.
- **Generated assets** via `tools/generate-brand-icons.ps1` (System.Drawing) and `tools/make-ico.mjs`:
  - Web/PWA PNGs: `apps/web/public/icons/icon-{16,24,32,48,64,128,180,192,256,512}.png`
  - Android legacy: `assets/brand/android/legacy/ic_launcher_{mdpi,hdpi,xhdpi,xxhdpi,xxxhdpi}.png`
  - Android adaptive: `assets/brand/android/adaptive/ic_launcher_foreground.png` (432, 62% safe zone) + `_512` + `ic_launcher_background.png` (#01040d)
  - Windows: `assets/brand/windows/nexus.ico` (16/24/32/48/64/128/256, PNG-compressed entries)
- **Web integration**: favicon + apple-touch-icon + manifest icons (192/512 any + maskable) in `index.html`/`manifest.webmanifest`; `AuthShell` shows the real logo with float + cyan glow pulse; new `SplashScreen` (logo + rotating orbit ring + NEXUS wordmark, fade in/out ~2.6 s) gates app start in `App.tsx`; dashboard header uses the logo.
- **Blocked**: Android APK and Windows desktop builds still impossible — no Java/Android SDK/adb and no Electron/Tauri toolchain on this machine (see Broken/blocked). Icon assets are staged and ready; wrappers remain M6/M7 work.

## Settings rebuild + device control (this session)

- SettingsPage rewritten: removed Voice/Permissions/Privacy/Platform-notes placeholder sections; single sci-fi "Device control" card with real toggles (Hands-free voice — auto-relistens after each answer; Wake word — stored pref, honest M4 note; Media keys; Screen context) + **Lock this PC** button + live **Remembered permissions** chips.
- Backend: new `lock_workstation` tool (sensitive, audited), `POST /voice/lock-workstation`, `GET /voice/permissions` (lists persistent grants).
- `AppSettings` extended (handsFree, wakeWord, mediaControl, screenContext); old voice sliders removed from UI (fields kept for controller defaults).
- Fixed a stray Windows-1252 byte in styles.css that broke the Vite build.

## Permission prompt cap + Settings v2 (this session)

- Permission prompts are now hard-capped at **4 per user+tool** (`permission_prompts` table): asks 1–4 show normally; the 5th+ request is auto-rejected with a clear "reset in Settings" message — no prompt loops. Same-turn duplicate actions count once via `countedPromptTools`.
- `POST /voice/permissions` {tool, action: grant|revoke|reset} — grant/revoke persistent grants and reset prompt counters.
- Settings rebuilt into sections: **Customer Profile** (avatar, name, email, Member role, Sign out), **Device Control** (hands-free, wake voice, media keys — toggle grants/revokes `media_control` live, screen context, Lock now), **Voice & Speech** (male voice + speed/volume sliders), **Privacy & Permissions** (remembered grants with × reset buttons, mic/upload notes), **About NEXUS**. No provider names anywhere.

## Cloud-hosting readiness (this session)

- API binds `0.0.0.0` + `PORT`; CORS accepts comma-separated `CORS_ORIGIN` list; startup **fails fast** if `NODE_ENV=production` with default JWT_SECRET.
- Per-user settings: `user_settings` table + `GET/PUT /voice/settings` (zod-validated) — Settings syncs to the server per account; dashboard pulls remote settings on mount (localStorage remains offline cache).
- PWA verified: manifest (standalone, dark theme, N icons), service worker (navigate→network-first w/ index.html fallback, asset caching), mobile media queries for dashboard + settings.
- `.env.example` documents CORS_ORIGIN multi-origin + NODE_ENV.

## Broken / blocked

- **M1 final acceptance pending one step:** the five-question test must be run by a human voice on a real microphone. Everything upstream (capture → STT → LLM → TTS → playback) is now verified except live human speech in the browser.
- Gemini model availability fluctuates (503 high-demand on flagship models); lite models are stable. Model names are env-configurable if this changes.
- Gemini STT is audio-understanding, not dedicated ASR — per-language accuracy (esp. Amharic) must be validated in `docs/LANGUAGES.md`.
- The API key was pasted into chat — recommend rotating it in Google AI Studio if this transcript may be shared.
- Git not in PATH — version-control commits blocked.
- Java/Android SDK/adb missing — Android (M7) blocked.
- No macOS/Xcode — iOS (M8) documentation only.
- Windows desktop wrapper (M6), Display Panel (M2), wake word (M4), memory/audit UI not started — gated behind M1 acceptance. PC tools currently cover battery/open-file/open-music only; camera/screen/files-browser controls still pending.

## Next

1. Human runs M1 acceptance on `http://localhost:3000`: speak five different general-knowledge questions, verify correct spoken answers.
2. Then M2 Display Panel.
