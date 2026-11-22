import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SpeechOutputProvider, SpeechRequest } from '@nexus/core';
import { VoiceController } from './voiceController';

const recorderStart = vi.fn();
const recorderStop = vi.fn();
const recorderCancel = vi.fn();
const recorderSetMuted = vi.fn();

vi.mock('./recorder', () => ({
  MicrophoneRecorder: class {
    start = recorderStart;
    stop = recorderStop;
    cancel = recorderCancel;
    setMuted = recorderSetMuted;
  },
}));

const transcribeAudio = vi.fn();
const chat = vi.fn();
const synthesizeSpeech = vi.fn();

vi.mock('../lib/api', () => ({
  api: {
    transcribeAudio: (...args: unknown[]) => transcribeAudio(...args),
    chat: (...args: unknown[]) => chat(...args),
    synthesizeSpeech: (...args: unknown[]) => synthesizeSpeech(...args),
  },
  ApiError: class ApiError extends Error {
    constructor(public status: number, public code: string, message: string) {
      super(message);
    }
  },
}));

function makeOutput(name: string): SpeechOutputProvider {
  return {
    name,
    speak: vi.fn(async (_request: SpeechRequest, callbacks?: { onEnd?: () => void }) => {
      callbacks?.onEnd?.();
    }),
    stop: vi.fn(),
  };
}

function makeController() {
  const events = {
    onState: vi.fn(),
    onLevel: vi.fn(),
    onTranscript: vi.fn(),
    onDisplayPayload: vi.fn(),
    onError: vi.fn(),
  };
  const primary = makeOutput('primary');
  const fallback = makeOutput('fallback');
  const controller = new VoiceController(events, primary, fallback, { rate: 1, volume: 1 });
  return { controller, events, primary, fallback };
}

describe('VoiceController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    recorderStart.mockResolvedValue(undefined);
    recorderStop.mockResolvedValue(new Blob(['audio'], { type: 'audio/webm' }));
    transcribeAudio.mockResolvedValue({ text: 'What is the capital of France?', language: 'en-US' });
    chat.mockResolvedValue({
      answer: 'Paris.',
      language: 'en-US',
      sessionId: 'session-1',
    });
  });

  it('runs the full listen → transcribe → chat → speak pipeline', async () => {
    const { controller, events, primary } = makeController();

    await controller.startListening();
    expect(controller.getState()).toBe('listening');
    expect(recorderStart).toHaveBeenCalledTimes(1);

    await controller.toggleListening();
    expect(recorderStop).toHaveBeenCalledTimes(1);
    expect(transcribeAudio).toHaveBeenCalledTimes(1);
    expect(chat).toHaveBeenCalledWith(
      expect.objectContaining({ transcript: 'What is the capital of France?', language: 'en-US' }),
    );
    expect(primary.speak).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Paris.' }),
      expect.anything(),
    );
    expect(events.onTranscript).toHaveBeenCalledWith('What is the capital of France?', 'en-US');
    expect(events.onState).toHaveBeenLastCalledWith('completed', 'Completed');
  });

  it('surfaces provider errors honestly and returns to an error state', async () => {
    const { ApiError } = await import('../lib/api');
    chat.mockRejectedValue(new ApiError(503, 'provider-not-configured', 'Set GEMINI_API_KEY on the backend.'));
    const { controller, events } = makeController();

    await controller.startListening();
    await controller.toggleListening();

    expect(controller.getState()).toBe('error');
    expect(events.onError).toHaveBeenCalledWith('Set GEMINI_API_KEY on the backend.');
  });

  it('mute toggle keeps the recording session alive', async () => {
    const { controller } = makeController();

    await controller.startListening();
    await controller.toggleMic();
    expect(controller.isMuted()).toBe(true);
    expect(recorderSetMuted).toHaveBeenCalledWith(true);
    expect(recorderCancel).not.toHaveBeenCalled();
    expect(controller.getState()).toBe('listening');

    await controller.toggleMic();
    expect(controller.isMuted()).toBe(false);
    expect(controller.getState()).toBe('listening');
  });

  it('emergency stop cancels recording and speech without emitting a fake success', async () => {
    const { controller, primary, fallback } = makeController();

    await controller.startListening();
    controller.emergencyStop();

    expect(recorderCancel).toHaveBeenCalledTimes(1);
    expect(primary.stop).toHaveBeenCalled();
    expect(fallback.stop).toHaveBeenCalled();
    expect(controller.getState()).toBe('emergency-stopped');
  });
});
