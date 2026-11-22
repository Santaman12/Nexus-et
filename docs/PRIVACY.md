# Privacy Policy (in-app summary)

NEXUS is a voice-first assistant. This document describes what data moves where.

## What is collected

- Account data you provide: name, email, password (hashed), session tokens.
- Voice audio, only while you are actively listening (push-to-talk today; wake word in M4).
- Transcripts and assistant answers, stored as session context to support follow-ups like "and tomorrow?".
- Settings you choose (voice speed, volume, heard-caption toggle).

## What is sent to providers

| Data | Destination | Purpose |
|---|---|---|
| Audio recording | Configured STT provider (Gemini by default) | Transcription |
| Transcript + session context | Configured LLM (Gemini by default) | Answer generation |
| Answer text | Configured TTS provider or browser speech synthesis | Spoken reply |

Provider choice is backend configuration; keys never reach the app or APK.

## What is NOT done

- No audio is recorded or transmitted while NEXUS is off or before activation.
- No always-on background listening exists in the current build.
- No analytics, advertising, or third-party tracking.
- Memory storage is opt-in (M5) and user-deletable.

## Your controls

- Sign out ends the session; refresh tokens can be revoked.
- Emergency Stop halts all current activity.
- Settings show exactly which providers are configured.
- Delete-account and memory-deletion flows arrive with M5/M9.
