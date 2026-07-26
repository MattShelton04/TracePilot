# Exact Context Capture

Exact Context Capture is an optional TracePilot feature for inspecting the model API request body that the installed GitHub Copilot CLI builds. It supports isolated captures of an inactive session and fresh CLI context benchmarks.

The capture is local. TracePilot directs one request to a temporary listener on `127.0.0.1`, saves the request if you ask it to, returns an intentional error to stop inference, and never forwards the payload to a model provider.

## What the result means

The result is the exact UTF-8 JSON request body produced by your installed Copilot CLI and posted to the selected model API route for this capture run. TracePilot records the received bytes without reserializing them. The Raw view therefore preserves the original whitespace and property order.

The API provider normally parses this structured request after receiving it. It may apply server-side instructions, policy, model routing, field transformations, and provider-specific tokenization. A capture is therefore the exact client-side API request, not a representation of the model's final internal token stream.

### Is this the exact content the model continues from?

It is the closest exact boundary available from the client: every JSON field Copilot CLI sends to the model API, including ordered messages/input items, system instructions, tool definitions, controls, and unknown fields. TracePilot does not reconstruct or reserialize the Raw view.

An API model does not consume the HTTP JSON bytes directly. The provider parses the selected wire protocol and converts its fields into an internal model input before generation continues. That conversion can add provider instructions, translate roles or tools, apply policy, select a model snapshot, and tokenize the result. Only the provider can expose that post-parse representation. TracePilot therefore makes two separate claims:

- **Exact client request:** `request.json` is the unchanged UTF-8 HTTP entity body received from Copilot CLI.
- **Normalized inspection:** the System, Request items, Tools, and Overview views are parsed projections of those same bytes for navigation. They are convenient but are not a second source of truth.

If the question is “what did Copilot CLI give the provider to continue from?”, use Raw JSON. If the question is “what exact token IDs or hidden instructions did the provider give the model?”, this setup cannot observe that boundary.

It is not:

- a request recovered from an earlier historical turn;
- proof of the final provider-side prompt;
- guaranteed to match the original interactive environment;
- an exact per-section token ledger.

TracePilot resumes a copy of the session and adds this versioned probe to trigger the request:

```text
[TracePilot context capture <random nonce>]
Do not call tools. Reply with exactly CAPTURED.
```

The probe remains in Raw JSON and is marked as synthetic in the Request items view.

## Before you start

You need:

- a local Copilot CLI session containing `workspace.yaml` and `events.jsonl`;
- the source session to be closed and inactive;
- a compatible installed Copilot CLI;
- write access to TracePilot’s data directory and system temporary storage.

The initial implementation is tested against the capture capabilities exposed by Copilot CLI 1.0.71. TracePilot probes the configured executable before every capture and blocks the operation if required flags or routing support are missing.

## Enable the feature

1. Open **Settings**.
2. Find **Recommended** under **Additional Features**.
3. Enable **Exact Context Capture**.
4. Open a session and select its **Context** tab.

Enabling the feature also adds **CLI Context** under the sidebar's **Configuration** section.

## Benchmark fresh CLI context

Open **Configuration → CLI Context** when you want a session-independent snapshot. This view is intended for tracking changes between Copilot CLI versions or measuring the context added by a repository and your configured integrations.

Choose one of two environments:

- **Isolated baseline** starts a fresh CLI session with an empty workspace and empty temporary `COPILOT_HOME`. The installed CLI's built-in system instructions and tools remain available. This is the most repeatable profile for comparing CLI versions.
- **Repository environment** starts a fresh CLI session from a repository you select. TracePilot copies user settings, MCP configuration, skills, prompts, hooks, agents, and plugins into a temporary `COPILOT_HOME` when they exist. It does not copy authentication, credentials, session history, logs, command history, or package caches.

For a repository environment, choose from the registered and recent repository lists already used elsewhere in TracePilot, type a path, or browse for a directory. A successfully captured repository is added to the shared recent-repository history.

For either profile, enter the model ID and choose its expected wire protocol, then select **Capture snapshot**. The model ID is used both for Copilot's model-specific prompt/tool configuration and as the `model` value on the wire. Benchmark snapshots are always saved because their purpose is comparison over time. The repository environment may start configured MCP servers or other integrations as part of normal CLI context discovery; use the isolated baseline when you do not want those integrations involved.

“Repository environment” is an allowlisted reconstruction, not a complete clone of the user's Copilot home:

