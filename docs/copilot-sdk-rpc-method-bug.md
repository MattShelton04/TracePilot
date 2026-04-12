# Copilot Community Rust SDK — JSON-RPC Method Name Bug

> **Status:** Upstream bug — PR needed on [copilot-community-sdk/copilot-sdk-rust](https://github.com/copilot-community-sdk/copilot-sdk-rust)
>
> **Affects:** `session.model.getCurrent` and `session.model.switchTo` operations
>
> **Impact:** Model switching and model querying return `-32601 Unhandled method` errors

## Problem

The community Rust SDK sends **snake_case** JSON-RPC method names for model operations, but the Copilot CLI server expects **camelCase** method names (matching the official TypeScript/Python/Go/C# SDKs).

| Operation | Rust SDK sends (wrong) | CLI expects (correct) |
|---|---|---|
| Get current model | `session.model.get_current` | `session.model.getCurrent` |
| Switch model | `session.model.switch_to` | `session.model.switchTo` |

The CLI server returns `-32601 Unhandled method` because it doesn't recognize the snake_case variants.

## Evidence

### Official SDK method names (confirmed via all 4 official SDKs)

From the [official copilot-sdk](https://github.com/github/copilot-sdk):

- **TypeScript**: `connection.sendRequest("session.model.getCurrent", { sessionId })`
- **Python**: `self._client.request("session.model.getCurrent", ...)`
- **Go**: `a.client.Request("session.model.getCurrent", ...)`
- **C#**: `InvokeRpcAsync("session.model.getCurrent", ...)`

All four use **camelCase**.

### Community Rust SDK method names (wrong)

File: `src/session.rs` (rev `2946ba1`)

**Line 697** — `get_model()`:
```rust
let result = (self.invoke_fn)("session.model.get_current", Some(params)).await?;
```

**Line 716** — `set_model()`:
```rust
(self.invoke_fn)("session.model.switch_to", Some(params)).await?;
```

### Other methods — NO issues found

All other JSON-RPC method names in the Rust SDK are correct:

| Method | Name used | Status |
|---|---|---|
| `session.create` | `session.create` | ✅ Correct |
| `session.resume` | `session.resume` | ✅ Correct |
| `session.list` | `session.list` | ✅ Correct |
| `session.delete` | `session.delete` | ✅ Correct |
| `session.getLastId` | `session.getLastId` | ✅ Correct |
| `session.send` | `session.send` | ✅ Correct |
| `session.abort` | `session.abort` | ✅ Correct |
| `session.getMessages` | `session.getMessages` | ✅ Correct |
| `session.destroy` | `session.destroy` | ✅ Correct |
| `session.getForeground` | `session.getForeground` | ✅ Correct |
| `session.setForeground` | `session.setForeground` | ✅ Correct |
| `session.mode.get` | `session.mode.get` | ✅ Correct |
| `session.mode.set` | `session.mode.set` | ✅ Correct |
| `models.list` | `models.list` | ✅ Correct |
| `status.get` | `status.get` | ✅ Correct |
| **`session.model.getCurrent`** | `session.model.get_current` | ❌ **Wrong** |
| **`session.model.switchTo`** | `session.model.switch_to` | ❌ **Wrong** |

### Potentially wrong (not yet verified against CLI)

These methods also use snake_case but we haven't confirmed whether the CLI recognizes them:

| Rust SDK sends | Might need to be |
|---|---|
| `session.agent.get_current` | `session.agent.getCurrent` |
| `session.workspace.list_files` | `session.workspace.listFiles` |
| `session.workspace.read_file` | `session.workspace.readFile` |
| `session.workspace.create_file` | `session.workspace.createFile` |

## Required Fix (2-line change)

**File:** `src/session.rs`

### Change 1 — Line 697

```diff
-        let result = (self.invoke_fn)("session.model.get_current", Some(params)).await?;
+        let result = (self.invoke_fn)("session.model.getCurrent", Some(params)).await?;
```

### Change 2 — Line 716

```diff
-        (self.invoke_fn)("session.model.switch_to", Some(params)).await?;
+        (self.invoke_fn)("session.model.switchTo", Some(params)).await?;
```

### Optional — fix potentially wrong agent/workspace methods too

```diff
 // session.rs line 824
-        let result = (self.invoke_fn)("session.agent.get_current", Some(params)).await?;
+        let result = (self.invoke_fn)("session.agent.getCurrent", Some(params)).await?;

 // session.rs line 910
-        let result = (self.invoke_fn)("session.workspace.list_files", Some(params)).await?;
+        let result = (self.invoke_fn)("session.workspace.listFiles", Some(params)).await?;

 // session.rs line 925
-        let result = (self.invoke_fn)("session.workspace.read_file", Some(params)).await?;
+        let result = (self.invoke_fn)("session.workspace.readFile", Some(params)).await?;

 // session.rs line 940
-        (self.invoke_fn)("session.workspace.create_file", Some(params)).await?;
+        (self.invoke_fn)("session.workspace.createFile", Some(params)).await?;
```

## CLI Support Note

The official SDK test suites contain notes that `session.model.getCurrent` and `session.model.switchTo` were "not yet implemented in CLI" at the time those tests were written. However, these test comments may be outdated — the convenience methods (`session.setModel`) exist across all official SDKs, suggesting the CLI may have since added support. The fix is still correct regardless: the method names must match what the CLI server expects.

## TracePilot Workaround

TracePilot implements a raw JSON-RPC bypass for TCP mode connections:

- **TCP mode** (`--ui-server` / `--server --port`): TracePilot opens a direct TCP connection to the CLI server and sends the correct camelCase method names (`session.model.switchTo`), bypassing the SDK entirely. **Model switching works.**
- **Stdio mode** (SDK spawns its own process): Falls back to the SDK's `set_model()` which uses the wrong method name. Shows a friendly error message:

> "Model switching not supported by this CLI version. Model will be inferred from chat history."

The bypass is implemented in `crates/tracepilot-orchestrator/src/bridge/manager.rs` (`raw_rpc_call` function) using Content-Length framed JSON-RPC over TCP.

Once the upstream PR is merged, update the SDK revision in `Cargo.toml`:

```toml
# workspace Cargo.toml line 40
copilot-sdk = { git = "https://github.com/copilot-community-sdk/copilot-sdk-rust.git", rev = "<new-commit>", package = "copilot-sdk" }
```
