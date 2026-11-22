import type { ActionResult, AssistantDisplayPayload, NexusState, SpeechOutputProvider } from '@nexus/core';
import { api, ApiError } from '../lib/api';
import { MicrophoneRecorder } from './recorder';

export interface VoiceControllerEvents {
  onState: (state: NexusState, message?: string) => void;
  onLevel: (level: number) => void;
  onTranscript: (text: string, language?: string) => void;
  onDisplayPayload: (payload: AssistantDisplayPayload) => void;
  onAction?: (result: ActionResult) => void;
  onMuted?: (muted: boolean) => void;
  onAnswer?: (text: string) => void;
  onFileContent?: (text: string) => void;
  onStreamToken?: (text: string) => void;
  onSpeechProgress?: (fraction: number) => void;
  onPendingCleared?: () => void;
  onNavigate?: (target: string) => void;
  onError: (message: string) => void;
}

export interface VoiceSettings {
  rate: number;
  volume: number;
}

export class VoiceController {
  private readonly recorder = new MicrophoneRecorder();
  private readonly events: VoiceControllerEvents;
  private readonly primaryOutput: SpeechOutputProvider;
  private readonly fallbackOutput: SpeechOutputProvider;
  private state: NexusState = 'standby';
  private muted = false;
  private operation = 0;
  private sessionId: string | undefined;
  private settings: VoiceSettings;
  private pendingTool: string | null = null;

  constructor(
    events: VoiceControllerEvents,
    primaryOutput: SpeechOutputProvider,
    fallbackOutput: SpeechOutputProvider,
    settings: VoiceSettings = { rate: 1, volume: 1 },
  ) {
    this.events = events;
    this.primaryOutput = primaryOutput;
    this.fallbackOutput = fallbackOutput;
    this.settings = settings;
  }

  getState() {
    return this.state;
  }

  isMuted() {
    return this.muted;
  }

  async toggleMic(): Promise<void> {
    if (this.state === 'listening') {
      this.setMuted(!this.muted);
      return;
    }
    await this.startListening();
  }

  private setMuted(muted: boolean): void {
    this.muted = muted;
    this.recorder.setMuted(muted);
    this.events.onMuted?.(muted);
  }

  setSettings(settings: VoiceSettings) {
    this.settings = settings;
  }

  warmup(): void {
    const output = this.primaryOutput as { warmup?: () => Promise<void> };
    void output.warmup?.().catch(() => undefined);
  }

  async toggleListening(): Promise<void> {
    if (this.state === 'listening') {
      await this.processRecording();
      return;
    }
    await this.startListening();
  }

  async startListening(): Promise<void> {
    if (this.state === 'listening' || this.state === 'processing') return;

    const operation = ++this.operation;
    this.primaryOutput.stop();
    this.fallbackOutput.stop();
    this.setMuted(false);
    this.setState('listening', 'Listening…');

    try {
      await this.recorder.start({
        onLevel: (level) => this.events.onLevel(level),
        onAutoStop: () => {
          void this.processRecording();
        },
        onError: (error) => this.handleError(error, operation),
      });
    } catch (error) {
      this.handleError(error, operation);
    }
  }