- `settings.json` and `mcp-config.json` are copied byte-for-byte when present;
- regular files below `skills/`, `prompts/`, `hooks/`, `agents/`, and `plugins/` are copied while symbolic links and non-regular entries are rejected;
- Copilot-managed `config.json` is parsed as JSON-with-comments and reduced to trust/setup state needed for non-interactive startup;
- identity/login records, remote experiment-assignment caches, command history, IDE connection state, session databases/history, logs, downloaded CLI packages, credentials, authentication, and non-allowlisted parent process environment variables are excluded.

Copied does not necessarily mean inserted into the first request. MCP servers contribute only the tools they successfully advertise during discovery. Disabled skills remain disabled. Prompt files normally define invokable commands and do not enter context until invoked. Hooks contribute only if their configured trigger runs before the first model request. Repository instructions contribute according to Copilot CLI's own discovery rules in the selected working directory.

The Raw JSON remains exact for this reconstructed execution environment. It should not be described as proof that every piece of state from an ordinary authenticated Copilot session was reproduced.

The selected repository is read in place so repository instructions and available files reflect its current state. The CLI writes its new session and other state only inside TracePilot's temporary capture directory, which is removed after the request is received or the capture is cancelled.

### Compare benchmarks

The **Compare** view requires two saved benchmark snapshots. Choose a before and after snapshot to compare:

- CLI version, profile, model, and repository provenance;
- total request size and estimated-token deltas;
- added, removed, or changed system instruction blocks;
- added, removed, or changed tool definitions, matched by tool name;
- added, removed, or changed request controls.

The comparison is structural: object keys are canonicalized before values are compared, so a JSON object whose properties were merely serialized in a different order is not reported as changed. Arrays remain ordered. Open either snapshot's **Raw JSON** view when byte order, whitespace, or exact property order matters.

Changed entries expand into a line diff. System instruction diffs are open by default; tool and request-control diffs can be expanded as needed. Strings are compared as text, while objects are rendered with canonical key order before diffing so serialization-only key movement does not obscure the semantic change.

The feature is available from the main TracePilot window. Pop-out viewer windows do not receive capture permissions.

## Capture a request

1. Close the selected session in Copilot CLI. A live or recently active lock blocks capture.
2. In the session’s **Context** tab, switch from **Context timeline** to **Request snapshots**, then select **New capture**.
3. Review the model, Copilot CLI version, working directory, and selected API request format.
4. Confirm the wire protocol. TracePilot tries the following evidence in order:
   - the most recent persisted `assistant.usage` API endpoint;
   - a model-family compatibility fallback.
5. Choose storage behavior:
   - **View once** keeps the result only in the current app process/view;
   - **Save snapshot locally** writes plaintext files under TracePilot’s data directory.
6. Select **Capture isolated request**.

The progress view remains in place while TracePilot copies the session, starts the loopback listener, resumes the clone, waits for one request, parses it, and removes temporary state. Its fixed-height layout prevents the page from jumping as status text changes, and you can cancel while the capture is running.

If the original working directory no longer exists, preflight warns that an empty temporary workspace will be used. Continuing explicitly accepts degraded fidelity.

## What TracePilot does internally

TracePilot performs these steps for each capture:

1. Validates the full session UUID and resolves it under the configured session-state directory.
2. Requires `events.jsonl` and `workspace.yaml`, checks the inactivity lock, scans the session with a 256 MiB copy limit, and fingerprints `events.jsonl`.
3. Rejects symbolic links, junctions, reparse points, and non-regular files.
4. Creates a private temporary `COPILOT_HOME` and copies the session to `session-state/<same-session-id>`. Lock files are omitted; session files and IDs are never rewritten.
5. Binds an HTTP listener to an OS-assigned port on `127.0.0.1` with a random 128-bit path. Only one protocol-specific JSON POST is accepted, up to 32 MiB.
6. Starts the configured Copilot executable directly with structured arguments, offline/no-remote options, a random dummy provider key, and the selected local wire adapter.
7. Receives one request and returns an intentional `400 TRACEPILOT_CAPTURE_COMPLETE` response. No model response or tool call is supplied.
8. Terminates the disposable CLI process tree, validates the request protocol, hashes and parses the body, and verifies that the source `events.jsonl` fingerprint is unchanged.
9. Saves the snapshot only when requested, then removes the temporary Copilot home and listener.

