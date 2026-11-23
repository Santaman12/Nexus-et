
import type { SpeechOutputProvider, SpeechRequest } from '@nexus/core';
import { api } from '../lib/api';

let sharedContext: AudioContext | null = null;

export function getSharedAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;

  if (!sharedContext) {
    const Ctor =
      window.AudioContext ??
      (window as unknown as {
        webkitAudioContext?: typeof AudioContext;
      }).webkitAudioContext;

    if (!Ctor) return null;
    sharedContext = new Ctor();
  }

  return sharedContext;
}

export function unlockAudioPlayback(): void {
  const context = getSharedAudioContext();

  if (context && context.state === 'suspended') {
    void context.resume().catch(() => undefined);
  }
}

/**
 * NEXUS uses backend Gemini TTS only.
 * Browser speech synthesis is disabled.
 * Preferred male voice: Charon.
 */
export class BrowserSpeechOutput implements SpeechOutputProvider {
  readonly name = 'nexus-male-backend-speech';

  private readonly fallback = new BackendSpeechOutput();

  async speak(
    request: SpeechRequest,
    callbacks: {
      onStart?: () => void;
      onEnd?: () => void;
      onError?: (error: Error) => void;
      onProgress?: (fraction: number) => void;
    } = {},
  ): Promise<void> {
    return this.fallback.speak(request, callbacks);
  }

  stop(): void {
    this.fallback.stop();
  }
}

export class BackendSpeechOutput implements SpeechOutputProvider {
  readonly name = 'backend-tts';

  private source: AudioBufferSourceNode | null = null;
  private context: AudioContext | null = null;
  private progressTimer: number | null = null;
  private generation = 0;

  /**
   * Force Gemini TTS to use Charon.
   * Do not allow caller-selected voices to override it.
   */
  private maleRequest(
    request: SpeechRequest,
    text: string,
  ): SpeechRequest {
    return {
      ...request,
      text,
      voice: 'Charon',
    } as SpeechRequest;
  }

  private reportProgress(
    context: AudioContext,
    startedAt: number,
    duration: number,
    onProgress?: (fraction: number) => void,
  ): void {
    this.clearProgressTimer();

    this.progressTimer = window.setInterval(() => {
      const elapsed = context.currentTime - startedAt;

      onProgress?.(
        Math.min(1, elapsed / Math.max(duration, 0.001)),
      );
    }, 100);
  }

  private clearProgressTimer(): void {
    if (this.progressTimer !== null) {
      window.clearInterval(this.progressTimer);
      this.progressTimer = null;
    }
  }

  private splitChunks(text: string): string[] {
    const sentences =
      text.match(/[^.!?…]+[.!?…]+|[^.!?…]+/g) ?? [text];

    const chunks: string[] = [];
    let current = '';

    for (const raw of sentences) {
      const piece = raw.trim();
      if (!piece) continue;

      if (
        current &&
        current.length + piece.length + 1 > 240
      ) {
        chunks.push(current);
        current = piece;
      } else {
        current = current
          ? `${current} ${piece}`
          : piece;
      }
    }

    if (current) chunks.push(current);

    return chunks.length > 0 ? chunks : [text];
  }

  async warmup(): Promise<void> {
    try {
      await api.synthesizeSpeech({
        text: 'NEXUS is ready.',
        language: 'en-US',
        voice: 'Charon',
      });
    } catch {
      // Warmup is best-effort only.
    }
  }

  private playBuffer(
    audio: AudioBuffer,
    onProgress?: (fraction: number) => void,
  ): Promise<void> {
    const context = this.context!;

    return new Promise((resolve, reject) => {
      const source = context.createBufferSource();

      source.buffer = audio;
      source.connect(context.destination);

      this.source = source;

      const startedAt = context.currentTime;
      let settled = false;

      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;

        this.clearProgressTimer();

        if (this.source === source) {
          this.source = null;
        }

        if (error) reject(error);
        else resolve();
      };

      source.onended = () => finish();

      try {
        source.start();

        this.reportProgress(
          context,
          startedAt,
          audio.duration,
          onProgress,
        );
      } catch (error) {
        finish(
          error instanceof Error
            ? error
            : new Error(String(error)),
        );
      }
    });
  }

  async speak(
    request: SpeechRequest,
    callbacks: {
      onStart?: () => void;
      onEnd?: () => void;
      onError?: (error: Error) => void;
      onProgress?: (fraction: number) => void;
    } = {},
  ): Promise<void> {
    this.stop();

    const generation = ++this.generation;

    const context = getSharedAudioContext();

    if (!context) {
      const error = new Error(
        'Web Audio is not available in this browser.',
      );

      callbacks.onError?.(error);
      throw error;
    }

    if (context.state === 'suspended') {
      await context.resume().catch(() => undefined);
    }

    if (context.state !== 'running') {
      const error = new Error(
        'Audio playback is blocked. Interact with the page once, then try again.',
      );

      callbacks.onError?.(error);
      throw error;
    }

    this.context = context;

    const chunks = this.splitChunks(request.text);
    const totalChars = Math.max(1, request.text.length);

    const decoded = new Map<number, Promise<AudioBuffer>>();

    const synthesize = (index: number): Promise<AudioBuffer> => {
      if (!decoded.has(index)) {
        const chunkRequest = this.maleRequest(
          request,
          chunks[index]!,
        );

        decoded.set(
          index,
          api
            .synthesizeSpeech(chunkRequest)
            .then((blob) => blob.arrayBuffer())
            .then((buffer) =>
              context.decodeAudioData(buffer),
            ),
        );
      }

      return decoded.get(index)!;
    };

    const prefetch = (from: number) => {
      for (
        let i = from;
        i < Math.min(from + 2, chunks.length);
        i += 1
      ) {
        void synthesize(i).catch(() => undefined);
      }
    };

    prefetch(0);

    let playedChars = 0;

    try {
      for (let i = 0; i < chunks.length; i += 1) {
        if (generation !== this.generation) return;

        const chunk = chunks[i]!;
        const audio = await synthesize(i);

        if (generation !== this.generation) return;

        prefetch(i + 1);

        const charsBefore = playedChars;
        playedChars += chunk.length;

        if (i === 0) {
          callbacks.onStart?.();
        }

        await this.playBuffer(audio, (fraction) => {
          callbacks.onProgress?.(
            Math.min(
              0.98,
              (charsBefore + fraction * chunk.length) /
                totalChars,
            ),
          );
        });

        if (generation !== this.generation) return;
      }

      callbacks.onProgress?.(1);
      callbacks.onEnd?.();

    } catch (error) {
      if (generation !== this.generation) return;

      const normalized =
        error instanceof Error
          ? error
          : new Error(String(error));

      callbacks.onError?.(normalized);
      throw normalized;
    }
  }

  stop(): void {
    this.generation += 1;

    this.clearProgressTimer();

    try {
      this.source?.stop();
    } catch {
      // Source may already have ended.
    }

    this.source = null;
  }
}
