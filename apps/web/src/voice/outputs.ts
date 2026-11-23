import type { SpeechOutputProvider, SpeechRequest } from '@nexus/core';
import { api } from '../lib/api';

let sharedContext: AudioContext | null = null;

export function getSharedAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!sharedContext) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
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

const MALE_VOICE_KEYWORDS = [
  'male',
  'man',
  'david',
  'mark',
  'daniel',
  'james',
  'arthur',
  'george',
  'guy',
  'ryan',
  'aaron',
  'thomas',
  'alex',
  'paul',
  'christopher',
  'eric',
  'jonathan',
  'kevin',
  'steven',
  'andrew',
  'brian',
  'ameha',
];

// የሴት ድምጾች ተለይተው ይታወቁ ዘንድ ብቻ (በፍጹም አይመረጡም)
const FEMALE_VOICE_KEYWORDS = [
  'female',
  'woman',
  'girl',
  'zira',
  'samantha',
  'victoria',
  'karen',
  'moira',
  'tessa',
  'fiona',
  'hazel',
  'aria',
  'jenny',
  'susan',
  'linda',
  'catherine',
  'emma',
  'olivia',
  'ava',
  'chloe',
  'michelle',
  'natasha',
  'mekdes',
  'hedda',
  'katja',
  'amelie',
  'elsa',
  'sara',
  'helena',
  'sonia',
  'libby',
  'allison',
  'joanna',
  'kendra',
  'kimberly',
  'salli',
  'ivy',
];

export class BrowserSpeechOutput implements SpeechOutputProvider {
  readonly name = 'browser-speech-synthesis';
  private voices: SpeechSynthesisVoice[] = [];
  private voicesLoaded = false;

  constructor() {
    if ('speechSynthesis' in window) {
      this.voices = window.speechSynthesis.getVoices();
      this.voicesLoaded = this.voices.length > 0;
      window.speechSynthesis.onvoiceschanged = () => {
        this.voices = window.speechSynthesis.getVoices();
        this.voicesLoaded = this.voices.length > 0;
      };
    }
  }

  private waitForVoices(): Promise<void> {
    if (this.voicesLoaded || !('speechSynthesis' in window)) return Promise.resolve();
    return new Promise((resolve) => {
      const timeout = window.setTimeout(resolve, 1500);
      const previous = window.speechSynthesis.onvoiceschanged;
      window.speechSynthesis.onvoiceschanged = () => {
        previous?.call(window.speechSynthesis, new Event('voiceschanged'));
        this.voices = window.speechSynthesis.getVoices();
        this.voicesLoaded = this.voices.length > 0;
        window.clearTimeout(timeout);
        resolve();
      };
    });
  }

  private isMaleVoice(voice: SpeechSynthesisVoice): boolean {
    const label = `${voice.name} ${voice.voiceURI}`.toLowerCase();
    if (FEMALE_VOICE_KEYWORDS.some((kw) => label.includes(kw))) return false;
    return MALE_VOICE_KEYWORDS.some((kw) => label.includes(kw));
  }

  private isFemaleVoice(voice: SpeechSynthesisVoice): boolean {
    const label = `${voice.name} ${voice.voiceURI}`.toLowerCase();
    return FEMALE_VOICE_KEYWORDS.some((kw) => label.includes(kw));
  }

  /**
   * የወንድ ድምጽ ብቻ ይመርጣል። የሴት ድምጽ በምንም ሁኔታ አይመረጥም።
   * ወንድ ካልተገኘ ሴት ያልሆነ ድምጽ፣ እሱም ከሌለ null (በዚህ ጊዜ ዝቅተኛ pitch ይጠቀማል)።
   */
  private selectMaleVoice(language?: string): SpeechSynthesisVoice | null {
    const nonFemale = this.voices.filter((voice) => !this.isFemaleVoice(voice));
    if (nonFemale.length === 0) return null;

    const normalized = (language ?? '').toLowerCase();
    const prefix = normalized.split('-')[0];

    const langPool = normalized
      ? nonFemale.filter(
          (voice) =>
            voice.lang.toLowerCase() === normalized ||
            (prefix ? voice.lang.toLowerCase().startsWith(prefix) : false),
        )
      : [];

    // 1. በተመረጠው ቋንቋ ውስጥ የወንድ ድምጽ
    const langMale = langPool.find((voice) => this.isMaleVoice(voice));
    if (langMale) return langMale;

    // 2. በሁሉም ቋንቋዎች ውስጥ የወንድ ድምጽ
    const anyMale = nonFemale.find((voice) => this.isMaleVoice(voice));
    if (anyMale) return anyMale;

    // ወንድ ድምጽ ካልተገኘ null — ጠሪው ወደ Backend (ወንድ) ይቀየራል
    return null;
  }

  private readonly fallback = new BackendSpeechOutput();