The isolated profile includes the copied session, installed CLI built-ins, and current repository discovery from the original working directory. It does not copy Copilot authentication, user settings, user MCP configuration, global skills or agents, logs, caches, other sessions, or TracePilot data into the temporary home.

Repository instructions and files may have changed since the original session ran. Current time wrappers, the installed CLI version, prompt-mode integration behavior, and the resume boundary can also change the generated request. These limitations are stored with every snapshot.

### How the endpoint “mock” works

TracePilot is not emulating a model and does not proxy the request to a real provider. It temporarily makes Copilot CLI's supported BYOK/custom-provider interface point at a local capture sink:

```text
Copilot CLI
  └─ POST http://127.0.0.1:<random-port>/<random-nonce>/<protocol-route>
       └─ one-shot TracePilot listener
            ├─ validates route, content type, size, and JSON syntax
            ├─ copies the received body bytes into memory unchanged
            ├─ hands those bytes to the capture runner
            └─ returns HTTP 400 TRACEPILOT_CAPTURE_COMPLETE
```

The random port is assigned by the operating system and the random 128-bit nonce is part of the only registered route. OpenAI Chat Completions and Responses receive a base URL ending in `/<nonce>/v1`; Anthropic receives `/<nonce>` because its SDK appends `/v1/messages` itself. The listener accepts only one matching JSON `POST` and has a 32 MiB body limit.

The listener necessarily removes HTTP transport framing (for example, chunk boundaries) because those bytes are not the request entity body. It does not pretty-print, canonicalize, or reserialize the entity body. It parses a borrowed view once to reject a non-JSON request; the original byte buffer is retained. After the disposable CLI process is stopped, the runner parses the same buffer again to build the navigation views and calculates the SHA-256 over the original bytes.

The intentional 400 is the stopping mechanism. TracePilot does not need to construct a plausible streaming model response, and Copilot never receives content it could execute as a tool call. A retry after the endpoint has been consumed is treated as a safety/fidelity failure rather than captured as a second request.

### Process and configuration isolation

For a fresh repository benchmark:

1. TracePilot canonicalizes the selected repository and runs the CLI with that directory as its working directory.
2. It creates a new temporary `COPILOT_HOME`.
3. It copies only allowlisted context inputs: `settings.json`, `mcp-config.json`, `skills/`, `prompts/`, `hooks/`, `agents/`, and `plugins/`.
4. It parses Copilot's JSON-with-comments `config.json`, retains only setup/trust keys needed for non-interactive startup, and writes strict sanitized JSON. Identity/login fields and remote experiment-assignment caches are never copied.
5. It clears the inherited process environment, restores only allowlisted OS/runtime variables (for example `PATH`, temporary-directory, user-home, locale, and platform runtime paths), sets random dummy provider credentials, enables offline/no-remote CLI options, and routes the selected protocol to loopback. Proxy variables and provider/API credentials are not inherited; loopback is explicitly exempted from proxying.
6. It terminates the disposable CLI process tree and removes the temporary home after capture, cancellation, timeout, or error.

The repository itself is read in place. This is necessary for the CLI's normal repository instruction discovery, but it also means repository hooks or configured integrations can behave as they normally do. The model request is never forwarded; integrations that run before the request can still have their own side effects. An integration that depends on a custom parent-process environment variable or authenticated proxy may not start in the isolated environment, so its tools may be absent from the captured request.

### Storage and reparsing

`request.json` is immutable evidence. `manifest.json` stores provenance, protocol, byte count, hashes, and fidelity warnings, but not a duplicate copy of parsed messages, system text, or tools. When a saved capture is opened, TracePilot verifies its size and SHA-256 and rebuilds the normalized views from `request.json`. Parser/UI improvements can therefore be applied to older captures without recapturing or migrating duplicated normalized content.

Persistence is published by atomically renaming a completed staging directory, so readers do not observe a manifest without its request body or vice versa.

## Inspect a snapshot

Open a saved snapshot from the **Request snapshots** Context view. A view-once result opens automatically after capture. Preflight, progress, and snapshot details stay within this view instead of opening separate modal windows.

The viewer contains:

