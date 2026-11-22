# Environment Audit

Date: 2026-11-21

## Host

- OS: Windows
- Workspace: `C:\Sintayehu Nexus`
- Shell observed: PowerShell

## Runtime tools

| Tool | Status | Notes |
|---|---:|---|
| Node.js | Installed | `v24.21.0` |
| npm | Installed | `11.19.0` |
| pnpm | Missing | Not installed |
| Yarn | Missing | Not installed |
| Bun | Missing | Not installed |
| Docker | Installed | `29.8.0` |
| Docker Compose | Installed | `v5.5.1` |
| Java | Missing | Required for some Android tooling later |
| adb | Missing | Android platform tools not installed |
| Git | Missing from PATH | Version-control deliverable is currently blocked until Git is installed or restored |
| Python | Missing | Only the Windows Store alias is present |

## Audio hardware

- `Realtek High Definition Audio`: OK
- `Realtek(R) Audio`: OK
- Headset endpoints `Q3`, `Q3 Hands-Free`, `P9`, `P9 Hands-Free`: OK

A physical microphone test is still required; device presence does not prove capture quality.

## Browser

Microsoft Edge is installed. A CDP probe against a localhost page reported:

- `window.SpeechRecognition`: function
- `window.webkitSpeechRecognition`: function
- `navigator.mediaDevices.getUserMedia`: function
- Secure context on `http://localhost`: true
- Microphone permission state before user grant: `prompt`

Browser `SpeechRecognition` may still be cloud/provider dependent and is not a substitute for the planned on-device wake-word engine.

## Provider credentials

The owner selected **Google Gemini** as the primary AI provider. `GEMINI_API_KEY` is configured in `services/api/.env` (git-ignored, never committed or logged).

Verified working configuration (2026-11-21): `gemini-3.5-flash-lite` for chat/STT and `gemini-3.8-flash-tts` for TTS. Real API smoke test passed: chat answer, TTS audio (115 KB WAV), and STT round-trip transcription of the synthesized speech.

## Platform limitations

- Windows desktop tray/global-shortcut work requires a desktop wrapper and native bridge; not implemented yet.
- Android work requires Java/Android SDK/adb or an alternative documented toolchain; currently missing.
- iOS build/signing requires macOS with Xcode and an Apple developer account; not available on this Windows host.
- Browser wake-word listening is limited to an open, focused page with microphone permission and is not reliable always-on listening.
