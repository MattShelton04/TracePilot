# ADR-0014: Bounded loopback server for exact context capture

Date: 2026-07-22
Status: Accepted

## Context

Exact Context Capture must receive the request body produced by Copilot CLI without forwarding it to a model provider. The endpoint handles highly sensitive JSON and must enforce a loopback bind, an unguessable path, a one-request lifetime, a body limit, and prompt shutdown. A partial hand-written HTTP parser would need to reproduce method, path, header, transfer-encoding, body-limit, and disconnect behavior correctly.

## Decision

`tracepilot-orchestrator::context_capture::listener` uses Axum 0.7 over Tokio’s `TcpListener`.

The server:

- binds only to `127.0.0.1:0`;
- registers one exact nonce-bearing POST path for the selected protocol;
- applies Axum’s native request body limit at 32 MiB;
- validates a JSON-compatible content type and a complete JSON object;
- sends at most one body through a capacity-one channel;
- records only an allow-listed set of header names, never header values;
- returns an intentional non-success capture-complete response;
- has a 45-second workflow deadline and bounded graceful shutdown.

Axum is a direct dependency of `tracepilot-orchestrator`, although it was already present transitively in the workspace lockfile. This makes the security-relevant HTTP behavior explicit and reviewable.

## Consequences

The listener benefits from Hyper/Axum’s HTTP framing and body-limit handling and remains much smaller than a correct custom parser. It increases the orchestrator’s explicit API/dependency surface and must be reviewed when Axum’s major version changes.

The endpoint is not a same-user security boundary. The random path and short lifetime prevent accidental local traffic from being captured; OS user isolation remains responsible for protection from other local processes.

## Alternatives considered

- A hand-written `TcpListener` parser was rejected because partial HTTP parsing is fragile around chunking, header limits, slow bodies, and connection teardown.
- A reusable local LLM proxy was rejected because forwarding, retries, streaming emulation, and multi-request behavior expand the attack surface and contradict the one-shot product contract.
- OpenTelemetry-only capture was rejected because its semantic content is normalized and is not the exact wire request body.

## References

- `crates/tracepilot-orchestrator/src/context_capture/listener.rs`
- `docs/features/exact-context-capture-plan.md`
- `docs/exact-context-capture.md`