- **Overview** — exact body size, clearly labelled estimated token totals and per-section breakdowns, request details, request controls, and other top-level fields;
- **System** — ordered system/instruction blocks shown as wrapped text when possible, with copy and JSON fallback controls;
- **Request items** — the complete on-wire sequence with filters for messages, tool calls, tool outputs, and the synthetic probe; large items render only when expanded;
- **Tools** — tool names, descriptions, recognized input fields, required inputs, enum values, and raw-definition fallbacks;
- **Raw JSON** — the unchanged request body and its SHA-256 hash, using a compact Tree/Raw JSON viewer and direct copy action. Large trees require an explicit parse action.

Unknown top-level fields and unknown content blocks remain in Raw JSON even when TracePilot cannot normalize them. Raw mode is the byte- and property-order source of truth. Tree mode expands nested JSON containers by default; request arrays retain their order, while the tree should not be used to compare raw serialization details.

“Exact” applies to the received body and direct byte/character measurements. The displayed token total is a byte-based estimate and is labelled **Estimated**. Capturing JSON does not reveal the provider tokenizer’s exact section allocation.

The copy buttons use the same direct clipboard action as TracePilot's other file viewers. Remember that clipboard history tools may retain copied request data.

## Saved files and privacy

Saved captures use this layout:

```text
<tracepilotHome>/context-captures/
  <session-id>/
    <capture-id>/
      manifest.json
      request.json
```

Fresh CLI benchmarks use the same immutable `manifest.json` plus `request.json` format under a reserved internal collection directory. Their manifests record `captureScope`, `captureProfile`, `cliVersion`, the selected `repositoryPath` when applicable, and `captureInputSha256` for the copied configuration inputs. This keeps them separate from real session IDs while allowing the same integrity checks, viewer, deletion flow, and diff tooling to operate on both kinds of capture.

`request.json` contains the exact captured request bytes in plaintext. It can include prompts, source code, file contents, tool results, instruction text, attachment data, and secrets that were already present in conversation history.

`manifest.json` contains versioned metadata and fidelity information. Parsed prompt/message/tool content is not duplicated there; TracePilot rebuilds normalized views from `request.json` when you open the snapshot.

On Unix-like systems TracePilot requests owner-only directory/file modes. On Windows it relies on the access controls inherited from your user-owned TracePilot data directory and temporary directory. Local loopback and filesystem permissions do not protect against malware already running as the same OS user.

Persistent captures have a 1 GiB total storage budget. TracePilot blocks a new saved capture instead of silently deleting existing evidence. You can still use **View once**.

Ordinary session exports, full-text search, and analytics do not include captured request bodies.

## Delete saved captures

To delete one snapshot, open it and select **Delete snapshot**.

To inspect total capture storage or delete every saved snapshot:

1. Open **Settings**.
2. Open **Data & Storage**.
3. Find **Captured request snapshots**.
4. Select **Delete all snapshots** and confirm the exact count and size.

Deleting captures does not delete or modify Copilot session history.

## Protocol guidance

“Wire protocol” means the provider's HTTP route and JSON contract. It is not the network transport (all three currently use local HTTP), and it is not a display preference. The choice configures Copilot CLI's provider adapter, the exact route exposed by the listener, and the parser used for inspection.

| Selection | Route | Conversation/system shape | Tool shape and typical controls | When to choose it |
| --- | --- | --- | --- | --- |
| OpenAI Chat Completions | `/v1/chat/completions` | One ordered `messages` array; system instructions are messages with a `system` role | `tools[].function.parameters`; sampling, token-limit, tool-choice, and stream fields | OpenAI-compatible/local providers and models that implement the established Chat Completions contract |
| OpenAI Responses | `/v1/responses` | Separate `instructions` plus an ordered, mixed-type `input` array | Responses tool definitions; reasoning, text/output, include, token-limit, and stream fields | GPT-5-family and other providers/models that explicitly use the Responses API |
| Anthropic Messages | `/v1/messages` | Separate `system` value plus ordered `messages`; message content is commonly an array of typed blocks | `tools[].input_schema`; `thinking`, token-limit, tool-choice, and stream fields | Claude models or Anthropic-compatible endpoints |

These envelopes can express similar concepts but are not interchangeable. For example, a Responses `input` array can contain messages, function calls, and function-call outputs as peers; Chat Completions represents the conversation through role-bearing messages; Anthropic represents tool use/results as typed content blocks. TracePilot preserves the original order and unknown blocks even when it does not have a specialized renderer for them.

If the CLI posts a different payload family than the selected protocol, TracePilot discards the result and asks you to rerun preflight with the correct selection.

