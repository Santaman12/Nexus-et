# Offline Capabilities

Status: current build (M1). "Offline" means no internet connectivity.

| Feature | Status | Notes |
|---|---|---|
| Dashboard render, navigation, settings UI | Works offline | Static PWA assets; service worker caches app shell |
| Push-to-talk microphone capture + VAD | Works offline | Capture is local; only fails at the STT upload step |
| On-device wake word | Planned (M4) | Requires bundled on-device model; not yet implemented |
| Speech-to-text | Requires internet | Gemini/OpenAI STT are cloud APIs |
| Language model answers | Requires internet | Gemini/OpenAI are cloud APIs |
| Text-to-speech | Partially works offline | Browser `speechSynthesis` fallback works offline; backend TTS requires internet |
| Display Panel | Partially works offline | Can render cached/local payloads; live content needs internet |
| Local file listing/search | Planned (M5/M6) | Will run on-device for desktop builds |
| Reminders/alarms | Planned | OS-level scheduling works offline on Android/Windows |
| Web search / weather / news / maps | Requires internet | Honest offline message required |
| Windows app launch, battery, storage, volume | Planned (M6) | Native bridge runs locally once installed |
| Android intents, reminders, calls | Planned (M7) | OS APIs work offline; confirmation UX required |

Rule: any cloud-dependent feature must say so honestly by voice/text when the network is unavailable. Nothing may pretend an online service worked offline.
