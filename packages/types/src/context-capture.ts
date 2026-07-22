export type CaptureProtocol = "openAiChatCompletions" | "openAiResponses" | "anthropicMessages";

export interface SourceEventsFingerprint {
  bytes: number;
  modifiedUnixMs: number;
  sha256: string;
}

export interface CliCapabilities {
  executable: string;
  version: string;
  supportsResume: boolean;
  supportsPrompt: boolean;
  supportsJsonOutput: boolean;
  supportsOffline: boolean;
  supportsByokRouting: boolean;
  supportsRequiredSafetyFlags: boolean;
  missingCapabilities: string[];
}

export interface CapturePreflight {
  sourceSessionId: string;
  inactive: boolean;
  sourceSizeBytes: number;
  sourceFileCount: number;
  storageWritable: boolean;
  sourceEventsFingerprint: SourceEventsFingerprint;
  workingDirectory: string;
  workingDirectoryExists: boolean;
  cli: CliCapabilities;
  sourceCliVersion?: string | null;
  model: string;
  protocol: CaptureProtocol;
  protocolDetectionSource: string;
  protocolOptions: CaptureProtocol[];
  captureProfile: "isolated";
  includedResources: string[];
  omittedResources: string[];
  warnings: string[];
  canCapture: boolean;
}

export interface StartCaptureRequest {
  sessionId: string;
  protocol: CaptureProtocol;
  save: boolean;
  allowDegradedFidelity: boolean;
}

export type CaptureStage =
  | "preflight"
  | "copyingSession"
  | "startingListener"
  | "resumingClone"
  | "waitingForRequest"
  | "parsingSnapshot"
  | "savingSnapshot"
  | "cleaningUp"
  | "complete"
  | "cancelled";

export interface CaptureProgress {
  captureId: string;
  sessionId: string;
  stage: CaptureStage;
  message: string;
  bytesCopied?: number | null;
  totalBytes?: number | null;
  cancellable: boolean;
}

export interface FidelityManifest {
  profile: string;
  includedResources: string[];
  omittedResources: string[];
  workingDirectory: string;
  workingDirectoryFallback: boolean;
  sourceUnchanged: boolean;
}

export interface NormalizedSection {
  index: number;
  source: string;
  content: unknown;
  bytes: number;
  characters: number;
  containsProbe: boolean;
}

export interface NormalizedMessage {
  index: number;
  role?: string | null;
  itemType?: string | null;
  content: unknown;
  raw: unknown;
  bytes: number;
  characters: number;
  isProbe: boolean;
}

export interface NormalizedToolDefinition {
  index: number;
  name?: string | null;
  description?: string | null;
  schema?: unknown | null;
  raw: unknown;
  bytes: number;
  characters: number;
}

export interface NormalizedAttachment {
  messageIndex: number;
  contentIndex?: number | null;
  kind: string;
  raw: unknown;
  bytes: number;
  characters: number;
}

export interface SectionMetrics {
  systemBytes: number;
  systemCharacters: number;
  messageBytes: number;
  messageCharacters: number;
  toolBytes: number;
  toolCharacters: number;
  controlsBytes: number;
  controlsCharacters: number;
}

export interface ParsedContextRequest {
  model?: string | null;
  systemBlocks: NormalizedSection[];
  messages: NormalizedMessage[];
  toolDefinitions: NormalizedToolDefinition[];
  requestControls: Record<string, unknown>;
  attachments: NormalizedAttachment[];
  probeMessageIndices: number[];
  unknownFields: Record<string, unknown>;
  sectionMetrics: SectionMetrics;
  warnings: string[];
}

export interface ContextCaptureManifest {
  schemaVersion: number;
  captureId: string;
  sourceSessionId: string;
  capturedAt: string;
  sourceEventsFingerprint: SourceEventsFingerprint;
  cliVersion: string;
  captureProfile: string;
  protocol: CaptureProtocol;
  protocolDetectionSource: string;
  requestPath: string;
  contentType: string;
  rawBodySha256: string;
  rawBodyBytes: number;
  rawBodyCharacters: number;
  estimatedTokens: number;
  probeNonce: string;
  fidelityManifest: FidelityManifest;
  warnings: string[];
  safeHeaderNames: string[];
  saved: boolean;
  parsed: ParsedContextRequest;
}

export interface ContextCaptureSnapshot {
  manifest: ContextCaptureManifest;
  rawBody: string;
}

export interface ContextCaptureSummary {
  captureId: string;
  sourceSessionId: string;
  capturedAt: string;
  model?: string | null;
  protocol: CaptureProtocol;
  rawBodyBytes: number;
  messageCount: number;
  toolCount: number;
  saved: boolean;
  warningCount: number;
}

export interface ContextCaptureStorageStats {
  captureCount: number;
  totalBytes: number;
}