The model name also matters independently of the wire protocol. Copilot uses the model ID to select model-specific context limits, tool support, and prompting strategies. A compatible protocol with the wrong model ID can therefore produce a technically valid request that is not representative of the model you intended to benchmark.

## Maintainability and extension points

The current design separates responsibilities cleanly:

- the **runner** owns Copilot CLI arguments, environment isolation, lifecycle, and cleanup;
- the **listener** owns the one-shot loopback HTTP boundary and unchanged body bytes;
- the **protocol parser** owns provider-shape detection and normalized projections;
- **persistence** owns atomic storage and integrity verification;
- the **viewer and comparison** operate on the versioned snapshot type.

This makes normal protocol evolution maintainable: add newly recognized controls or content-block renderers without changing stored evidence; add a new protocol by defining its route, provider configuration, detector, parser, and fixtures; update Copilot launch behavior without changing the storage format.

There are deliberate coupling points:

- Copilot CLI flags and BYOK environment variables can change between versions, so capability preflight and hands-on tests must track supported releases.
- A one-shot error response assumes the client emits the complete first request before it requires any model response.
- The current listener registers known HTTP `POST` routes and rejects retries. It is not yet a transparent proxy, TLS endpoint, WebSocket server, or streaming protocol emulator.
- Normalized comparison matches tools by name and system blocks by source/index. Raw JSON remains available when a protocol needs a different semantic matching strategy.
- The final process-tree `Drop` safeguard invokes the platform termination command synchronously. This preserves the no-orphan guarantee if an async cleanup future is itself dropped, but can briefly block that thread; native Windows job objects would remove that tradeoff in a future lifecycle refactor.

### Could this inspect Claude Code, Codex, or an arbitrary request?

The capture/persistence/viewing core can support it, but connecting another client should be implemented as a client adapter rather than adding its launch flags to the Copilot runner. A maintainable extension would define:

```text
CaptureClientAdapter
  ├─ preflight capabilities
  ├─ construct isolated environment and launch command
  ├─ choose route/transport adapter
  ├─ provide model/protocol provenance
  └─ terminate and clean up
```

Clients that accept an HTTP base URL and send a conventional JSON request can reuse most of the listener and all persistence/viewer code. Clients that require TLS certificate trust, WebSockets, protobuf, encrypted payloads, or a successful streaming response need a transport-specific capture adapter. If a client retries on the intentional 400, the safer design is a protocol-correct terminal mock response or an explicit non-forwarding proxy mode—not silently accepting whichever retry happens to arrive.

An “inspect this arbitrary request” import path is simpler: accept bytes plus declared/detected protocol, validate them, and persist them through the same snapshot pipeline without launching a CLI. That would inspect supplied request bodies, but it would not prove that a real client emitted them unless TracePilot observed the transport boundary.

The key design constraint should remain: immutable raw bytes are the evidence; parsers and UI are replaceable interpretations.

## Troubleshooting

### The session is active

Exit or close that Copilot CLI session, wait for its lock/activity state to settle, and rerun preflight. TracePilot does not copy live session databases.

### Required CLI capabilities are missing

Confirm **Settings → General → CLI command** points to a current Copilot executable without additional shell arguments. Update Copilot CLI if its help does not expose resume, prompt, JSON output, offline routing, and the required non-interactive safety flags.

### No request arrived within 45 seconds

Check the selected protocol and model, then retry. A CLI/runtime change may have altered custom-provider routing. The source session remains untouched, and temporary state is removed.

### The source changed during capture

Another process modified `events.jsonl`. Close all processes using the session and retry. TracePilot discards the capture rather than presenting an inconsistent result.

### The CLI exits before sending a request

Review the preflight CLI version, working-directory warning, model, and protocol. Because process output may contain context, TracePilot deliberately discards stdout/stderr instead of copying it into application logs.

### JSON parse error at line 1 column 1

Copilot CLI manages `~/.copilot/config.json` as JSON with leading `//` comments. Current TracePilot builds accept that format while creating the sanitized temporary setup state. If this error persists, the message should identify the exact Copilot configuration or captured-request file that is invalid; inspect that file without replacing it, because TracePilot will not overwrite malformed user configuration.

### A saved snapshot cannot be opened

TracePilot verifies the byte count and SHA-256 hash every time it reads `request.json`. A mismatch indicates that the saved files were changed or corrupted; the snapshot is rejected rather than silently reparsed.