  async speak(
    request: SpeechRequest,
    callbacks: { onStart?: () => void; onEnd?: () => void; onError?: (error: Error) => void; onProgress?: (fraction: number) => void } = {},
  ): Promise<void> {
    if (!('speechSynthesis' in window)) {
      callbacks.onError?.(new Error('Browser speech synthesis is not available'));
      return;
    }

    await this.waitForVoices();
    window.speechSynthesis.cancel();

    const voice = this.selectMaleVoice(request.language);
    if (!voice) {
      // በዚህ መሳሪያ ላይ ወንድ ድምጽ የለም → ሁልጊዜ ወንድ የሆነውን Backend TTS ተጠቀም
      return this.fallback.speak(request, callbacks);
    }

    return new Promise((resolve, reject) => {
      const utterance = new SpeechSynthesisUtterance(request.text);
      utterance.lang = request.language ?? window.navigator.language;
      utterance.voice = voice;
      utterance.pitch = 0.82;
      utterance.rate = Math.min(2, Math.max(0.5, request.rate ?? 1));
      utterance.volume = Math.min(1, Math.max(0, request.volume ?? 1));

      let settled = false;
      let boundarySeen = false;
      const estimatedMs = Math.min(30000, Math.max(1200, (request.text.length / 14) * 1000));
      const startedAt = performance.now();
      const progressTimer = window.setInterval(() => {
        if (boundarySeen) return;
        callbacks.onProgress?.(Math.min(0.98, (performance.now() - startedAt) / estimatedMs));
      }, 100);

      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        window.clearInterval(progressTimer);
        if (error) {
          callbacks.onError?.(error);
          reject(error);
        } else {
          callbacks.onProgress?.(1);
          callbacks.onEnd?.();
          resolve();
        }
      };

      utterance.onstart = () => {
        callbacks.onStart?.();
        callbacks.onProgress?.(0);
      };
      utterance.onboundary = (event) => {
        if (typeof event.charIndex === 'number' && request.text.length > 0) {
          boundarySeen = true;
          callbacks.onProgress?.(Math.min(0.98, event.charIndex / request.text.length));
        }
      };
      utterance.onend = () => finish();
      utterance.onerror = (event) => {
        if (event.error === 'interrupted' || event.error === 'canceled') finish();
        else finish(new Error(`Speech synthesis failed: ${event.error}`));
      };

      window.speechSynthesis.speak(utterance);
    });
  }

  stop(): void {
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    this.fallback.stop();
  }
}

export class BackendSpeechOutput implements SpeechOutputProvider {
  readonly name = 'backend-tts';
  private source: AudioBufferSourceNode | null = null;
  private context: AudioContext | null = null;
  private progressTimer: number | null = null;
  private generation = 0;

  private reportProgress(context: AudioContext, startedAt: number, duration: number, onProgress?: (fraction: number) => void): void {
    if (this.progressTimer !== null) window.clearInterval(this.progressTimer);
    this.progressTimer = window.setInterval(() => {
      const elapsed = context.currentTime - startedAt;
      onProgress?.(Math.min(1, elapsed / Math.max(duration, 0.001)));
    }, 100);
  }

  private clearProgressTimer(): void {
    if (this.progressTimer !== null) {
      window.clearInterval(this.progressTimer);
      this.progressTimer = null;
    }
  }

  private splitChunks(text: string): string[] {
    const sentences = text.match(/[^.!?…]+[.!?…]+|[^.!?…]+/g) ?? [text];
    const chunks: string[] = [];
    let current = '';
    for (const raw of sentences) {
      const piece = raw.trim();
      if (!piece) continue;
      if (current && (current.length + piece.length + 1) > 240) {
        chunks.push(current);
        current = piece;
      } else {
        current = current ? `${current} ${piece}` : piece;
      }
    }
    if (current) chunks.push(current);
    return chunks.length > 0 ? chunks : [text];
  }

  // ሁልጊዜ ወንድ ድምጽ ብቻ ወደ backend ይላካል
  private maleRequest(request: SpeechRequest, text: string): SpeechRequest {
    return { ...request, gender: 'male', voice: 'male', text } as SpeechRequest;
  }

  async warmup(): Promise<void> {
    try {
      await api.synthesizeSpeech(this.maleRequest({ text: 'OK' } as SpeechRequest, 'OK'));
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
        if (this.source === source) this.source = null;
        if (error) reject(error);
        else resolve();
      };

      source.onended = () => finish();
      try {
        source.start();
        this.reportProgress(context, startedAt, audio.duration, onProgress);
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  async speak(request: SpeechRequest, callbacks: { onStart?: () => void; onEnd?: () => void; onError?: (error: Error) => void; onProgress?: (fraction: number) => void } = {}): Promise<void> {
    this.stop();
    const generation = ++this.generation;
    const context = getSharedAudioContext();
    if (!context) {
      const error = new Error('Web Audio is not available in this browser');
      callbacks.onError?.(error);
      throw error;
    }
    if (context.state === 'suspended') {
      await context.resume().catch(() => undefined);
    }
    if (context.state !== 'running') {
      const error = new Error('Audio playback is blocked. Interact with the page once, then try again.');
      callbacks.onError?.(error);
      throw error;
    }
    this.context = context;

    const chunks = this.splitChunks(request.text);
    const totalChars = Math.max(1, request.text.length);
    const decoded = new Map<number, Promise<AudioBuffer>>();
    const synthesize = (index: number): Promise<AudioBuffer> => {
      if (!decoded.has(index)) {
        decoded.set(
          index,
          api
            .synthesizeSpeech(this.maleRequest(request, chunks[index]!))
            .then((blob) => blob.arrayBuffer())
            .then((buffer) => context.decodeAudioData(buffer)),
        );
      }
      return decoded.get(index)!;
    };
    const prefetch = (from: number) => {
      for (let i = from; i < Math.min(from + 2, chunks.length); i += 1) {
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
        if (i === 0) callbacks.onStart?.();
        await this.playBuffer(audio, (fraction) => {
          callbacks.onProgress?.(Math.min(0.98, (charsBefore + fraction * chunk.length) / totalChars));
        });
        if (generation !== this.generation) return;
      }
      callbacks.onProgress?.(1);
      callbacks.onEnd?.();
    } catch (error) {
      if (generation !== this.generation) return;
      const normalized = error instanceof Error ? error : new Error(String(error));
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
