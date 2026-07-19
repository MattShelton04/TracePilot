# BYOK Provider Profiles — Feasibility, Scope, and Implementation Plan

Status: proposed; awaiting product and implementation review.

Research date: 2026-07-19.

## Product decision

TracePilot should add **Provider Profiles** as a first-class launcher and
observability concept.

A profile represents one routing and billing path:

- GitHub Copilot;
- an OpenAI-compatible endpoint such as OpenAI, Ollama, vLLM, LM Studio,
  Foundry Local, or an internal gateway;
- Anthropic;
- Azure OpenAI / Azure AI Foundry.

The first release should make a profile selectable when launching a session,
store credentials in the operating-system credential store, and record the
selected profile against a TracePilot-owned session ID. It should not edit the
user's global shell environment or Copilot configuration.

Provider selection and model selection must remain separate concepts. A model
name such as `claude-sonnet-*` does not establish whether the request was
routed and billed through GitHub Copilot, Anthropic, or an enterprise gateway.
TracePilot should display unknown attribution as **Unknown**, not infer it from
the model vendor.

For an already-running CLI process, changing provider is not an environment
variable update that TracePilot can apply in place. Provider configuration is
fixed when that process/session is created or resumed. The robust switch is:

1. wait until the session is idle;
2. stop or detach the current controller;
3. resume the same session ID with the new provider profile and credentials;
4. verify the resume and model;
5. start a new provider-attribution era at that resume boundary.

New-session selection can be one-click through TracePilot's existing terminal
launcher. For an existing session, TracePilot should queue the target profile,
ask the user to exit the current Copilot process, wait for the session lock to
be released, and then launch `copilot --resume=<session-id>` in a new terminal.
That is one TracePilot switch action plus a deliberate CLI exit, without
depending on the rarely used TracePilot SDK bridge or risking concurrent
session writers.

## Executive answer

The requested feature is feasible and now has explicit upstream support.

GitHub documents local BYOK for Copilot CLI using environment variables. The
required values are `COPILOT_PROVIDER_BASE_URL` and a model, with optional
provider type and API key. Supported provider types are `openai`, `azure`, and
`anthropic`; OpenAI-compatible endpoints include local Ollama and vLLM. Models
must support streaming and tool/function calling, and GitHub recommends at
least a 128k context window. See [Using your own LLM models in GitHub Copilot
CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/use-byok-models).

No SDK integration is required. Copilot CLI itself accepts the provider
environment on process start and supports `--session-id` and `--resume`, which
is enough for TracePilot's normal terminal-launch workflow.

TracePilot already has much of the plumbing:

- terminal launches accept per-launch environment variables;
- `session.model_change` and tool-completion events already reconstruct
  per-turn model changes;
- shutdown/resume segments already preserve per-model token and usage totals.

However, the current generic environment-variable UI is not an acceptable
BYOK product:

- custom model IDs fail the static Copilot model allowlist;
- session templates serialize `envVars`, so an API key could be written to a
  plaintext template JSON file;
- the launcher inherits the parent environment and cannot currently *unset*
  global BYOK variables when the user selects GitHub Copilot;
- no provider identity is written to Copilot's persisted event schema;
- the model picker is a static GitHub-oriented catalogue.

The recommended build is therefore a dedicated profile, secret, launch, and
attribution layer that reuses the low-level launcher rather than exposing its
raw environment map.

## User stories and expected behavior

### Local model with occasional Copilot use

> I run local models but like the Copilot CLI harness. I want one click to use
> my local model, and another to return to Copilot.

Expected behavior:

- create an “Ollama — local” profile with no API key;
- test endpoint reachability and, optionally, tool-calling/streaming;
- choose the profile in the session launcher;
- choose “GitHub Copilot” later without changing the global environment;
- for an existing session, request “Switch provider and resume,” exit the
  current Copilot CLI when prompted, and let TracePilot reopen the same session;
- show the profile and model separately throughout the session timeline.

### Work-provided Anthropic API access

> My employer gives me Anthropic API access but not Copilot model access. I want
> to use that API through the Copilot CLI harness.

Expected behavior:

- create an Anthropic profile using the employer's approved base URL and key;
- explain that Copilot CLI can use BYOK without GitHub authentication, but
  GitHub-hosted features such as the GitHub MCP server, code search, and
  `/delegate` require GitHub authentication;
- store the key in the OS credential store;
- inject it only into the Copilot process and block it from agent-launched
  shell/MCP subprocesses;
- never show the key in launch previews, logs, templates, exports, or
  attribution data.

GitHub documents the unauthenticated BYOK behavior and the unavailable GitHub
features in [Authenticating GitHub Copilot CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/authenticate-copilot-cli).

### Rotating among ChatGPT, Claude, and Copilot

> I rotate among ChatGPT, Claude, and Copilot subscriptions and want switching
> to be streamlined.

The onboarding must correct a likely misunderstanding:

