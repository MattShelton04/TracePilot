import type { CaptureProtocol } from "@tracepilot/types";

export const CONTEXT_CAPTURE_PROTOCOL_LABELS: Record<CaptureProtocol, string> = {
  openAiResponses: "OpenAI Responses",
  openAiChatCompletions: "OpenAI Chat Completions",
  anthropicMessages: "Anthropic Messages",
};

export const CONTEXT_CAPTURE_PROTOCOL_OPTIONS = (
  Object.entries(CONTEXT_CAPTURE_PROTOCOL_LABELS) as Array<[CaptureProtocol, string]>
).map(([value, label]) => ({ value, label }));

export const CONTEXT_CAPTURE_PROTOCOL_GUIDANCE: Record<CaptureProtocol, string> = {
  openAiResponses:
    "Uses POST /v1/responses with top-level instructions and an ordered input array. This is the usual format for GPT-5-family models and can carry reasoning and output controls.",
  openAiChatCompletions:
    "Uses POST /v1/chat/completions with one ordered messages array, including system messages. This is the established OpenAI-compatible format used by many local and third-party models.",
  anthropicMessages:
    "Uses POST /v1/messages with a separate system field and ordered messages. Tool schemas and thinking/output controls use Anthropic's request shape.",
};
