export type NexusState =
  | 'booting'
  | 'standby'
  | 'listening'
  | 'processing'
  | 'planning'
  | 'requesting-permission'
  | 'waiting-for-user'
  | 'executing'
  | 'speaking'
  | 'completed'
  | 'error'
  | 'emergency-stopped';

export interface AudioInput {
  data: Uint8Array;
  filename: string;
  mimeType: string;
  languageHint?: string;
}

export interface TranscriptionResult {
  text: string;
  language: string;
  confidence?: number;
  durationMs?: number;
}

export interface SpeechToTextProvider {
  readonly name: string;
  transcribe(input: AudioInput): Promise<TranscriptionResult>;
}

export interface AssistantDisplayPayload {
  kind: 'text' | 'list' | 'table' | 'weather' | 'news' | 'search' | 'media' | 'code' | 'image' | 'map';
  title?: string;
  data: unknown;
  sources?: Array<{ title: string; url: string }>;
}

export interface AssistantMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AssistantRequest {
  transcript: string;
  language?: string;
  sessionId?: string;
  history?: AssistantMessage[];
  approvedMemory?: Record<string, unknown>;
  availableTools?: string[];
  toolCatalog?: string;
  /** When true, the model may use Google Search grounding for this request. */
  webSearch?: boolean;
}

export type ToolRisk = 'safe' | 'sensitive' | 'dangerous';

export interface AssistantAction {
  tool: string;
  arguments: Record<string, unknown>;
}

export interface ActionResult {
  tool: string;
  status: 'completed' | 'needs-confirmation' | 'rejected' | 'error';
  output?: unknown;
  message?: string;
}

export interface AssistantResult {
  answer: string;
  language: string;
  sessionId: string;
  displayPayload?: AssistantDisplayPayload;
  actions?: AssistantAction[];
  actionResults?: ActionResult[];
}

export interface LanguageModelProvider {
  readonly name: string;
  respond(request: AssistantRequest): Promise<AssistantResult>;
}

export interface SpeechRequest {
  text: string;
  language?: string;
  voice?: string;
  rate?: number;
  volume?: number;
}

export interface SynthesizedSpeech {
  audio: Uint8Array;
  mimeType: string;
}

export interface TextToSpeechProvider {
  readonly name: string;
  synthesize(request: SpeechRequest): Promise<SynthesizedSpeech>;
}

export interface SpeechCallbacks {
  onStart?: () => void;
  onEnd?: () => void;
  onError?: (error: Error) => void;
  /** Playback progress as a fraction 0..1, used to sync on-screen typing with speech. */
  onProgress?: (fraction: number) => void;
}

export interface SpeechOutputProvider {
  readonly name: string;
  speak(request: SpeechRequest, callbacks?: SpeechCallbacks): Promise<void>;
  stop(): void;
}

export interface WakeWordCallbacks {
  onWake: () => void;
  onError?: (error: Error) => void;
}

export interface WakeWordProvider {
  readonly name: string;
  isAvailable(): boolean;
  start(callbacks: WakeWordCallbacks): Promise<void> | void;
  stop(): void;
}
