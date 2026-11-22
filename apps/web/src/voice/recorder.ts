export interface RecorderEvents {
  onLevel: (level: number) => void;
  onAutoStop: () => void;
  onError: (error: Error) => void;
}

const SPEECH_THRESHOLD = 0.012;
const SILENCE_MS = 1100;
const NO_SPEECH_TIMEOUT_MS = 6000;
const MAX_RECORDING_MS = 30000;
const MIN_PEAK_AMPLITUDE = 0.004;

function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const pcm = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    pcm[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
  }

  const buffer = new ArrayBuffer(44 + pcm.length * 2);
  const view = new DataView(buffer);
  const writeString = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i += 1) view.setUint8(offset + i, value.charCodeAt(i));
  };
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + pcm.length * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, pcm.length * 2, true);

  let offset = 44;
  for (let i = 0; i < pcm.length; i += 1) {
    view.setInt16(offset, pcm[i], true);
    offset += 2;
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

export class MicrophoneRecorder {
  private stream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private processor: ScriptProcessorNode | null = null;
  private muteGain: GainNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private filter: BiquadFilterNode | null = null;
  private chunks: Float32Array[] = [];
  private events: RecorderEvents | null = null;
  private animationFrame = 0;
  private startedAt = 0;
  private speechStartedAt: number | null = null;
  private lastSpeechAt = 0;
  private muted = false;
  private stopping = false;
  private cancelled = false;
  private stopPromise: Promise<Blob> | null = null;
  private resolveStop: ((blob: Blob) => void) | null = null;
  private peak = 0;

  get isRecording() {
    return Boolean(this.audioContext && this.processor);
  }

  get isMuted() {
    return this.muted;
  }

  async start(events: RecorderEvents): Promise<void> {
    if (this.isRecording) return;

    this.events = events;
    this.muted = false;
    this.stopping = false;
    this.cancelled = false;
    this.chunks = [];
    this.peak = 0;
    this.startedAt = Date.now();
    this.speechStartedAt = null;
    this.lastSpeechAt = 0;

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        noiseSuppression: true,
        echoCancellation: true,
        autoGainControl: true,
      },
    });

    this.audioContext = new AudioContext();
    this.source = this.audioContext.createMediaStreamSource(this.stream);

    this.filter = this.audioContext.createBiquadFilter();
    this.filter.type = 'highpass';
    this.filter.frequency.value = 90;
    this.filter.Q.value = 0.7;

    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 512;

    this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);
    this.processor.onaudioprocess = (event) => {
      if (this.muted || this.cancelled) return;
      const input = event.inputBuffer.getChannelData(0);
      const copy = new Float32Array(input.length);
      copy.set(input);
      this.chunks.push(copy);
      for (let i = 0; i < copy.length; i += 1) {
        const magnitude = Math.abs(copy[i]);
        if (magnitude > this.peak) this.peak = magnitude;
      }
    };

    this.source.connect(this.filter);
    this.filter.connect(this.analyser);
    this.filter.connect(this.processor);
    this.muteGain = this.audioContext.createGain();
    this.muteGain.gain.value = 0;
    this.processor.connect(this.muteGain);
    this.muteGain.connect(this.audioContext.destination);

    this.stopPromise = new Promise<Blob>((resolve) => {
      this.resolveStop = resolve;
    });

    this.animationFrame = requestAnimationFrame(this.monitorAudio);
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
  }

  async stop(): Promise<Blob> {
    if (!this.isRecording) {
      return this.stopPromise ?? Promise.resolve(new Blob());
    }

    this.stopping = true;
    this.finishCapture();
    return this.stopPromise ?? Promise.resolve(new Blob());
  }

  cancel(): void {
    this.cancelled = true;
    this.stopping = true;
    this.muted = false;
    this.finishCapture();
  }

  private finishCapture(): void {
    cancelAnimationFrame(this.animationFrame);

    const sampleRate = this.audioContext?.sampleRate ?? 48000;
    let blob: Blob;
    if (!this.cancelled && this.peak >= MIN_PEAK_AMPLITUDE) {
      const total = this.chunks.reduce((sum, chunk) => sum + chunk.length, 0);
      const samples = new Float32Array(total);
      let offset = 0;
      for (const chunk of this.chunks) {
        samples.set(chunk, offset);
        offset += chunk.length;
      }
      blob = encodeWav(samples, sampleRate);
    } else {
      blob = new Blob();
    }

    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.source?.disconnect();
    this.filter?.disconnect();
    this.analyser?.disconnect();
    this.processor?.disconnect();
    this.muteGain?.disconnect();
    this.processor = null;
    this.muteGain = null;
    this.source = null;
    this.filter = null;
    this.analyser = null;
    void this.audioContext?.close().catch(() => undefined);
    this.audioContext = null;
    this.chunks = [];
    this.events = null;

    this.resolveStop?.(blob);
    this.resolveStop = null;
  }

  private monitorAudio = () => {
    if (!this.isRecording || !this.analyser) return;

    if (this.muted) {
      this.events?.onLevel(0);
      this.animationFrame = requestAnimationFrame(this.monitorAudio);
      return;
    }

    const data = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteTimeDomainData(data);
    let sum = 0;
    for (const value of data) {
      const centered = (value - 128) / 128;
      sum += centered * centered;
    }
    const level = Math.sqrt(sum / data.length);
    this.events?.onLevel(level);

    const now = Date.now();
    const elapsed = now - this.startedAt;
    if (level > SPEECH_THRESHOLD) {
      this.lastSpeechAt = now;
      this.speechStartedAt ??= now;
    }

    const hasSpeech = this.speechStartedAt !== null;
    const speechDuration = hasSpeech ? now - this.speechStartedAt! : 0;
    const silenceDuration = hasSpeech ? now - this.lastSpeechAt : 0;

    if (
      elapsed > MAX_RECORDING_MS ||
      (hasSpeech && speechDuration > 400 && silenceDuration > SILENCE_MS) ||
      (!hasSpeech && elapsed > NO_SPEECH_TIMEOUT_MS)
    ) {
      this.events?.onAutoStop();
      return;
    }

    this.animationFrame = requestAnimationFrame(this.monitorAudio);
  };
}
