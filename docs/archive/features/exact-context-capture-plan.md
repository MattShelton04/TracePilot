# Exact Context Capture — Feasibility, Product Scope, and Implementation Plan

Status: proposed; Phase 0 recommended before product implementation.

Research date: 2026-07-22.

## Product decision

TracePilot should add an experimental **Captured Request Snapshot** feature to
the existing session **Context** tab.

The feature will make a private copy of an inactive Copilot CLI session, resume
that copy inside an isolated temporary `COPILOT_HOME`, redirect the copied
session's model request to a one-shot loopback listener, and preserve the JSON
request body for inspection. The listener must never forward the request to a
real model provider.

The product claim must be precise:

> This is the exact model API request body produced by the installed Copilot
> CLI for this capture run.

It is **not**:

- the exact request from an earlier historical turn;
- proof of the provider's final server-side model input;
- a guarantee that the capture run is identical to the original interactive
  environment;
- an exact per-section token ledger.

Those boundaries are essential. Capturing the actual loopback POST body is
stronger than reconstructing context from `events.jsonl`, but resuming a clone
adds a probe message and occurs under the current CLI, filesystem, instruction,
tool, and configuration state.

The initial release should support one current-state snapshot at a time for an
inactive local session. It should not attempt arbitrary historical-turn replay,
live-session interception, request forwarding, or automatic batch capture.

## Refined feature brief

> Add an on-demand forensic context capture to TracePilot. From a session's
> Context tab, a user can run a preflight, create an isolated copy of the
> selected session, resume the copy with the installed Copilot CLI, and route a
> single model request to a TracePilot-owned loopback capture endpoint. Capture
> and parse the exact JSON payload generated for that run, clearly separate
> system instructions, conversation messages, tool definitions, request
> controls, attachments, and the synthetic probe message, and let the user
> inspect the raw body and compare saved snapshots. Never modify the source
> session or forward its context to a model provider. Record capture fidelity,
> provenance, CLI version, protocol, hashes, and limitations. Treat token
> weights as observed, tokenizer-computed, or estimated according to their real
> source; never label byte-derived or reconstructed values as exact tokens.

## Executive answer

The feature is feasible with the currently installed Copilot CLI 1.0.71.

GitHub officially supports redirecting Copilot CLI to a custom provider with
`COPILOT_PROVIDER_BASE_URL`. Supported provider types include OpenAI-compatible,
Azure, and Anthropic endpoints. Models must support streaming and tool calling.
The CLI also supports `COPILOT_HOME`, explicit session resume, non-interactive
prompt mode, offline mode, and secret environment isolation. See:

- [Using your own LLM models in GitHub Copilot CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/use-byok-models)
- [GitHub Copilot CLI command reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference)
- [Best practices for GitHub Copilot CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli/cli-best-practices)

An isolated local spike proved that:

1. a loopback OpenAI-compatible listener receives the complete request body;
2. a copied session directory can be resumed under the same session ID inside
   a separate temporary `COPILOT_HOME`;
3. the original Copilot home and source session do not need to be used as the
   write target;
4. OpenAI Chat Completions, OpenAI Responses, and Anthropic Messages use
   distinct paths and payload shapes;
5. Copilot's new OpenTelemetry content capture is valuable corroborating data,
   but it is normalized and is not a substitute for the wire payload.

The previously proposed BYOK Provider Profiles feature is **not a prerequisite**.
This capture flow needs no user's provider credential and no real model. It
should build a small internal capability probe and wire-protocol adapter that a
future Provider Profiles implementation can also reuse.

## Why this belongs in TracePilot

TracePilot already has three related levels of evidence:

| Evidence | Current source | Strength | Limitation |
| --- | --- | --- | --- |
| Session history | `events.jsonl`, checkpoints, `session.db` | Best record of what happened | Not a lossless model request |
| Context pressure | Context Window Analyzer | Exact Copilot layer anchors plus clearly marked estimates | Does not reveal exact per-request composition |
| Captured request snapshot | Proposed loopback capture | Exact client request body for one controlled run | Active, current-state experiment rather than historical replay |

The new feature should complement the implemented Context Window Analyzer. The
timeline answers “how context pressure changed”; a captured snapshot answers
“what the CLI serialized into this controlled request.”

This creates useful workflows that TracePilot cannot support from event parsing
alone:

- audit hidden or dynamically assembled system instructions;
- inspect the precise conversation representation after compaction;
- measure tool-schema bulk and compare enabled tool sets;
- see which tool results remain in the serialized history;
- debug differences between CLI versions or wire APIs;
- compare snapshots before and after configuration, instruction, MCP, or model
  changes;
- validate TracePilot's event-derived context estimates against a real request.

## User stories

### Inspect the current serialized context

> I want to know exactly what Copilot CLI would send now if I continued this
> session, without modifying the real session or contacting a model provider.

Expected behavior:

- TracePilot confirms the source session is inactive;
- a preflight explains the current model, detected wire protocol, working
  directory, CLI version, and fidelity caveats;
- the user starts one isolated capture;
- the source session remains byte-for-byte unchanged;
- the resulting snapshot opens in the Context tab.

### Audit context composition

> I want system instructions, message history, tools, and the probe message
> separated so I can understand where the payload comes from.

Expected behavior:

- each section reports exact byte and character size;
- messages retain their on-wire order and role;
- tools show name, description, and JSON schema;
- the raw request body remains available as the source of truth;
- unknown protocol fields are preserved rather than discarded.

### Compare snapshots

> I want to see what changed after compaction, a CLI update, or an MCP/config
> change.