- a GitHub Copilot plan/account can supply GitHub-hosted Copilot models;
- a ChatGPT subscription is not an OpenAI API balance;
- a Claude.ai paid plan is not Anthropic Console API usage;
- direct BYOK requires separate API access and billing, unless a local or
  unauthenticated endpoint is used.

OpenAI says its API is billed and managed separately from ChatGPT in
[How can I move my ChatGPT subscription to the API?](https://help.openai.com/en/articles/8156019-how-can-i-move-my-chatgpt-subscription-to-the-api).
Anthropic makes the equivalent distinction in
[Why do I have to pay separately for API usage on Console?](https://support.anthropic.com/en/articles/9876003-i-subscribe-to-a-paid-claude-ai-plan-why-do-i-have-to-pay-separately-for-api-usage-on-console).

TracePilot should use the terms **Copilot account**, **OpenAI API**, and
**Anthropic API**, not imply that consumer chat subscriptions can be imported.

## Hard evidence

### Upstream capability matrix

| Question | Evidence | Planning implication |
| --- | --- | --- |
| Can Copilot CLI use a local/custom provider? | GitHub's CLI BYOK guide says `COPILOT_PROVIDER_BASE_URL` activates a provider and documents OpenAI-compatible, Azure, and Anthropic routes. | Yes; no proxy or harness fork is required. |
| Can it use Ollama/local models? | The CLI guide lists Ollama and OpenAI-compatible endpoints. | Provide a no-key local profile preset. |
| What must a model support? | CLI docs require streaming and tool calling and recommend a context window of at least 128k. | Health checks need more than “port is open”; show capability guidance. |
| Is GitHub login required? | GitHub says no for BYOK model requests, but GitHub MCP, code search, and `/delegate` need GitHub auth. | Separate model-provider readiness from GitHub-feature readiness. |
| Can BYOK be offline? | `COPILOT_OFFLINE=true` disables GitHub auth, telemetry, web tools, GitHub MCP, and auto-update; remote provider traffic still leaves the machine. | Offline is a profile/session option with an explicit data-egress explanation. |
| Are arbitrary model names supported? | `COPILOT_MODEL` / `--model` supplies the provider-facing model; installed help also distinguishes model ID from wire model. | Do not gate BYOK models on TracePilot's GitHub model registry. |
| Can the CLI switch models mid-session? | The CLI command reference documents `/model`. | Model switching remains available *within* the process's active provider route. |
| Can the CLI switch provider mid-process? | Provider routing is activated by startup environment; `/model` changes only the model, and no provider-switch command is documented. | Implement provider change as exit plus `--resume`, not a hot switch. |
| Does the event stream persist provider identity? | The documented stream includes model, token usage, API endpoint, and GitHub request ID, but no provider profile/type/base URL. | Provider attribution needs a TracePilot-owned ledger. Model inference is insufficient. |
| How is BYOK billed? | GitHub's BYOK documentation says direct usage is tracked by the provider and does not consume Copilot premium quota. | Keep Copilot AI Credits and direct API cost estimates separate. |

Primary references:

- [CLI BYOK guide](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/use-byok-models)
- [CLI command reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference)
- [CLI programmatic reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-programmatic-reference)
- [Copilot BYOK concepts](https://docs.github.com/en/copilot/concepts/models/bring-your-own-key)
- [Persisted/streamed event field reference](https://docs.github.com/en/copilot/how-tos/copilot-sdk/features/streaming-events)

### Installed CLI verification

The locally installed `copilot` was also inspected on 2026-07-19:

```text
GitHub Copilot CLI 1.0.71
```

`copilot help providers` confirms the public mechanism and exposes additional
version-specific controls:

```text
COPILOT_PROVIDER_BASE_URL
COPILOT_PROVIDER_TYPE
COPILOT_PROVIDER_API_KEY
COPILOT_PROVIDER_BEARER_TOKEN
COPILOT_PROVIDER_WIRE_API
COPILOT_PROVIDER_TRANSPORT
COPILOT_PROVIDER_AZURE_API_VERSION
COPILOT_MODEL
COPILOT_PROVIDER_MODEL_ID
COPILOT_PROVIDER_WIRE_MODEL
COPILOT_PROVIDER_MAX_PROMPT_TOKENS
COPILOT_PROVIDER_MAX_OUTPUT_TOKENS
```

The split between `MODEL_ID` and `WIRE_MODEL` is valuable. A profile can tell
the harness that a deployment behaves like a known base model while sending a
different deployment/fine-tune name to the provider.

The installed CLI also says:

- setting `COPILOT_PROVIDER_BASE_URL` uses the provider instead of GitHub
  Copilot routing;
- `/model` changes the model, not the provider route;
- `/restart` preserves the session, but it cannot acquire a different parent
  process environment;
- `--secret-env-vars` strips named values from shell and MCP environments and
  redacts them from output;
- `continueOnAutoMode` does not apply to BYOK providers.

These installed-help details should be captured by an automated compatibility
probe rather than assumed forever.

### Documentation/version discrepancy to handle

The current public CLI page shows an Azure example with a deployments path,
while the installed 1.0.71 help says a native `azure` provider should receive
only the Azure host and construct the path itself. The installed help also
gives Ollama `/v1`, while the short public CLI example omits it.

TracePilot should therefore:

- detect the CLI version;
- generate configuration from a versioned adapter;
- show the effective, redacted environment;
- test the exact profile through the installed Copilot runtime;
- avoid “helpfully” rewriting custom URLs after the user has confirmed them.

### Current TracePilot evidence

| Existing code | What it provides | Gap |
| --- | --- | --- |
| [`LaunchConfig.env_vars`](../../crates/tracepilot-orchestrator/src/types.rs) | Per-launch key/value input. | No secret references or variables-to-unset. |
| [`launcher/terminal/windows.rs`](../../crates/tracepilot-orchestrator/src/launcher/terminal/windows.rs) and [`unix.rs`](../../crates/tracepilot-orchestrator/src/launcher/terminal/unix.rs) | Terminal-scoped environment injection. | Values are generic strings; Windows emits them into a PowerShell script. |
| [`launcher/terminal/mod.rs`](../../crates/tracepilot-orchestrator/src/launcher/terminal/mod.rs) | `--model`, permissions, reasoning, UI server. | `validate_model` rejects custom IDs; arguments are assembled into shell text. |
| [`model_data.rs`](../../crates/tracepilot-core/src/models/event_types/model_data.rs) and turn reconstruction | Typed `session.model_change`, per-turn and per-tool models. | Provider is absent and cannot be inferred from the model. |
| [`session_writer/analytics.rs`](../../crates/tracepilot-indexer/src/index_db/session_writer/analytics.rs) | Shutdown/resume segments and per-model metrics. | Existing keys collapse identical model IDs across providers. |
| [`templates/storage.rs`](../../crates/tracepilot-orchestrator/src/templates/storage.rs) | Persists complete `LaunchConfig` as JSON. | Saving a raw API key in `envVars` would persist it in plaintext. |
| [`SessionLauncherAdvanced.vue`](../../apps/desktop/src/components/sessionLauncher/SessionLauncherAdvanced.vue) | Generic env-var editor. | Secret values use ordinary text inputs and can flow into templates. |

The feature should stay on the established CLI/terminal path. The SDK bridge
can continue to observe or steer sessions independently, but Provider Profiles
should not require changes to it.

## Vocabulary and domain model

“Provider” is overloaded. TracePilot should keep these dimensions distinct:

| Dimension | Examples | Meaning |
| --- | --- | --- |
| Routing mode | `github-copilot`, `direct-byok`, `unknown` | Who receives/bills the model request. |
| Protocol/provider type | `openai`, `azure`, `anthropic` | Copilot's wire adapter. |
| Service hint | `openai`, `ollama`, `lm-studio`, `vllm`, `internal`, `other` | User-selected display and setup preset; not inferred from URL. |
| Provider profile | `Local Ollama`, `Work Anthropic`, `GitHub Copilot` | The user's reusable routing configuration. |
| Model identity | `gpt-4.1`, `llama3.2`, deployment name | The model selected for a request/turn. |
| Wire model | `team-claude-prod-v3` | Optional provider-facing deployment or fine-tune name. |

UI example:

```text
Provider: Work Anthropic
Route: Direct API
Model: claude-opus-4-5
```

Do not display “Provider: Anthropic” merely because a Copilot-routed model is
named Claude.

## Provider profile design

### Non-secret profile record

Suggested logical shape:

```text
ProviderProfile
  id: UUID
  display_name: string
  routing_mode: github-copilot | direct-byok
  provider_type: openai | azure | anthropic | null
  service_hint: openai | ollama | lm-studio | vllm | foundry-local |
                internal | other | null
  base_url: string | null
  auth_mode: none | api-key | bearer-token
  secret_ref: opaque string | null
  model_id: string
  wire_model: string | null
  wire_api: completions | responses | null
  transport: http | websockets | null
  azure_api_version: string | null
  max_prompt_tokens: integer | null
  max_output_tokens: integer | null
  offline: boolean
  created_at / updated_at
  last_tested_at
  last_test_result: passed | warning | failed | never
  last_tested_cli_version
```

Rules:

- GitHub Copilot is a built-in, undeletable profile with no base URL or secret.
- `model_id` is required for direct BYOK.
- `auth_mode=none` is allowed for local/internal endpoints.
- remote plain HTTP receives a prominent warning; loopback HTTP is normal.
- reject URL user-info (`https://key@example`), fragments, control characters,
  and unbounded field sizes.
- profile display names and service hints are user assertions.
- never include the full base URL in analytics, logs, or default exports. It
  may contain internal host, tenant, deployment, or query information.

### Secret record

Store only the API key/bearer token in the OS credential store, under a stable
service/account pair such as:

```text
service = "TracePilot BYOK"
account = "provider-profile:<profile UUID>"
```

The profile holds only the opaque `secret_ref`. Requirements:

- create/update/delete secrets through backend commands;
- never return a stored secret to the frontend after save;
- expose only `hasSecret`, `updatedAt`, and possibly a non-reversible
  last-four fingerprint if the provider's security policy permits;
- exclude secret values from `Debug`, `Serialize`, tracing fields, panic
  messages, launch responses, template files, clipboard, and exports;
- overwrite or remove the prior credential on rotation/deletion;
- if the platform credential store is unavailable, fail closed for saved
  secrets and offer “prompt for this launch” as an in-memory alternative;
- never silently fall back to plaintext config.

The choice of credential-store crate/plugin should be captured in an ADR after
a Windows Credential Manager, macOS Keychain, and Linux Secret Service spike.

### Environment adapter

Build an internal structured launch environment:

```text
LaunchEnvironment
  set: Map<name, SecretOrPlainValue>
  remove: Set<name>
  secret_names: Set<name>
```

For direct BYOK, set only the values required by the installed CLI adapter.
For GitHub Copilot, explicitly remove every supported
`COPILOT_PROVIDER_*` variable plus `COPILOT_OFFLINE`; otherwise a globally
defined `COPILOT_PROVIDER_BASE_URL` would silently override the user's
one-click Copilot choice.

Always add:

```text
--secret-env-vars=COPILOT_PROVIDER_API_KEY,COPILOT_PROVIDER_BEARER_TOKEN
```

when applicable. GitHub documents this switch in the
[CLI programmatic reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-programmatic-reference).

Refactor command construction to structured executable/argument values and
OS-specific safe encoding. A custom model such as
`deepseek-coder-v2:16b` must not require entry in the static registry, but it
must also never be interpolated unquoted into shell source.

## Launch and switching behavior

### New terminal session

1. User selects a provider profile and, optionally, overrides its default
   model for this launch.
2. Backend validates the profile and resolves its secret.
3. Backend generates a UUID and passes `--session-id <uuid>` to Copilot.
4. Backend writes a pending, non-secret launch-attribution record.
5. Backend launches Copilot with scoped set/remove environment operations.
6. Indexing finds the known session ID and confirms the first attribution era.
7. A failed launch expires or marks the pending record failed.

Generating the session ID solves the otherwise unreliable problem of matching a
new terminal process to whichever session directory appears next.

### Model change within the active provider

The user may continue using Copilot CLI's `/model` command. TracePilot records
the resulting `session.model_change` event and preserves the provider era. Any
model picker added to TracePilot's launcher must be scoped to the selected
profile.

Do not offer a GitHub model in a direct-BYOK model picker unless the endpoint
itself serves that model. GitHub's BYOK docs explicitly say only the provider's
models are available in BYOK mode.

### Provider change for an active terminal session

TracePilot cannot change the environment of the running Copilot process and
must not start a second writer against the same session. Implement a queued
backend operation:

```text
queue_session_provider_resume(session_id, target_profile_id, target_model)
```

Sequence:

1. reject while a turn, tool, permission, or user-input request is active;
2. read the last persisted event ID/fingerprint and current provider era;
3. resolve the target secret without returning it to the renderer;
4. store a pending resume request and show “Exit Copilot to complete switch”;
5. ask the user to run `/exit` in the existing terminal;
6. watch the existing `inuse.*.lock`/process state until ownership is released;
7. launch `copilot --resume=<session-id>` under the target profile;
8. verify the new `session.resume`/model evidence and confirm the provider era;
9. if launch fails, keep the old era unchanged and offer retry with either
   profile.

The user should not need to re-enter the target settings or issue a resume
command. The deliberate `/exit` is retained because TracePilot currently owns
only the terminal wrapper PID and cannot prove that forcibly terminating it
will give Copilot a clean shutdown.

If TracePilot owns and can safely terminate the exact Copilot process—not just
the terminal wrapper—a later version may automate this. Current launcher PIDs
refer to the terminal wrapper and are not sufficient proof.

An optional later CLI supervisor could keep the same terminal open: it would
launch Copilot, observe a queued profile change after Copilot exits, and
immediately relaunch the same session with the new environment. It still should
not inject keystrokes or kill a busy TUI.

`/restart` is not a provider-switch solution because the restarted process
inherits the same provider environment. `/model` is not a provider-switch
solution because it changes only the model inside the active route.

### Copy-to-clipboard / guide mode

A lightweight guide is useful both as onboarding and as a fallback when secure
launch is unavailable, but it should not become the main implementation.

Provide:

- PowerShell, POSIX shell, and cmd-aware instructions;
- “Copy command” containing endpoint/model settings but no credential value;
- a separate interactive secret prompt recipe that avoids putting the key in
  shell history;
- a redacted preview listing variable names and profile name;
- `--resume=<id>` for switching an existing session.

Never copy a stored key to the clipboard. Never write global/user environment
variables. The preferred one-click path retrieves the secret in the backend
and injects it only into the child process.

## Robust provider attribution

### Why the event stream is insufficient

Copilot's event stream provides strong model evidence:

- `session.model_change`;
- `tool.execution_complete.model`;
- `assistant.usage.model`;
- shutdown `currentModel` and `modelMetrics`.

It does not provide the local provider profile, provider type, or base URL.
`assistant.usage.apiEndpoint` distinguishes wire protocols but not routing:
`/v1/messages` could be direct Anthropic or GitHub routing to a Claude model.
`providerCallId` is a GitHub request-tracing field when present, but absence is
not proof of direct BYOK.

Therefore:

- model attribution remains event-derived;
- provider attribution is TracePilot launch/resume metadata;
- untracked sessions are Unknown unless there is strong billing evidence or
  the user annotates them;
- inference source and confidence must be visible.

### Durable attribution ledger

Keep the source ledger in TracePilot-owned storage, not inside Copilot session
folders and not only in the rebuildable analytics index.

Suggested record:

```text
ProviderEra
  session_id
  era_id / sequence
  boundary_event_id: string | null
  start_event_index: integer | null
  started_at: timestamp
  ended_at: timestamp | null
  profile_id: UUID | null
  profile_name_snapshot: string
  routing_mode: github-copilot | direct-byok | unknown
  provider_type: openai | azure | anthropic | null
  service_hint: string | null
  model_id_at_start: string | null
  wire_model_snapshot: string | null
  endpoint_fingerprint: SHA-256 | null
  attribution_source: tracepilot-launch | tracepilot-resume |
                      user-annotation | import | billing-evidence | unknown
  confidence: confirmed | strong | unknown
  status: pending | confirmed | failed
  created_at
```

The endpoint fingerprint is optional and non-reversible; the full endpoint
stays in the private profile store. Snapshot the display/type fields so
renaming or deleting a profile does not rewrite history.

Resolve a pending era to the first `session.start`/`session.resume` event after
the recorded prior-event boundary. Keep the upstream event UUID as the stable
anchor and event index as a query/render projection.

### Index projection

Add a normalized index projection, for example:

```text
session_provider_eras
  session_id
  era_index
  start_event_index
  end_event_index
  start_timestamp
  end_timestamp
  routing_mode
  provider_type
  service_hint
  profile_name
  attribution_source
  confidence
```

Add summary columns only for fast list/filter use:

```text
sessions.current_provider_label
sessions.provider_count
sessions.has_unknown_provider
```

A session with multiple eras should display “3 provider eras” rather than one
misleading current provider.

### Usage and cost attribution

The safest first implementation joins provider eras to existing
shutdown/resume `session_segments`. Provider switching is intentionally a
resume boundary, which aligns provider eras with segment-level model metrics.

This avoids pretending that aggregate final `modelMetrics` can split identical
model IDs across providers. For incomplete/crashed segments, usage may remain
unavailable.

Recommended analytics identity:

```text
(routing_mode, provider profile snapshot, model_id)
```

not just `model_id`.

Accounting rules:

- GitHub Copilot: use observed Copilot AI Credit/nano-AIU telemetry;
- direct BYOK: show token usage and, if the user supplies price data, an
  **estimated direct API cost**;
- never show provider estimates as an actual provider invoice;
- never combine direct API dollars with Copilot AI Credits into an unlabeled
  total;
- BYOK premium requests should remain zero/not applicable, consistent with
  GitHub's BYOK documentation.

### External and historical sessions

Classification precedence:

1. confirmed TracePilot launch/resume era;
2. imported sanitized era metadata;
3. explicit user annotation;
4. strong GitHub billing evidence for a bounded segment;
5. Unknown.

Do not infer provider from:

- model name/vendor;
- API endpoint path alone;
- presence or absence of GitHub authentication;
- `totalPremiumRequests = 0`;
- a local process name.

For historical manual annotations, let the user select a start/end resume
segment rather than pretending to know an exact turn.

## UX proposal

### Provider Profiles settings

Each card shows:

- name and route;
- service/provider type;
- redacted endpoint host or “Local machine”;
- default model and optional wire model;
- credential status, never value;
- offline status;
- last test result and CLI version;
- Edit, Test, Duplicate, Delete.

Profile wizard presets:

- GitHub Copilot;
- Ollama;
- OpenAI;
- Anthropic;
- Azure OpenAI;
- Other OpenAI-compatible.

An “Advanced” section exposes wire API, wire model, Azure API version,
transport, and manual token limits.

### Session launcher

Replace the single static model picker with:

1. Provider profile;
2. Model for that profile;
3. optional advanced model/wire settings.

Show:

```text
Route preview
  Work Anthropic → https://api.anthropic.com → claude-opus-...
  Credential: stored securely
  GitHub features: signed in / unavailable
  Offline: off
```

The CLI preview must stay redacted. Generic environment variables remain
available for non-secret advanced use, but known credential-like names should
be masked and excluded from template saves.

### Active session

Header badge:

```text
Work Anthropic · claude-opus-...
```

Provider/model timeline:

- provider-era boundary marker at start/resume;
- existing model-change markers inside the era;
- source tooltip: “Recorded by TracePilot launch”, “User annotation”, or
  “Unknown”;
- a distinct warning when provider is unknown;
- “Switch provider and resume” only when the session is controllable and idle.

### Session list, search, analytics, and export

Incremental scope:

- session list: provider badge and filter;
- session detail: full provider/model timeline;
- analytics: provider + model grouping and separate billing units;
- search facets: provider profile snapshot/routing mode;
- exports: sanitized profile label/type and era boundaries, never secret or
  full endpoint by default;
- imports: preserve source as `import`, never overwrite local secrets or bind
  automatically to a local profile ID.

## Validation and health checks

Use layered checks so a “Test” button does not unexpectedly send repository
content or incur meaningful cost.

### Level 1 — local validation

- required fields;
- provider-type/wire-API combinations;
- URL parsing and secure transport warning;
- model ID length/control-character validation;
- credential presence;
- installed CLI minimum/feature detection;
- offline mode only with a loopback or explicitly acknowledged private
  endpoint.

### Level 2 — endpoint readiness

On explicit user action:

- resolve DNS/connect with a short timeout;
- optionally call the provider's model-list endpoint where supported;
- report authentication, not-found, TLS, timeout, and model-not-found
  separately;
- do not log response bodies that could contain sensitive gateway details.

Model listing is advisory: GitHub notes that custom providers may not expose a
model list known to the CLI.

### Level 3 — harness compatibility smoke test

With explicit notice that it makes a billable model request:

- use a temporary empty working directory;
- run a short-lived `copilot -p` child process with the profile environment;
- attach a local no-op MCP test tool available only for this command;
- ask the model to invoke it and return a fixed short response;
- verify JSONL output, streaming completion, and tool calling;
- delete the generated ephemeral Copilot session data;
- persist only result category, latency, CLI version, and timestamp.

This is the only meaningful end-to-end confirmation of the two model
requirements in GitHub's CLI guide.

## Security and privacy requirements

This feature handles code, internal endpoints, and billable credentials.
Treat the following as release blockers:

- OS credential-store integration or in-memory-per-launch fallback;
- automatic `--secret-env-vars` isolation;
- no credential values in Tauri command instrumentation or Rust `Debug`;
- no credential values in generic template JSON;
- no credential values in CLI previews, copied commands, errors, analytics,
  exports, crash reports, or logs;
- zeroize short-lived backend secret buffers where practical;
- explicit removal of inherited BYOK variables for the Copilot profile;
- HTTPS warning for non-loopback endpoints;
- user confirmation that prompts, repository context, and tool results are
  sent to the selected remote provider;
- offline copy that accurately says a remote BYOK endpoint still receives
  data. GitHub makes this caveat in its CLI BYOK guide;
- profile test uses an empty temporary workspace;
- endpoint redirects do not silently cross host/origin with credentials;
- no automatic provider calls merely by opening settings;
- deletion offers “remove profile and credential” as one operation.

OpenAI's API guidance says API keys should come from environment variables or a
key-management service and must not be exposed in client-side code. See the
[OpenAI API authentication reference](https://platform.openai.com/docs/api-reference/authentication).

## Compatibility strategy

BYOK is an evolving Copilot surface. Add a runtime capability probe that
captures:

- `copilot --version`;
- whether `help providers` succeeds;
- supported provider environment names;
- `--secret-env-vars`;
- `--session-id` and `--resume`;
- `/model`, `/exit`, and `/restart` availability.

For help-only capabilities, use conservative exact token detection and cache
by CLI version.

Profiles should have a `last_tested_cli_version`; after a CLI update, display
“Retest recommended” rather than silently rewriting the profile.

Keep a versioned provider adapter because CLI environment names currently have
more fields than the short public BYOK page. The installed CLI is the
authoritative runtime for this feature.

## Scope and phases

### Phase 0 — compatibility and telemetry spike

Goal: remove the remaining unknowns before UI implementation.

- Use Copilot CLI 1.0.71.
- Test one local OpenAI-compatible server and a deterministic mock endpoint.
- Capture new and resumed terminal BYOK sessions.
- Confirm exact persisted events, shutdown model metrics, premium-request
  values, offline behavior, and resumption.
- Resume one session from BYOK to Copilot and Copilot to BYOK.
- Verify whether each resume produces the expected shutdown/resume segment.
- Verify model switching within a BYOK provider.
- Verify `--secret-env-vars` prevents the agent's shell tool from reading the
  provider credential.
- Resolve the Azure URL discrepancy across installed versions.
- Decide credential-store implementation and record it in an ADR.

Deliverable: a small sanitized fixture set and compatibility note. Do not use
real keys or proprietary prompts in committed fixtures.

### Phase 1 — profiles and one-click new-session launch

- Non-secret profile CRUD.
- OS credential-store CRUD.
- Built-in Copilot profile and setup presets.
- Redacted health checks.
- Terminal environment set/remove adapter.
- Backend-generated session IDs.
- Launcher provider/model selection.
- Prevent secrets in generic env vars/templates.
- Sanitized command/guide generator.
- Initial confirmed/unknown provider badge.

This phase satisfies the highest-value “local model or Copilot in one click”
story for new sessions.

### Phase 2 — durable attribution and queued terminal switching

- Provider-era source ledger.
- Index migration/projection and analytics-version bump.
- Provider/model timeline in session detail.
- Queued `/exit` plus terminal resume flow.
- Optional TracePilot CLI supervisor spike.
- Unknown/manual annotation UX.
- Session list filters and provider-aware search.

### Phase 3 — provider-aware cost and reporting

- Join provider eras to shutdown/resume segments.
- Provider + model analytics.
- User-supplied direct API price entries scoped to provider/model.
- Separate Copilot AI Credit and direct-cost views.
- Sanitized export/import of provider eras.

### Later, only if demanded

- Provider-specific model discovery.
- Multiple models per profile.
- Team-managed profile distribution without shared plaintext keys.
- Short-lived bearer-token refresh through an enterprise credential broker.
- Process-owned terminal automation for truly one-click terminal resume.
- Enterprise BYOK catalogue metadata.

## Explicit non-goals

- Reusing ChatGPT or Claude.ai browser-session cookies/tokens.
- Turning consumer chat subscriptions into API access.
- Proxying model requests through TracePilot.
- Hosting or downloading local models.
- Supporting arbitrary non-OpenAI-compatible protocols outside Copilot's
  documented provider types.
- Managing GitHub enterprise BYOK administration.
- Claiming direct-provider estimated cost is an invoice.
- Mutating global shell, registry, profile, or Copilot environment settings.
- Guessing provider from model names.
- Hot-changing provider inside an unmanaged running terminal process.
- Integrating Provider Profiles with TracePilot's SDK bridge.

## Implementation map

### Rust/domain

- Add provider profile and secret-reference types in
  `tracepilot-orchestrator`.
- Add a provider store under TracePilot-owned config storage.
- Add credential-store abstraction with fake/test implementation.
- Extend `LaunchConfig` with a nested, non-secret `providerSelection`; avoid
  adding raw secret fields.
- Replace `HashMap<String, String>`-only launch injection with structured
  set/remove/secret operations.
- Add generated `session_id` to terminal launches.
- Add pending resume coordination using session locks/process state.
- Add provider-era ledger and reconciliation against raw events.
- Add a migration and bump `CURRENT_ANALYTICS_VERSION` when provider
  projections enter the index.

### IPC and permissions

Candidate commands:

```text
provider_profiles_list
provider_profile_get
provider_profile_save
provider_profile_delete
provider_profile_set_secret
provider_profile_clear_secret
provider_profile_test
provider_capabilities_get
session_provider_timeline_get
session_provider_annotate
queue_session_provider_resume
cancel_session_provider_resume
```

Secret-setting commands accept a secret but return only metadata. They must use
`#[instrument(skip(...))]` or equivalent and have narrow Tauri permissions.

### Frontend

- Provider Profiles settings page/panel.
- Setup wizard with presets and education.
- Profile-scoped model field/picker.
- Redacted route preview and health results.
- Session provider badge and timeline.
- Queued terminal switch, exit prompt, and recovery state.
- Unknown/manual attribution.
- Provider filters and analytics later.

### Templates

Templates may store `providerProfileId` and a non-secret per-launch model
override. They must never embed a provider secret or duplicate the full
profile. On another machine or after deletion, a template should report
“Provider profile missing” and offer reassignment.

The existing generic `envVars` template behavior needs a security migration:

- block known secret variables from template save;
- mask likely credential values;
- warn on existing templates containing credential-like keys;
- offer an explicit scrub operation;
- do not silently print the detected value.

## Acceptance criteria

### Phase 1

- A user can create and test Ollama, OpenAI-compatible, Anthropic, and Azure
  profiles plus use the built-in Copilot profile.
- A local no-auth profile can launch without a fake API key.
- A remote-key profile launches without the key appearing in TracePilot files,
  logs, previews, templates, exports, or agent shell/MCP environments.
- Selecting Copilot works even when TracePilot inherited global
  `COPILOT_PROVIDER_*` variables.
- A custom model ID outside TracePilot's registry launches safely.
- TracePilot assigns and later recognizes the exact session ID.
- The session shows confirmed provider/profile attribution, or Unknown when it
  was not launched through TracePilot.
- Offline mode accurately disables GitHub-dependent features and warns about a
  remote provider endpoint.

### Phase 2

- A provider switch is disabled while the session is busy.
- A queued switch waits for the existing session lock/process to release before
  resuming the same session ID.
- A successful switch creates one confirmed provider era at the resume
  boundary.
- A failed resume creates no false confirmed era and offers retry with the old
  or target profile.
- Model changes inside the provider era remain visible independently.
- Historical/untracked sessions are Unknown by default.
- Manual annotation identifies its source and does not masquerade as observed.

### Phase 3

- Identical model IDs used through different provider eras are not presented as
  one attributed provider/model row.
- Copilot AI Credits and direct API estimates are visually and semantically
  separate.
- Provider era export contains no secret or full endpoint by default.

## Verification matrix

| Area | Cases |
| --- | --- |
| Platforms | Windows PowerShell/Windows Terminal, macOS Terminal, Linux with and without Secret Service |
| Routes | GitHub Copilot, Ollama no-auth, OpenAI-compatible API key, Anthropic API key, Azure, bearer-token gateway |
| Launch | terminal new, terminal resume, queued provider switch, copied-command fallback |
| Environment | no inherited variables, inherited BYOK variables, inherited offline, missing credential, rotated credential |
| Models | known GitHub ID, custom ID, colon-containing Ollama ID, separate wire model, unsupported tool calling |
| Attribution | TracePilot launch, queued switch, crash before confirmation, imported session, manual annotation, unknown external session |
| Security | key absent from logs/templates/export/clipboard; shell/MCP cannot read it; redirect does not leak it |
| Usage | Copilot-only, BYOK-only, provider switch at resume, model switch within era, crash without shutdown |
| Compatibility | supported CLI, pre-BYOK CLI, help/schema change, terminal/process differences |

Tests should include:

- pure profile validation and adapter unit tests;
- golden redacted PowerShell/POSIX launch plans;
- credential-store contract tests using a fake backend;
- Rust launcher tests for set/remove inheritance;
- IPC serialization tests proving secrets are absent from responses;
- parser/ledger tests for start/resume boundary reconciliation;
- database migration and reindex tests;
- Vue tests for redaction, missing-profile, unknown attribution, and switch
  states;
- end-to-end local mock-provider tests;
- manual real-Ollama smoke test.

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| CLI BYOK surface changes | Versioned capability probe, profile retest status, compatibility fixtures. |
| Secret leakage through the existing env/template flow | Dedicated secret references, template blocking/scrub, automatic `--secret-env-vars`. |
| User thinks a chat subscription is API access | Explicit setup copy and official billing links. |
| Model name is mistaken for provider | Separate route/profile/model fields and Unknown default. |
| Same session is resumed by two processes | Idle/ownership checks, a durable queued-resume state, session-lock release, and guided terminal exit. |
| Custom model behaves poorly with the harness | Capability guidance plus optional end-to-end tool/stream smoke test. |
| Static model registry rejects BYOK | Profile-scoped free model ID with safe argument encoding. |
| “Copilot” still routes to inherited BYOK | Explicit environment removal set. |
| Internal endpoint leaks through analytics/export | Store full URL only in private profile; use label/fingerprint elsewhere. |
| Cost is misleading | Separate billing units and label direct API costs as estimates. |
| Azure/Ollama URL examples vary by version | Installed-runtime adapter and exact smoke test. |
| Offline claim is overstated | Repeat GitHub's caveat: remote provider traffic still leaves the machine. |

## Open decisions for review

1. Is “switch provider and resume” required for the first release, or is
   one-click selection for new sessions plus guided resume sufficient?
2. Should provider profiles live in the existing TracePilot config hierarchy or
   a dedicated small database? The recommendation is dedicated profile storage
   plus OS credential store, with the analytics DB remaining a projection.
3. Should full endpoint hosts be visible in the session UI, or only in profile
   settings? The recommendation is profile name in session views and redacted
   host only on demand.
4. Should generic environment variables be allowed in reusable templates after
   known-secret blocking, or moved to secret references as a broader follow-up?
5. Do we want direct API pricing in the initial release? The recommendation is
   no: first make routing and attribution correct, then add provider-scoped
   estimates.

## Recommended approval

Approve Phase 0 and Phase 1 as the initial scope.

This delivers the core value without depending on an unsupported hot-switch
mechanism: users get reusable, secure, one-click routes for local/API/Copilot
sessions, and TracePilot gains reliable provider attribution for sessions it
launches. Phase 0 specifically gates the implementation on real BYOK fixtures,
secret isolation, resume behavior, and the installed CLI's observed behavior.

Do not begin implementation until the open decisions above are reviewed.
