# Performance

Status: instrumentation not yet implemented (targets for M9).

## Targets

- First spoken word within ~2 s of the user finishing a normal question on a good connection, where providers and hardware permit.
- 60 fps dashboard animation.
- Wake-word detection latency, STT latency, LLM time-to-first-token, TTS latency, and end-to-end latency measured per request.
- API cost per request tracked per provider.
- CPU and memory usage measured on Windows desktop and Android targets.

## Planned instrumentation

- Client: timestamps at recording stop, STT response, chat response, TTS first byte, playback start.
- Server: structured per-request timing logs (no transcripts or secrets in logs beyond what privacy policy allows).
- Results recorded here after each milestone's manual test runs.

No performance numbers are claimed yet — nothing has been measured end-to-end with real providers.