Expected behavior:

- saved captures record source-session and CLI fingerprints;
- a comparison distinguishes added/removed/changed messages, instructions,
  tools, and request parameters;
- dynamic values such as timestamps are optionally ignored in semantic diffs
  but remain present in raw diffs.

### Understand confidence

> I do not want a byte count or heuristic tokenizer result presented as an
> exact provider token count.

Expected behavior:

- every metric has a source label;
- exact raw byte/character measurements are distinct from tokens;
- provider-observed, official-count-API, local-tokenizer, and estimated token
  values use visibly different labels.

## Evidence and findings

### Official CLI capabilities

The public BYOK documentation states that:

- `COPILOT_PROVIDER_BASE_URL` activates the custom route;
- `openai`, `azure`, and `anthropic` provider types are supported;
- OpenAI-compatible endpoints include Ollama, vLLM, Foundry Local, and other
  Chat Completions-compatible services;
- streaming and tool calling are required;
- a context window of at least 128k is recommended;
- `COPILOT_OFFLINE=true` prevents GitHub traffic, but a remote custom provider
  still receives prompts and code.

The installed 1.0.71 help additionally exposes:

```text
COPILOT_PROVIDER_WIRE_API=completions|responses
COPILOT_PROVIDER_MODEL_ID
COPILOT_PROVIDER_WIRE_MODEL
COPILOT_PROVIDER_MAX_PROMPT_TOKENS
COPILOT_PROVIDER_MAX_OUTPUT_TOKENS
COPILOT_HOME
COPILOT_OTEL_FILE_EXPORTER_PATH
OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT
```

