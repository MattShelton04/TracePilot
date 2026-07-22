# Exact Context Capture

Exact Context Capture is an experimental TracePilot feature for inspecting the model API request body that the installed GitHub Copilot CLI builds when an inactive session is resumed in a controlled capture run.

The capture is local. TracePilot directs one request to a temporary listener on `127.0.0.1`, saves the request if you ask it to, returns an intentional error to stop inference, and never forwards the payload to a model provider.

## What the result means

The result is the exact UTF-8 JSON request body produced by your installed Copilot CLI for this capture run. TracePilot also records the request path, protocol, exact byte and character counts, SHA-256 hash, CLI version, source-session fingerprint, and fidelity warnings.

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

The probe remains in Raw JSON and is marked as synthetic in the Messages view. Hiding it changes only the view.

## Before you start

You need:

- a local Copilot CLI session containing `workspace.yaml` and `events.jsonl`;
- the source session to be closed and inactive;
- a compatible installed Copilot CLI;
- write access to TracePilot’s data directory and system temporary storage.

The initial implementation is tested against the capture capabilities exposed by Copilot CLI 1.0.71. TracePilot probes the configured executable before every capture and blocks the operation if required flags or routing support are missing.

## Enable the feature

1. Open **Settings**.
2. Open **Experimental**.
3. Enable **Exact Context Capture**.
4. Open a session and select its **Context** tab.

The feature is available from the main TracePilot window. Pop-out viewer windows do not receive capture permissions.

## Capture a request

1. Close the selected session in Copilot CLI. A live or recently active lock blocks capture.
2. In the session’s **Context** tab, find **Captured request snapshots** and select **Run preflight**.
3. Review the session status, working directory, CLI versions, model, protocol evidence, included resources, omitted resources, and warnings.
4. Confirm the wire protocol. TracePilot tries the following evidence in order:
   - the most recent persisted `assistant.usage` API endpoint;
   - a model-family compatibility fallback.
5. Choose storage behavior:
   - **View once** keeps the result only in the current app process/view;
   - **Save snapshot locally** writes plaintext files under TracePilot’s data directory.
6. Select **Capture isolated request**.

The progress dialog remains open while TracePilot copies the session, starts the loopback listener, resumes the clone, waits for one request, parses it, and removes temporary state. You can cancel while the capture is running.

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

## Inspect a snapshot

Open a saved snapshot from **Captured request snapshots**. A view-once result opens automatically after capture.

The viewer contains:

- **Overview** — provenance, exact body size, exact character count, clearly labelled estimated tokens, section sizes, request controls, unknown fields, and fidelity warnings;
- **System** — ordered system/instruction blocks recognized for the selected protocol;
- **Messages** — on-wire message/input order, roles and types, with the synthetic probe marked separately;
- **Tools** — tool names, descriptions, schemas, and compact-JSON sizes;
- **Raw JSON** — the unchanged request body and its SHA-256 hash.

Unknown top-level fields and unknown content blocks remain in Raw JSON even when TracePilot cannot normalize them. Raw JSON is the source of truth.

“Exact” applies to the received body and direct byte/character measurements. The displayed token total is a byte-based estimate and is labelled **Estimated**. Capturing JSON does not reveal the provider tokenizer’s exact section allocation.

Copying Raw JSON requires confirmation because clipboard history tools may retain sensitive content.

## Saved files and privacy

Saved captures use this layout:

```text
<tracepilotHome>/context-captures/
  <session-id>/
    <capture-id>/
      manifest.json
      request.json
```

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

Choose the protocol that the session’s model request is expected to use:

| Selection | Captured operation path | Main normalized fields |
| --- | --- | --- |
| OpenAI Chat Completions | `/v1/chat/completions` | `messages`, `tools`, sampling/stream controls |
| OpenAI Responses | `/v1/responses` | `instructions`, `input`, `tools`, reasoning/output controls |
| Anthropic Messages | `/v1/messages` | `system`, `messages`, `tools`, thinking/output controls |

If the CLI posts a different payload family than the selected protocol, TracePilot discards the result and asks you to rerun preflight with the correct selection.

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

### A saved snapshot cannot be opened

TracePilot verifies the byte count and SHA-256 hash every time it reads `request.json`. A mismatch indicates that the saved files were changed or corrupted; the snapshot is rejected rather than silently reparsed.