  private async processRecording(): Promise<void> {
    if (this.state !== 'listening') return;

    const operation = ++this.operation;
    this.setState('processing', 'Processing…');

    try {
      const audio = await this.recorder.stop();
      if (operation !== this.operation) return;
      if (audio.size === 0) {
        this.fail('No audio was captured. Check the microphone and try again.');
        return;
      }

      const transcription = await api.transcribeAudio(audio, undefined);
      if (operation !== this.operation) return;

      const transcriptText = transcription.text.trim();
      if (!transcriptText) {
        this.setState('standby', 'Ready');
        return;
      }
      this.events.onTranscript(transcriptText, transcription.language);
      if (await this.resolvePendingReply(transcriptText)) return;
      await this.runChat(transcriptText, transcription.language, operation);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'empty-transcript') {
        if (operation === this.operation) this.setState('standby', 'Ready');
        return;
      }
      this.handleError(error, operation);
    }
  }

  setPendingConfirmation(tool: string | null): void {
    this.pendingTool = tool;
  }

  private isAllowReply(text: string): boolean {
    return /^(allow|yes|yeah|yep|y|confirm|confirmed|proceed|okay|ok|sure|do it|go ahead|open it|play it|launch it|open|play|አዎ|እሺ|ፍቀድ|ክፈት)/i.test(text.trim());
  }

  private isDenyReply(text: string): boolean {
    return /^(no|nope|n|cancel|deny|denied|don't|do not|stop|never mind|cancel it|አይ)/i.test(text.trim());
  }

  private async resolvePendingReply(transcript: string): Promise<boolean> {
    const tool = this.pendingTool;
    if (!tool) return false;
    if (!this.isAllowReply(transcript) && !this.isDenyReply(transcript)) {
      return false;
    }
    this.pendingTool = null;
    this.events.onPendingCleared?.();
    if (this.state === 'processing') this.setState('standby', 'Ready');
    if (this.isDenyReply(transcript)) {
      const operation = ++this.operation;
      this.primaryOutput.stop();
      this.fallbackOutput.stop();
      this.setState('processing', 'Processing…');
      await this.speak('Okay, I cancelled that action.', undefined, operation);
      return true;
    }
    await this.confirmAction(tool);
    return true;
  }

  async submitText(text: string): Promise<void> {
    const transcript = text.trim();
    if (!transcript || this.state === 'processing') return;
    if (await this.resolvePendingReply(transcript)) return;

    const operation = ++this.operation;
    this.primaryOutput.stop();
    this.fallbackOutput.stop();
    if (this.state === 'listening') this.recorder.cancel();
    this.setState('processing', 'Processing…');

    try {
      await this.runChat(transcript, undefined, operation);
    } catch (error) {
      this.handleError(error, operation);
    }
  }

  async submitFile(file: File, instruction?: string): Promise<void> {
    if (this.state === 'processing') return;

    const operation = ++this.operation;
    this.primaryOutput.stop();
    this.fallbackOutput.stop();
    if (this.state === 'listening') this.recorder.cancel();
    this.setState('processing', 'Analyzing file…');

    const deliver = async (result: Awaited<ReturnType<typeof api.analyzeFile>>) => {
      if (operation !== this.operation) return;
      this.sessionId = result.sessionId;
      this.events.onAnswer?.(result.answer);
      if (result.correctedContent) {
        this.events.onFileContent?.(result.correctedContent);
      }
      await this.speak(result.answer, result.language, operation);
    };

    let streamedAny = false;
    try {
      const result = await api.analyzeFileStream(file, instruction, this.sessionId, (text) => {
        if (text) streamedAny = true;
        this.events.onStreamToken?.(text);
      });
      await deliver(result);
      return;
    } catch (error) {
      if (streamedAny || operation !== this.operation) {
        this.handleError(error, operation);
        return;
      }
      // Stream endpoint unavailable or failed before any token — fall back to the buffered route.
      try {
        const result = await api.analyzeFile(file, instruction, this.sessionId);
        await deliver(result);
      } catch (fallbackError) {
        this.handleError(fallbackError, operation);
      }
    }
  }

  async confirmAction(tool: string): Promise<void> {
    if (!this.sessionId || this.state === 'processing') return;
    this.pendingTool = null;
    this.events.onPendingCleared?.();

    const operation = ++this.operation;
    this.primaryOutput.stop();
    this.fallbackOutput.stop();
    this.setState('processing', 'Confirming action…');

    try {
      const result = await api.confirmAction(this.sessionId, tool);
      if (operation !== this.operation) return;

      this.sessionId = result.sessionId;
      this.events.onAnswer?.(result.answer);
      for (const actionResult of result.actionResults ?? []) {
        this.events.onAction?.(actionResult);
      }
      await this.speak(result.answer, result.language, operation);
    } catch (error) {
      this.handleError(error, operation);
    }
  }

  private isSettingsRequest(text: string): boolean {
    const mentionsSettings = /\bsettings?\b|ስትንግስ|ማስተካከያ|ቅንብር|ላይ ግባ/i.test(text);
    const hasNavIntent = /\b(open|go|show|launch|enter|take me|navigate|switch to|bring up)\b|ክፈት|ግባ|አሳይ|ውስጥ|ላይ/i.test(text);
    return mentionsSettings && hasNavIntent;
  }

  private async runChat(transcript: string, language: string | undefined, operation: number): Promise<void> {
    if (this.isSettingsRequest(transcript)) {
      this.events.onNavigate?.('settings');
      await this.speak('Opening settings.', language, operation);
      return;
    }
    const result = await api.chat({
      transcript,
      language,
      sessionId: this.sessionId,
    });
    if (operation !== this.operation) return;

    this.sessionId = result.sessionId;
    this.events.onAnswer?.(result.answer);
    for (const actionResult of result.actionResults ?? []) {
      this.events.onAction?.(actionResult);
    }
    const looksLikeCodeRequest = /\b(code|coding|program|script|function|class|debug|fix (this|the|my)?\s*(code|error|bug)|write .* in|implement|refactor|compile|html|css|javascript|typescript|python|java|cpp|c\+\+|sql|regex|algorithm)\b|ኮድ|ፕሮግራም/i.test(transcript);

    // Fallback: if the model put fenced code in the spoken answer instead of a
    // displayPayload, extract it so it renders visually and is never read aloud.
    let displayPayload = result.displayPayload;
    if (looksLikeCodeRequest && displayPayload?.kind !== 'code') {
      const blocks = [...result.answer.matchAll(/```(\w*)\s*\n?([\s\S]*?)```/g)];
      if (blocks.length > 0) {
        displayPayload = {
          kind: 'code',
          title: 'Code',
          data: {
            language: blocks[0]?.[1] || undefined,
            code: blocks.map((block) => block[2]?.trim() ?? '').filter(Boolean).join('\n\n'),
          },
        };
      }
    }
    if (displayPayload) {
      this.events.onDisplayPayload(displayPayload);
    }

    const isCodeResponse = displayPayload?.kind === 'code' || (looksLikeCodeRequest && !result.answer?.trim());
    if (isCodeResponse) {
      // Coding responses are visual-only — never spoken.
      this.completeOperation(operation);
      return;
    }
    await this.speak(result.answer, result.language, operation);
  }

  private async speak(text: string, language: string | undefined, operation: number): Promise<void> {
    if (operation !== this.operation) return;
    this.setState('speaking', 'Speaking…');

    const request = {
      text,
      language,
      rate: this.settings.rate,
      volume: this.settings.volume,
    };

    const onProgress = (fraction: number) => {
      if (operation === this.operation) this.events.onSpeechProgress?.(fraction);
    };

    try {
      await this.primaryOutput.speak(request, {
        onEnd: () => this.completeOperation(operation),
        onError: () => undefined,
        onProgress,
      });
    } catch {
      if (operation !== this.operation) return;
      if (this.primaryOutput.name === this.fallbackOutput.name) {
        this.fail('Speech output failed.');
        return;
      }
      await this.fallbackOutput.speak(request, {
        onEnd: () => this.completeOperation(operation),
        onError: (error) => this.handleError(error, operation),
        onProgress,
      });
    }
  }

  stopSpeech(): void {
    this.operation += 1;
    this.primaryOutput.stop();
    this.fallbackOutput.stop();
    if (this.state === 'speaking' || this.state === 'processing') {
      this.setState('standby', 'Ready');
    }
  }

  emergencyStop(): void {
    this.operation += 1;
    this.pendingTool = null;
    this.events.onPendingCleared?.();
    this.setMuted(false);
    this.recorder.cancel();
    this.primaryOutput.stop();
    this.fallbackOutput.stop();
    this.setState('emergency-stopped', 'Emergency stop engaged');
  }

  dispose(): void {
    this.operation += 1;
    this.muted = false;
    this.recorder.cancel();
    this.primaryOutput.stop();
    this.fallbackOutput.stop();
    this.state = 'standby';
  }

  private completeOperation(operation: number): void {
    if (operation !== this.operation) return;
    this.setState('completed', 'Completed');
    setTimeout(() => {
      if (operation === this.operation) this.setState('standby', 'Ready');
    }, 1400);
  }

  private fail(message: string): void {
    this.setState('error', message);
    this.events.onError(message);
  }

  private handleError(error: unknown, operation: number): void {
    if (operation !== this.operation) return;
    const message = this.errorMessage(error);
    this.setState('error', message);
    this.events.onError(message);
  }

  private errorMessage(error: unknown): string {
    if (error instanceof ApiError) return error.message;
    if (error instanceof DOMException) {
      if (error.name === 'NotAllowedError') return 'Microphone permission denied. Allow microphone access and try again.';
      if (error.name === 'NotFoundError') return 'No microphone was found.';
      if (error.name === 'NotReadableError') return 'The microphone is busy or unavailable.';
      if (error.name === 'AbortError') return 'Recording was interrupted.';
    }
    if (error instanceof Error && error.message) return error.message;
    return 'Voice request failed.';
  }

  private setState(state: NexusState, message?: string): void {
    this.state = state;
    this.events.onState(state, message);
  }
}