The implementation should capability-probe the installed runtime rather than
hard-code 1.0.71. The public release observed during research was 1.0.74-0, so
this surface is actively evolving. See the
[Copilot CLI releases](https://github.com/github/copilot-cli/releases) and
[changelog](https://github.com/github/copilot-cli/blob/main/changelog.md).

### Isolated empirical spike

All experiments used a generated temporary `COPILOT_HOME`, an empty temporary
workspace, a loopback listener, offline mode, no real API key, and no real model
provider. No repository content or existing user session was sent anywhere.

#### New OpenAI Chat Completions capture

Copilot CLI posted:

```text
POST /v1/chat/completions
Content-Type: application/json
Body: 54,853 bytes
Messages: system, user
Tool definitions: 16
Streaming: true
```

Observed top-level fields were:

```text
model
messages
temperature
top_p
frequency_penalty
presence_penalty
parallel_tool_calls
tools
stream
stream_options
```

A minimal valid SSE completion returned by the listener allowed the CLI to exit
normally. This proves a full mock is possible for Chat Completions, but it is
not the recommended product design across all protocols.

#### Copied-session resume

The synthetic session directory was copied into:

```text
<temporary-copilot-home>/session-state/<same-session-id>/
```

No source `session-store.db` was copied. Running
`copilot --resume=<same-session-id> -p <probe>` succeeded, generated a fresh
temporary global catalogue, and posted a request whose roles were:

```text
system, user, assistant, user
```

The clone received `session.resume`, the capture turn, and `session.shutdown`
events. The source session remained outside the temporary write root.

This supports a simpler and safer design than assigning a new CLI session ID:
retain the source ID inside an isolated home and assign a separate TracePilot
capture ID. Rewriting `workspace.yaml`, event IDs, checkpoints, or SQLite data
is unnecessary and would add corruption risk.

#### Protocol shape checks

The installed CLI produced these request families:

| Adapter | Request path | Relevant top-level fields observed |
| --- | --- | --- |
| OpenAI Chat Completions | `/v1/chat/completions` | `model`, `messages`, `tools`, sampling controls, `stream` |
| OpenAI Responses | `/v1/responses` | `model`, `instructions`, `input`, `tools`, `reasoning`, `prompt_cache_key`, `max_output_tokens`, `store`, `include`, `stream` |
| Anthropic Messages | `/v1/messages` | `model`, `max_tokens`, `system`, `messages`, `tools`, `temperature`, `thinking`, `stream` |

The Anthropic SDK appends `/v1/messages` to a host-style base URL. Supplying an
Anthropic base URL that already ended in `/v1` produced `/v1/v1/messages` in the
spike. Base-URL construction must therefore be owned by a protocol adapter, not
one generic string template.

#### OpenTelemetry is useful but not wire-exact

Copilot CLI now officially supports local OpenTelemetry JSONL export and
content capture. Its documentation says content capture populates
`gen_ai.input.messages`, `gen_ai.system_instructions`,
`gen_ai.tool.definitions`, tool arguments, and tool results. See the
[OpenTelemetry section of the CLI command reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference#opentelemetry-monitoring)
and the [OpenTelemetry GenAI semantic conventions](https://opentelemetry.io/docs/specs/semconv/registry/attributes/gen-ai/).

The spike produced 14 OTel JSONL records totaling 124,596 bytes and included
the documented content attributes. However, OTel normalized the current user
message to the original prompt text, while the actual HTTP request contained
Copilot's transformed user content with a current-time wrapper and system
reminder. The semantic representation also reshapes provider-specific tool and
message objects.

Therefore:

- OTel is a strong optional cross-check and future lower-risk capture mode;
- it is not the raw request body;
- TracePilot must not describe OTel content as wire-identical;
- the loopback request body remains the source of truth for this feature.

## Truth and fidelity model

Every capture should display a compact provenance statement and a structured
fidelity record.

### Exact within the capture run

- UTF-8 body bytes received by the one-shot listener;
- JSON field values and ordering in those bytes;
- message, instruction, and tool order in that request;
- request path, method, content type, body size, and SHA-256 hash;
- exact byte and character sizes computed from captured values.

### Observed but intentionally not persisted by default

- safe header names;
- CLI stdout JSONL lifecycle and exit status;
- temporary clone event fingerprints;
- request arrival and process timings.

Authorization and API-key header values must never be stored.

### Capture-run differences that must be disclosed

- a synthetic user probe is appended to trigger inference;
- the run occurs after a resume boundary;
- current date/time and dynamic reminders can change;
- the installed CLI version may differ from the original session version;
- current repository/user instructions and files may differ;
- programmatic `-p` mode can load a different integration set from interactive
  mode;
- workspace MCP servers are disabled in prompt mode by default unless the
  upstream opt-in environment variable is set;
- offline BYOK routing can change provider-specific prompt strategy;
- unknown/custom models may fall back to Copilot's safe model defaults;
- a provider could perform additional server-side transformations that a local
  listener cannot observe.

### Never claim

- “This is the request sent on turn 47.”
- “These are the provider's exact per-section token counts.”
- “This is identical to GitHub-hosted Copilot routing.”
- “No local integration process was initialized” unless the preflight and run
  actually disabled every such integration.

Suggested UI label:

```text
Exact captured payload · Capture run only
Copilot CLI 1.0.71 · OpenAI Chat Completions · SHA-256 …
```

## Recommended workflow

```text
User starts capture from Context tab
  -> preflight CLI/session/model/protocol/environment
  -> reject active or changing source session
  -> copy target session into a private temporary Copilot home
  -> optionally snapshot approved non-secret Copilot resources
  -> bind one-shot listener to 127.0.0.1:ephemeral-port/random-path
  -> start hidden `copilot --resume=<id> -p <probe>` with scoped environment
  -> receive one bounded JSON request body
  -> return an intentional capture-complete error
  -> wait for child exit; terminate on deadline
  -> parse and hash the raw body
  -> verify source session fingerprint is unchanged
  -> atomically persist or keep ephemeral according to user choice
  -> delete the temporary Copilot home
  -> show snapshot
```

Returning a recognizable non-retryable `400` response after the body is fully
captured is preferable to emulating successful streaming responses for every
provider protocol. The cloned CLI may record an expected model failure, but all
such writes occur in disposable state. TracePilot should classify the operation
as successful when the authenticated one-shot listener received and validated
the request, regardless of the expected child exit code.

## Preflight and model/protocol resolution

The capture must not begin until a backend preflight returns a reviewable plan.

### Required checks

- valid UUID and validated session path;
- `events.jsonl` and `workspace.yaml` exist;
- session is not active and no `inuse.*.lock` owner is alive;
- source file fingerprint is stable;
- original working directory exists, or a degraded fallback is acknowledged;
- configured Copilot executable resolves;
- installed CLI supports `COPILOT_HOME`, BYOK base URL, explicit resume,
  non-interactive prompt mode, offline mode, and required protocol variables;
- model and likely wire protocol can be resolved;
- source session size fits configured copy and capture bounds;
- TracePilot has writable temporary and capture storage.

### Protocol inference precedence

1. most recent observed `assistant.usage.apiEndpoint` or equivalent typed event;
2. confirmed TracePilot provider-era/profile metadata if Provider Profiles is
   implemented later;
3. installed CLI model catalogue/capability mapping;
4. a user-confirmed protocol selection.

This infers a wire schema, not billing/provider identity. It must not violate
the Provider Profiles plan's rule against deriving provider attribution from a
model name.

### Model environment

Use the last observed session model as `COPILOT_PROVIDER_MODEL_ID` so Copilot
retains its known model-specific prompt, tool, and token-limit behavior. Set a
local-only wire model value because the listener does not perform inference.

For unknown models, preflight should show the installed CLI's fallback warning.
Do not silently invent token limits. If a session emitted a model/context limit,
record it as session-specific evidence; otherwise let the runtime choose its
catalogue/default behavior.

### Fidelity profiles

Phase 0 should determine the smallest safe set of Copilot-home resources needed
to reproduce user-level instructions, skills, agents, MCP definitions, plugins,
and settings. The product should then expose two explicit profiles:

| Profile | Behavior | Trade-off |
| --- | --- | --- |
| Isolated | Target session plus built-ins and current repo discovery; no copied user integrations | Safest, but tool/system context may differ |
| Current environment | Copy an allow-listed snapshot of non-secret user configuration/resources into the temporary home | Higher fidelity; may initialize configured local integrations |

“Current environment” must list which resource classes will be copied or
started. Never copy authentication stores, other sessions, logs, TracePilot
data, package caches, or unknown files wholesale.

## Session snapshot design

### Keep the same session ID

Inside a unique temporary `COPILOT_HOME`, use:

```text
session-state/<source-session-id>/
```

and resume with the exact UUID. The namespace isolation prevents collision with
the source session. TracePilot's own capture ID distinguishes snapshots.

### Copy rules

- only capture an inactive session in the first release;
- create scratch storage with user-only permissions;
- reject symlinks, junctions, and reparse points in the source tree unless a
  future audited policy explicitly supports them;
- copy regular files/directories with a total-size limit;
- omit stale `inuse.*.lock` files from the clone;
- preserve file bytes and relative paths;
- compare source `events.jsonl` size/mtime/hash before and after copy;
- retry once on a benign race, then abort;
- copy `session.db` only while inactive; do not copy a live SQLite database;
- never rewrite `workspace.yaml`, events, checkpoints, or IDs;
- record a manifest of copied/omitted resource classes and warnings.

The initial empirical proof covered a small synthetic session. Phase 0 must
repeat it with long, compacted, resumed, attachment-bearing, and MCP/tool-heavy
sanitized fixtures before product approval.

### Working directory

Run the clone from the original session working directory when it still exists.
This improves instruction and repository-context fidelity. The listener returns
an error before any model can request a tool, so the model cannot modify the
repository. However, startup hooks, plugins, language servers, or MCP servers
may still have side effects; the selected fidelity profile and preflight must
account for them.

If the original directory is missing, offer:

- cancel;
- use the nearest existing ancestor with a degraded-fidelity badge;
- use an empty temporary workspace with a stronger warning.

## One-shot capture listener

Implement this as a bounded local capture service, not a general mock LLM
server.

### Network requirements

- bind only to `127.0.0.1` on an OS-assigned port;
- place at least 128 bits of random entropy in the base-URL path;
- accept exactly one matching POST;
- reject every other method/path before reading a body;
- accept only JSON-compatible content types;
- apply header, body, idle, and total timeouts;
- enforce a body cap (start with 32 MiB, validate in Phase 0);
- never follow redirects or forward traffic;
- shut down immediately after capture/cancel/timeout;
- do not expose a Tauri/frontend HTTP route.

Loopback is not a security boundary against malware running as the same user.
The random path prevents accidental capture by unrelated local traffic, while
user-only process/storage permissions and short lifetime reduce exposure.

### Protocol base URLs

The adapter must generate provider-specific base URLs so the CLI SDK appends the
right operation path:

```text
OpenAI completions: http://127.0.0.1:<port>/<nonce>/v1
OpenAI responses:   http://127.0.0.1:<port>/<nonce>/v1
Anthropic:          http://127.0.0.1:<port>/<nonce>
```

Azure and versioned deployment paths require a dedicated compatibility test.
For a capture-only request, it may be safer to use the equivalent OpenAI wire
adapter while retaining the model ID, but any resulting fidelity difference
must be recorded.

### Secrets and headers

Some SDK adapters require an API key syntactically. Generate a random
capture-scoped dummy value, inject it only into the child, and add the variable
to `--secret-env-vars`.

The listener may record an allow-listed set of safe header names for debugging.
It must never persist header values for:

- `Authorization`;
- `x-api-key` / `api-key`;
- cookies;
- arbitrary user/provider headers.

Raw body content must never enter normal TracePilot logs or tracing fields.

## Child process lifecycle

Use a hidden, directly spawned executable with structured argv and environment;
do not build a shell command.

Suggested launch shape:

```text
copilot
  --resume=<session-id>
  --prompt=<fixed capture probe>
  --output-format=json
  --allow-all-tools
  --no-ask-user
  --no-auto-update
  --no-remote
  --no-remote-export
  --secret-env-vars=<dummy-secret-name>
```

Scoped environment:

```text
COPILOT_HOME=<temporary-home>
COPILOT_PROVIDER_BASE_URL=<one-shot-listener>
COPILOT_PROVIDER_TYPE=<adapter>
COPILOT_PROVIDER_WIRE_API=<adapter>
COPILOT_PROVIDER_MODEL_ID=<observed-model>
COPILOT_PROVIDER_WIRE_MODEL=<capture-only-name>
COPILOT_PROVIDER_API_KEY=<random-dummy-if-needed>
COPILOT_OFFLINE=true
COPILOT_AUTO_UPDATE=false
```

`--allow-all-tools` is required by current non-interactive behavior, but no tool
can run because the listener never returns a model tool call. This assumption
needs an integration test and should be revalidated per CLI version.

The process supervisor must:

- cap stdout/stderr independently;
- parse only lifecycle/error metadata, never log message content;
- use startup, request, and shutdown deadlines;
- cancel cleanly from the UI;
- terminate the entire child process tree on timeout or app shutdown;
- treat “capture received + sentinel 400 + exit 1” as success;
- treat request retry after the sentinel as a compatibility error;
- retain no orphan listener or child.

The existing hidden process helpers provide a starting point, but their current
timeout path kills one child handle. Phase 0 must verify descendant cleanup on
Windows, macOS, and Linux and add process-tree supervision where necessary.

## Probe message

Use a fixed, versioned probe that is easy to identify in every wire format:

```text
[TracePilot context capture <nonce>]
Do not call tools. Reply with exactly CAPTURED.
```

The nonce links the request to the active listener and lets the parser identify
the current probe even when Copilot wraps or transforms it. The nonce should be
stored in capture metadata but redacted from default comparisons.

The UI should display the full captured probe in a dedicated section and offer
a “hide capture probe” view. Hiding affects presentation only; it must not edit
or mislabel the raw request.

## Parsing and normalized model

Keep the exact raw body immutable and derive a versioned normalized view.

Suggested domain model:

```text
ContextCapture
  schema_version
  capture_id
  source_session_id
  captured_at
  source_events_fingerprint
  cli_version
  capture_profile
  protocol
  request_path
  content_type
  raw_body_sha256
  raw_body_bytes
  probe_nonce
  fidelity_manifest
  warnings[]
  parsed

ParsedContextRequest
  model
  system_blocks[]
  messages[]
  tool_definitions[]
  request_controls
  attachments[]
  probe_message_indices[]
  unknown_fields
```

Protocol adapters normalize without discarding:

- Chat Completions `messages` with a system message;
- Responses `instructions` plus `input` items;
- Anthropic top-level `system` plus Messages content blocks;
- tool calls and tool results embedded in each protocol's history format;
- text, image, document, reasoning, refusal, and unknown content blocks;
- provider-specific request controls.

Unknown fields and content types must remain available in Raw JSON. A parser
warning is preferable to rejecting a future CLI payload that still contains
useful data.

### Source-event correlation

Best-effort correlation can map normalized messages/tool results back to
`events.jsonl` using stable IDs where present and content/order fingerprints
otherwise. Correlation is explanatory metadata, not the source of truth.

Display states:

```text
Matched exactly
Matched after protocol normalization
Capture-generated
Unmatched/dynamic
```

Do not alter captured text to force a match.

## Token accounting

Capturing JSON does not automatically provide exact token counts.

The request body contains text and schemas, not the provider tokenizer's final
per-section output. A fake local response cannot truthfully supply usage. Even a
real provider response normally reports only aggregate input usage, and
provider-side framing/cache transformations can make separately tokenized
sections non-additive.

Use this metric taxonomy:

| Label | Meaning | Suitable for MVP |
| --- | --- | --- |
| Exact bytes/chars | Direct measurement of captured UTF-8/body values | Yes |
| Copilot-observed layer tokens | Exact layer anchor emitted by CLI telemetry for that run | Yes, when present |
| Provider-observed input tokens | Aggregate usage returned by a real provider request | No default forwarding; future opt-in only |
| Official count API | Provider tokenizer endpoint over the captured request | Future explicit opt-in; sends sensitive content |
| Local tokenizer-computed | Known tokenizer applied locally | Later, only for validated model/encoding pairs |
| Estimated tokens | Existing byte-based heuristic | Yes, clearly labelled |

Anthropic provides an official
[`POST /v1/messages/count_tokens`](https://platform.claude.com/docs/en/api/go/messages/count_tokens)
endpoint that includes messages, system content, and tools. Using it would send
the captured context to Anthropic and require credentials, so it must be a
separate explicit action, not part of local capture. No equivalent generic
count endpoint can be assumed for OpenAI-compatible or local providers.

For the first release:

- show exact bytes and characters per section;
- show existing TracePilot token estimates with an **Estimated** badge;
- attach any exact Copilot layer snapshot emitted by the cloned run without
  pretending it is a per-message allocation;
- do not show “exact token weighting” percentages.

## Persistence and retention

The captured payload may contain source code, prompts, file contents, tool
results, internal instructions, endpoint-independent secrets embedded in
conversation history, and attachment data.

Recommended behavior:

- first capture requires a local-storage disclosure;
- user chooses **Save snapshot locally** or **View once**;
- saving is allowed to become the remembered default only after that choice;
- raw body bytes are stored unchanged with a hash;
- parsed views are derived and can be regenerated after parser upgrades;
- raw capture content is not added to FTS/search or analytics by default;
- each capture has Delete and Export actions;
- Data & Storage settings show total capture count/size and Delete All;
- storage budget warns and blocks new persistent captures rather than silently
  deleting forensic evidence;
- file/directory permissions are user-only where supported;
- captures are excluded from ordinary session export unless explicitly added.

Suggested layout:

```text
<tracepilotHome>/context-captures/
  <session-id>/
    <capture-id>/
      manifest.json
      request.json
```

`request.json` should contain the exact received bytes. `manifest.json` is
atomic, versioned, non-secret metadata. Do not duplicate full parsed content in
the search index.

Encryption at rest is desirable but not required to prove the feature. Before
general availability, make an explicit product decision between user-only
filesystem permissions plus disclosure, or OS-protected encryption. Never
silently claim that local TracePilot data is encrypted when it is not.

Ephemeral scratch homes must be deleted after success, failure, cancellation,
timeout, and normal app shutdown. On startup, sweep only TracePilot-owned
scratch directories with a validated prefix/manifest and conservative age
threshold.

## UI and interaction design

### Placement

Keep the existing top-level session tabs unchanged. Add a **Request snapshots**
section to the Context tab, alongside the existing pressure/compaction
analysis.

The section has two views:

```text
Context timeline | Request snapshots
```

This makes the relationship clear without creating another top-level session
tab.

### Empty state

```text
No request snapshots

Capture the exact model API payload that Copilot CLI builds when an isolated
copy of this session is resumed. This adds a probe to the copy only and does
not contact a model provider.

[Run preflight]
```

### Preflight dialog

Show:

- source session name/ID and inactive status;
- source event fingerprint and session size;
- original working directory and whether it exists;
- installed/current-session CLI versions;
- detected model and protocol with confidence/source;
- capture fidelity profile;
- Copilot resource classes included/omitted;
- whether any MCP/plugin/hook/LSP process may initialize;
- persistence choice and target directory;
- statement that the probe appears in the capture;
- statement that token sections are not exact unless explicitly observed.

Primary action: **Capture isolated request**.

### Progress state

Use a compact stepper or status list:

```text
Preflight complete
Copying session
Starting loopback listener
Resuming isolated clone
Waiting for request
Parsing snapshot
Cleaning up
```

Expose Cancel throughout. Do not close the dialog and leave a background child
without an obvious status surface.

### Snapshot summary

Header:

```text
Captured 22 Jul 2026, 7:24 pm
Exact captured payload · Capture run only
gpt-4.1 · Chat Completions · CLI 1.0.71
54,853 bytes · 2 messages · 16 tools
```

Badges:

- exact raw body;
- isolated/current-environment fidelity;
- source unchanged;
- saved/ephemeral;
- parser warnings;
- protocol detection source.

### Snapshot explorer

Recommended subviews:

1. **Overview** — counts, exact sizes, fidelity, warnings, request controls.
2. **System** — ordered instruction blocks with search/copy.
3. **Messages** — role/type timeline, expandable content, source-event match.
4. **Tools** — sortable name/description/schema sizes and schema viewer.
5. **Raw JSON** — virtualized/syntax-highlighted source body and SHA-256.
6. **Compare** — select another saved capture and view structural/raw diffs.

Large content must be virtualized and collapsed by default. Reuse TracePilot's
existing JSON, Markdown, diff, tool-result, and syntax-highlighting components
where appropriate.

### Destructive and privacy actions

- Copy raw JSON: confirmation on first use because clipboard managers may
  retain sensitive data.
- Export: explicit file picker and disclosure.
- Delete: identify exact snapshot and whether it is recoverable.
- Delete all: show count/size and require confirmation.

## BYOK Provider Profiles relationship

The earlier **BYOK Provider Profiles** plan remains valuable, but its secret,
profile CRUD, attribution ledger, switching, and cost-accounting work is not
needed for local capture.

### Shared foundation worth extracting

- installed CLI capability probe;
- versioned mapping of provider type and wire API environment variables;
- structured child environment with explicit set/remove operations;
- safe executable/argv construction;
- model ID versus wire model handling;
- redacted launch diagnostics;
- cross-platform child supervision.

### Not required by capture

- OS credential store;
- reusable provider profiles;
- real endpoint health checks;
- provider API keys;
- provider attribution eras;
- provider switching;
- direct-provider cost estimates;
- model discovery.

Recommendation: implement the shared capability/wire adapter under a neutral
Copilot runtime module. Do not make Captured Request Snapshot wait for the full
Provider Profiles roadmap, and do not duplicate two incompatible environment
builders.

## Architecture and implementation map

### Rust domain and parser

Add a pure, forward-compatible module in `tracepilot-core`, for example:

```text
crates/tracepilot-core/src/context_capture/
  mod.rs
  model.rs
  parse.rs
  openai_chat.rs
  openai_responses.rs
  anthropic.rs
  metrics.rs
```

Responsibilities:

- capture manifest/normalized types;
- protocol detection from path/body;
- lossless unknown-field preservation;
- section size accounting;
- probe identification;
- source-event correlation inputs;
- sanitized fixtures and parser tests.

Extend `tracepilot-core/src/paths.rs` with TracePilot-owned capture path shapes;
do not spell `context-captures` across callers.

### Orchestration service

Add a capture workflow in `tracepilot-orchestrator`, for example:

```text
crates/tracepilot-orchestrator/src/context_capture/
  mod.rs
  capability.rs
  preflight.rs
  snapshot.rs
  listener.rs
  protocol.rs
  runner.rs
  persistence.rs
```

Responsibilities:

- CLI capability probing/cache by version;
- session stability and size checks;
- safe temporary-home snapshot;
- one-shot HTTP listener;
- scoped environment/argv;
- supervised process lifecycle;
- cleanup and scratch recovery;
- atomic capture persistence;
- no raw-content logging.

The listener should use a small audited HTTP server implementation with native
body limits and graceful shutdown rather than a hand-written partial HTTP
parser. Record the dependency decision in an ADR if it materially affects
binary size or attack surface.

Extend `tracepilot-orchestrator/src/process/` with a reusable supervised-child
primitive only if its process-tree and cancellation semantics are useful beyond
this feature.

### Tauri IPC and state

Candidate commands:

```text
context_capture_preflight
context_capture_start
context_capture_cancel
context_capture_list
context_capture_get
context_capture_delete
context_capture_delete_all
context_capture_export
```

Candidate progress event:

```text
context-capture-progress
  captureId
  sessionId
  stage
  message
  bytesCopied / totalBytes
  cancellable
```

Add a `ContextCaptureManager` to app state. Start with one global active capture
to simplify resource ownership. Command DTOs belong in
`tracepilot-tauri-bindings/src/types.rs` or Specta-enabled domain types.

Follow the repository's four-part command registration contract:

- `commands/session/context_capture.rs` and module export;
- `lib.rs` `generate_handler!`;
- `ipc_command_names.rs`;
- `packages/client/src/commands.ts`, then `pnpm gen:bindings`.

Capture-start/delete permissions should be available only to the main trusted
window initially. Viewer windows may receive read-only capture DTOs later.

### TypeScript client and types

Add explicit types rather than passing untyped JSON:

```text
packages/types/src/context-capture.ts
packages/client/src/context-capture.ts
```

Export through package indexes and add command-contract tests.

### Desktop UI

Recommended files:

```text
apps/desktop/src/composables/useContextCapture.ts
apps/desktop/src/components/contextCapture/ContextCapturePanel.vue
apps/desktop/src/components/contextCapture/ContextCapturePreflight.vue
apps/desktop/src/components/contextCapture/ContextCaptureProgress.vue
apps/desktop/src/components/contextCapture/ContextCaptureViewer.vue
apps/desktop/src/components/contextCapture/ContextCaptureMessages.vue
apps/desktop/src/components/contextCapture/ContextCaptureTools.vue
apps/desktop/src/components/contextCapture/ContextCaptureRaw.vue
apps/desktop/src/components/contextCapture/ContextCaptureDiff.vue
```

Integrate the panel into `apps/desktop/src/views/tabs/ContextTab.vue`. Reuse the
existing Context timeline cache only for event-derived data; use a separate
capture store/cache because capture lifecycle and persistence semantics differ.

Add capture storage/retention controls to the existing Data & Storage settings
surface.

## Scope and phases

### Phase 0 — compatibility, fidelity, and safety spike

Goal: convert the successful proof into a supported contract.

- Build a small test-only Rust one-shot listener and structured child runner.
- Test installed 1.0.71 plus current 1.0.74 and at least one older supported
  version if available.
- Verify Chat Completions, Responses, Anthropic, and Azure path construction.
- Capture sanitized new, resumed, compacted, long, attachment-bearing,
  tool-result-heavy, and multi-resume sessions.
- Compare interactive versus `-p` request composition.
- Determine which user/repository instructions, skills, agents, MCPs, plugins,
  hooks, and LSPs initialize in each proposed fidelity profile.
- Verify prompt-mode workspace MCP defaults documented by GitHub.
- Verify the sentinel response is non-retryable for each adapter/version.
- Verify same-ID isolated resume does not touch source files.
- Verify source mutation detection and active-session rejection.
- Verify cancellation, timeout, descendant termination, and startup scratch
  cleanup on Windows; design macOS/Linux equivalents.
- Measure request and session-copy sizes across the local corpus to set limits.
- Compare OTel semantic content against raw requests and document differences.
- Decide persistence disclosure/encryption bar.
- Commit only synthetic/sanitized fixtures; never real captured prompts.

Deliverable: compatibility note, fixture corpus, parser shapes, and go/no-go
decision for the two fidelity profiles.

### Phase 1 — safe single snapshot MVP

- preflight and capability probe;
- inactive-session stability gate;
- isolated same-ID session clone;
- OpenAI Chat Completions and Responses capture;
- Anthropic capture;
- one-shot listener with nonce/body/time limits;
- sentinel completion and supervised cleanup;
- immutable raw body, hash, and basic normalized parser;
- Context-tab capture button/progress/overview/raw JSON;
- exact byte/character sizes and clearly estimated tokens;
- ephemeral versus locally saved capture choice;
- list/get/delete and Data & Storage totals;
- feature flag labelled experimental.

Do not ship comparison or remote token counting in this phase.

### Phase 2 — structured analysis and comparison

- rich System, Messages, Tools, and Request Controls views;
- best-effort event correlation;
- current-environment fidelity profile after Phase 0 approval;
- structural and raw snapshot diff;
- dynamic-field ignore rules;
- parser migration/rebuild from immutable raw bodies;
- optional OTel corroboration panel;
- bounded export with explicit raw/redacted modes.

### Phase 3 — tokenizer and broader compatibility

- validated local tokenizer adapters for supported model families;
- optional official token-count API actions with separate consent and
  credentials;
- Azure/versioned provider path coverage;
- custom model/wire-model guidance;
- Provider Profiles metadata integration if implemented;
- viewer-window read-only access;
- macOS/Linux production validation;
- graduate feature flag only after compatibility metrics justify it.

### Later, only if upstream behavior supports it

- capture at a historical checkpoint or rewind boundary;
- user-created capture probes;
- automated pre/post-compaction comparison;
- batch captures across sessions;
- capture of an actual provider-routed request with provider-observed usage;
- team-shareable sanitized capture reports.

## Explicit non-goals

- intercepting an already-running Copilot process;
- proxying or forwarding user requests to a real provider;
- capturing TLS traffic to GitHub or installing a local CA;
- modifying the source session;
- assigning a rewritten CLI session ID in the clone;
- reconstructing an arbitrary historical turn by truncating `events.jsonl`;
- replaying tools or letting a model act on the repository;
- storing credentials or authentication headers;
- implementing a reusable public LLM proxy;
- claiming the provider's server-side prompt is identical to the client body;
- exact per-section token counts without a verified source;
- requiring BYOK Provider Profiles or the Copilot SDK bridge;
- silently capturing context in the background.

## Acceptance criteria

### Phase 1 functional

- A user can preflight and capture an inactive local session from the Context
  tab.
- The source session's fingerprint is unchanged after success, failure,
  timeout, and cancellation.
- The capture body hash matches the bytes persisted or shown in ephemeral mode.
- Chat Completions, Responses, and Anthropic payloads retain unknown fields.
- The probe message is identifiable and visibly separated without being
  removed from raw JSON.
- Expected child exit failure after the sentinel response is shown as capture
  success, not a model error.
- Active/changing sessions are rejected with actionable guidance.
- Missing CWD and ambiguous protocol paths require explicit degraded-fidelity
  confirmation.
- Cancel and app shutdown leave no listener or child process.

### Phase 1 privacy/security

- listener binds only to loopback and requires the random path;
- request body, system prompt, tools, and messages never enter application logs;
- API-key/authorization header values are never persisted or returned to the
  frontend;
- the dummy key is process-scoped and included in `--secret-env-vars`;
- capture scratch and saved files use restrictive permissions;
- source symlinks/reparse points cannot escape the snapshot root;
- body/session/stdout/stderr/time limits are enforced;
- saved captures require informed local-storage choice;
- Delete All affects only the validated TracePilot capture root.

### Accuracy and copy

- UI always says “capture run” rather than “historical request”;
- exact applies only to raw payload/bytes/chars and genuinely observed values;
- token estimates are labelled Estimated;
- OTel-normalized content is never labelled raw/wire-exact;
- fidelity manifest and warnings are visible in every saved capture.

## Verification matrix

| Area | Cases |
| --- | --- |
| CLI | 1.0.71, current release, missing capability, changed help text |
| Protocol | Chat Completions, Responses HTTP, Anthropic Messages, Azure/versioned, unknown path |
| Session | new, resumed, multi-resume, compacted, long, attachment, tool-heavy, crashed/incomplete |
| State | inactive, live lock, stale lock, source changes during copy, missing CWD |
| Environment | isolated, user instructions, repo instructions, skills, MCP, plugins, hooks, offline |
| Process | success sentinel, malformed request, retry, timeout, cancel, app shutdown, output flood |
| Listener | wrong nonce, wrong path/method/type, oversized body, slow body, second connection |
| Parsing | unknown top-level field, unknown content block, invalid JSON, large schemas, Unicode |
| Storage | view once, save, parser rebuild, export, delete one/all, size limit, crash recovery |
| Security | header redaction, log scan, path traversal, reparse point, restrictive permissions |
| UI | empty, preflight warning, progress, success, partial failure, raw viewer, narrow viewport |

Tests should include:

- pure protocol-parser fixtures and property tests;
- capture manifest serialization/migration tests;
- listener contract tests with real HTTP clients;
- source snapshot traversal/size/race tests;
- supervised process timeout/cancellation tests;
- end-to-end synthetic Copilot CLI tests gated on runtime availability;
- IPC command registration and Specta/TypeScript contract tests;
- Vue tests for truth labels, privacy choices, state transitions, and errors;
- Playwright/VRT coverage for the Context-tab panel and viewer;
- a log-scraping test proving unique probe/context markers never appear in
  TracePilot logs.

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Users interpret capture as historical truth | “Capture run only” naming, provenance, probe/resume disclosure |
| BYOK/runtime flags change | Capability probe, versioned adapters, fixture matrix, experimental flag |
| Provider protocol changes | Immutable raw body, forward-compatible parsing, unknown-field preservation |
| Clone writes touch source | Unique temporary `COPILOT_HOME`, same-ID namespace isolation, source fingerprint verification |
| Live copy is inconsistent | Inactive-only MVP, lock/process checks, stability fingerprint |
| Startup integration has side effects | Fidelity profiles, prompt-mode characterization, explicit preflight inventory |
| Tool executes against repository | Listener never returns a tool call; sentinel response; integration test |
| Loopback endpoint leaks context | IPv4 loopback only, random path, one request, short lifetime, same-user threat disclosure |
| Context enters logs | `skip_all` instrumentation, bounded metadata-only errors, marker-based leak tests |
| Header/API key leakage | Random dummy credential, `--secret-env-vars`, discard header values |
| Large payload exhausts memory/disk | Streaming body cap, session copy cap, storage budget, virtualization |
| Timed-out descendants survive | Process-tree supervision and startup orphan sweep |
| Token percentages are misleading | Source taxonomy; bytes/chars first; no exact-token claim |
| Saved capture increases sensitive data footprint | Explicit save choice, user-only permissions, size visibility, delete/export controls |
| OTel appears to make listener unnecessary | Documented and tested semantic normalization difference |
| Full BYOK plan delays feature | Share only capability/wire adapter; no profile/secret dependency |

## Pros and cons

### Advantages

- provides evidence unavailable from `events.jsonl` alone;
- differentiates TracePilot as a forensic/audit tool;
- validates and enriches the existing Context Window Analyzer;
- keeps the source session and provider untouched;
- works without a provider key or billable request;
- creates durable fixtures for Copilot CLI compatibility research;
- establishes reusable runtime capability/process infrastructure.

### Costs and limitations

- depends on an evolving, externally owned CLI surface;
- active execution is materially riskier than TracePilot's normal read-only
  inspection;
- current-state capture cannot answer arbitrary historical questions;
- faithful integrations may initialize local processes;
- raw captures are highly sensitive and potentially large;
- exact token composition remains unsolved for many providers;
- cross-platform process-tree and filesystem semantics require careful work.

## Open decisions for review

1. Should Phase 1 ship only the Isolated fidelity profile, with Current
   environment held until Phase 2? Recommendation: yes.
2. Should saved raw captures be enabled by default after first-use consent, or
   should every capture default to View once? Recommendation: remember the
   user's explicit first choice.
3. Is user-only plaintext storage acceptable alongside TracePilot's existing
   local index, or is OS-protected encryption required before general
   availability? Recommendation: decide before graduating the experimental
   flag, not before Phase 0.
4. Should ambiguous protocol inference block capture or offer an advanced
   selector? Recommendation: offer a selector with a degraded-fidelity badge.
5. Should exact raw JSON be included in normal session exports? Recommendation:
   no; require a dedicated explicit export option.
6. What body/session/storage limits fit the real corpus? Recommendation: measure
   in Phase 0 and avoid silent truncation.
7. Is Windows-only experimental release acceptable initially? Recommendation:
   yes, consistent with current TracePilot platform status, while keeping the
   architecture cross-platform.

## Recommended approval

Approve Phase 0.

The core idea is sound, and the loopback capture is more feasible than the
original proposal assumed because `COPILOT_HOME` provides clean namespace
isolation and the copied session can retain its ID. The listener should be a
one-shot capture endpoint that intentionally stops inference, not a broad fake
provider. Full Provider Profiles work should not block it.

Proceed to Phase 1 only after Phase 0 verifies integration startup behavior,
protocol/version coverage, process-tree cleanup, and the product's persistence
security decision. Preserve the strongest honest promise: exact request bytes
for a controlled capture run, with explicit fidelity and token-source labels.
