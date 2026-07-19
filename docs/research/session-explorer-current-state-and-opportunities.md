# Session Explorer: current state and opportunities

**Review date:** 2026-07-19  
**Repository snapshot:** `59e66c76`  
**Scope:** The **Explorer** tab inside a Copilot CLI session detail page. This is distinct from the Sessions library/search page, which is also described as a “session explorer” in some older project material.

## Implementation update

The first recommended slice has now been implemented in the working tree:

- **Secure image preview:** `.png`, `.jpg`/`.jpeg`, `.webp`, and `.gif` use a dedicated backend command. Files are contained to the selected session, capped at 20 MiB encoded input, content-sniffed and decoded with strict 16,384 px-axis/40-megapixel limits, resized to a maximum 4,096 px edge, and re-encoded as a bounded metadata-free PNG before entering the WebView. Animated GIFs deliberately show the first frame.
- **Structured developer formats:** JSON has expandable tree/raw modes; JSONL has record/raw modes, filtering, malformed-record indicators, and a 2,000-record structured cap; CSV/TSV has table/raw modes, explicit tab handling for `.tsv`, delimiter/header detection, filtering, and 2,000-row/200-column display caps. The raw/structured preference is retained in local storage at file-type granularity.
- **Folder-wide search:** name/path filtering is immediate, automatically expands matching folder paths, and works over the existing listing. Content search is a 300 ms debounced, stale-response-safe backend operation: case-insensitive literal matching, 2 MiB per readable file, 32 MiB total, 200 results, and 20 results per file. `events.jsonl`, binary, image, and SQLite data is not opened. Automatic file refresh does not rerun or flash unchanged search results; manual refresh explicitly reruns the active query in the background.
- **Result navigation and in-file search:** selecting a content result opens the artifact, loads the larger bounded preview when needed, highlights the query, and scrolls to the matching line. A separate find-in-file control supports literal highlighting and previous/next navigation in the open text file. Structured and rendered Markdown views temporarily use raw source while a source match is active.
- **Image interaction:** image previews support pointer-centered mouse-wheel zoom from 25–400%, button zoom/fit/100%, and drag-to-pan on the bounded sanitized preview.
- **On-demand larger reads:** initial text reads remain capped at 1 MiB for fast selection and live refresh. The user can explicitly request up to 16 MiB for the selected file; the viewer continues to disclose truncation.
- **Reliability polish:** list and type-specific viewer errors/loading states are wired through, manual refresh has spinner/success feedback, stale read/search responses remain guarded, and invalid “copy contents” actions are hidden for image, binary, and SQLite entries.

Papa Parse is the only new frontend parser dependency. It is small, has no runtime dependencies, detects CSV delimiters, and avoids maintaining a home-grown CSV grammar. JSON and JSONL use a native Vue recursive tree so no general visualization framework was needed. Raster decoding uses Rust’s `image` crate with only PNG, JPEG, WebP, and GIF codecs enabled.

The baseline analysis below is retained to explain the original gaps and design rationale. Items in the opportunity table now include an implementation status.

## Executive summary

The Session Explorer is a local, read-only browser for the files in one Copilot CLI session state directory. It is more capable than a basic file list:

- It reconstructs a nested, collapsible tree from a bounded backend listing.
- It renders Markdown, source/config/text files, structured JSON/JSONL, CSV/TSV, sanitized raster-image previews, and SQLite data in-app.
- It silently refreshes active sessions, preserves scroll/focus, and highlights new or changed files.
- It supports copying paths/content and revealing files or folders in the OS file explorer.
- Its backend has deliberate filesystem containment, symlink, hidden-file, traversal, device-name, size, depth, entry-count, and SQLite-result safeguards.

The largest original product gap was that all non-SQLite binary formats shared one placeholder. The implementation now uses the recommended dedicated, bounded `session_read_image_preview` command: it validates, decodes, downsizes, and re-encodes an allow-listed raster image before returning it to the WebView. It does not expose a general local-file URL or broaden filesystem permissions.

Before or alongside images, there are several inexpensive reliability and usability improvements:

1. Surface file-list and SQLite loading/read errors that are already tracked but not displayed.
2. Stop offering “Copy File Contents” for binary and SQLite files, where it currently fails by design.
3. Add file-name/path filtering and a manual refresh action using data already loaded in the frontend.
4. Clearly indicate when backend limits truncate a file, tree, or SQLite result.

## Background and user purpose

Copilot CLI owns a local session directory, normally:

```text
~/.copilot/session-state/<session-id>/
├── workspace.yaml
├── events.jsonl
├── session.db
├── plan.md
├── vscode.metadata.json
├── checkpoints/
├── files/
├── research/
└── rewind-snapshots/
```

Not every session contains every file. `workspace.yaml` is session metadata, `events.jsonl` is the append-only event stream, `session.db` contains todos and potentially arbitrary agent-created tables, and the remaining folders hold plans, compaction checkpoints, research, workspace artifacts, and rewind metadata. The repository’s [Copilot CLI evolution research](copilot-cli-evolution-risks.md#21-directory-structure) contains the fuller observed layout and format notes. The authoritative application path inventory is [on-disk-paths.md](../on-disk-paths.md).

Most TracePilot tabs interpret particular parts of this data. Explorer serves a different purpose: it exposes the source artifacts themselves. That is useful when a developer wants to:

- verify what Copilot persisted rather than only seeing TracePilot’s interpretation;
- inspect a plan, checkpoint, research note, or agent-created file;
- troubleshoot a parser, incomplete session, or CLI version change;
- watch artifacts appear or change while a session is still running;
- copy a path or raw content into an editor, terminal, issue, or debugging workflow.

The feature first appeared in `0.6.3` on 2026-04-19. Subsequent work added a richer SQLite viewer, safer path handling, stable auto-refresh, nested-folder fixes, and file actions. See the relevant entries in [CHANGELOG.md](../../CHANGELOG.md).

## What the product currently offers

### Entry point and layout

- Explorer is a routed session-detail tab at `/session/:id/explorer`, and is also supported inside the multi-tab/pop-out session detail view.
- It uses the standard session header and actions, including opening the session state folder.
- The body is a two-pane layout:
  - left: resizable file tree, currently 160–500 px wide and initially 240 px;
  - right: type-aware content viewer.
- `workspace.yaml` or `workspace.yml` is auto-selected when present.
- Folders containing more than 10 descendant files auto-collapse unless the user has explicitly toggled them.

Evidence: [ExplorerTab.vue](../../apps/desktop/src/views/tabs/ExplorerTab.vue), [sessionTabs.ts](../../apps/desktop/src/config/sessionTabs.ts), and [useFileBrowserTree.ts](../../packages/ui/src/composables/useFileBrowserTree.ts).

### File tree behavior

- Displays nested folders and files alphabetically, with folders grouped ahead of files by the backend and rebuilt hierarchically in the UI.
- Shows the file count and each file’s byte size.
- Uses distinct icons for Markdown, JSON/JSONL, YAML, TOML, SQLite, lock/certificate-like files, and logs/text.
- Supports mouse selection and Enter on focused file rows.
- Supports collapse/expand for folders.
- Highlights newly created files and files whose size changed after a silent refresh.
- Preserves existing tree DOM, scroll, and focus during silent refresh.

Current limitations:

- Name/path and content search are now available; there is still no type filter, “collapse all,” or “expand all.”
- No Arrow-key tree navigation or keyboard-accessible context menu.
- The splitter is mouse-only and its width is not persisted.
- Same-size rewrites are not detected because the listing contains size but not modification time or a content fingerprint.
- The tree can be silently incomplete after the backend’s depth or entry cap.
- `filesError` is tracked but not rendered, so a failed listing can look like an empty session.

Evidence: [FileBrowserTree.vue](../../packages/ui/src/components/FileBrowserTree.vue), [useSessionFiles.ts](../../apps/desktop/src/composables/useSessionFiles.ts), and [ExplorerTab.vue](../../apps/desktop/src/views/tabs/ExplorerTab.vue).

### Viewer behavior by file type

| Backend classification | Extensions / examples | Current viewer |
| --- | --- | --- |
| `markdown` | `.md`, `.markdown` | Rendered Markdown via `markdown-it`, then sanitized with DOMPurify |
| `jsonl` | `.jsonl` | Filterable structured record list with expandable values, malformed-line indicators, and raw toggle |
| `json` | `.json` | Expandable tree with lazy child batches, parse-error fallback, and raw toggle |
| `csv` | `.csv`, `.tsv` | Searchable table with delimiter/header/error metadata and raw toggle |
| `image` | `.png`, `.jpg`, `.jpeg`, `.webp`, `.gif` | Sanitized PNG preview with fit/100%/zoom controls, dimensions, original format/size, and downscale/animation notices |
| `yaml` | `.yaml`, `.yml` | Syntax-highlighted code view |
| `toml` | `.toml` | Syntax-highlighted code view |
| `text` | common source, script, config, log, XML/HTML files; dotless names; most unknown extensions | Syntax-highlighted code/plain-text view |
| `sqlite` | `.db`, `.sqlite`, `.sqlite3` | Read-only table browser with table tabs, Data/Schema views, resizable columns, expanded-cell modal, and “copy table as JSON” |
| `binary` | PDF/Office, archives, executables, audio/video, compiled objects, unsupported image codecs | Generic “Binary File” placeholder |

Text reads initially cap at 1 MiB and receive a visible trailing truncation notice. The user can explicitly load up to 16 MiB. The code renderer shows at most 5,000 lines, with a collapsed-line count. Markdown is rendered rather than line-capped.

SQLite reads dynamically discover user tables. Up to 50 tables and 500 rows per table are returned. The viewer prefers `todos` on first open, preserves the active table during refresh, and allows inspecting arbitrary custom table schemas. SQLite connections are opened read-only.

Current limitations:

- JSON/JSONL now have expandable structured modes, but no JSON-path copy/breadcrumb or event-aware navigation. YAML remains syntax-highlighted text.
- CSV/TSV is tabular, but does not yet sort columns or virtualize beyond its display caps.
- `.diff` and `.patch` normally remain plain text even though TracePilot already has a rich diff renderer elsewhere.
- Very large JSONL/log files show the **first** 1 MiB, not the newest tail.
- Raster images show dimensions/format/size metadata; other binary files have no metadata beyond filename and byte size.
- Markdown image references do not resolve to session files. Remote images are also blocked by the desktop Content Security Policy, which is desirable for privacy.

Evidence: [file browser types](../../crates/tracepilot-tauri-bindings/src/commands/file_browser/types.rs), [FileContentViewer.vue](../../packages/ui/src/components/FileContentViewer.vue), [CodeBlock.vue](../../packages/ui/src/components/renderers/CodeBlock.vue), [MarkdownContent.vue](../../packages/ui/src/components/MarkdownContent.vue), and [SQLite read-only connection](../../crates/tracepilot-core/src/utils/sqlite/connection.rs).

### File and folder actions

From the selected-file header:

- Copy the absolute file path.
- Copy text file content.
- Copy the active SQLite table as JSON.

From the right-click menu:

- File: copy path, copy contents, open containing folder.
- Folder: copy path, open folder.

The session detail header can open the root session state folder.

Current limitations:

- The context menu is pointer-only, does not reposition at viewport edges, and does not currently expose standard menu semantics/focus handling.
- There is no “Open file with default application” or “Open in editor.”
- Absolute paths for copy/reveal are reconstructed from frontend preferences plus the session ID. Backend reads independently resolve and canonicalize the configured session root.

Evidence: [ExplorerTab.vue](../../apps/desktop/src/views/tabs/ExplorerTab.vue) and [FileContextMenu.vue](../../apps/desktop/src/components/session/FileContextMenu.vue).

### Live-session behavior

When global auto-refresh is enabled:

- the explorer periodically relists the directory;
- new paths and size-changed files briefly highlight;
- the selected text file is re-read without replacing the viewer DOM unless content changed;
- the selected SQLite database is re-read;
- stale async responses are discarded with monotonic request counters;
- existing content remains visible when a silent refresh fails.

This is a good foundation for live artifact inspection. The main accuracy limitation is size-only change detection, and the main scalability limitation is repeatedly transferring/parsing the first 1 MiB of an open growing file.

## Underlying data and data flow

### Data model crossing IPC

The backend returns a flat list:

```ts
interface SessionFileEntry {
  path: string;          // relative to the session root, forward slashes
  name: string;
  sizeBytes: number;     // 0 for directories
  isDirectory: boolean;
  fileType:
    | "markdown"
    | "jsonl"
    | "json"
    | "yaml"
    | "toml"
    | "sqlite"
    | "text"
    | "binary";
}
```

SQLite is returned as a list of dynamically discovered tables:

```ts
interface SessionDbTable {
  name: string;
  columns: string[];
  rows: (string | number | null)[][];
  columnInfo: SessionDbColumn[];
  indexes: SessionDbIndex[];
}
```

The listing does **not** currently include modification time, MIME/media type, dimensions, hash/fingerprint, file permissions, a truncated-list flag, or the actual canonical root.

Evidence: [session types](../../packages/types/src/session.ts) and the mirrored [Rust types](../../crates/tracepilot-tauri-bindings/src/commands/file_browser/types.rs).

### Request path

```text
Session route / tab context
        |
        v
useSessionFiles(sessionId)
        |
        +-- session_list_files(sessionId)
        |       |
        |       v
        |  configured sessionStateDir/<sessionId>
        |  canonical, bounded directory walk
        |       |
        |       v
        |  flat SessionFileEntry[] --> frontend rebuilds tree
        |
        +-- selected text path --> session_read_file
        |                          --> <= 1 MiB UTF-8/lossy text
        |
        +-- selected .db path ---> session_read_sqlite
        |                          --> <= 50 tables x 500 rows
        |
        +-- selected binary -----> no backend read
                                   --> placeholder only
```

All reads are direct from Copilot-owned session files. Explorer does not read the TracePilot search index, and it does not upload file content. This distinction matters: the explorer can show newly created artifacts before a reindex and can show files that are not otherwise interpreted by TracePilot.

### Current trust boundary and resource controls

The backend treats session contents as untrusted, including content produced by an agent:

- validates the session ID before joining paths;
- requires a non-empty relative path and rejects absolute paths, `..`, drive-relative paths, colons, and Windows reserved devices;
- canonicalizes the session root and target, then checks target containment;
- revalidates containment after the existence check to reduce a symlink-swap race;
- excludes symlinks and dotfiles from listings and refuses hidden-file reads;
- canonicalizes subdirectories before recursion;
- caps the walk at 2,000 entries and depth 8;
- caps text reads at 1 MiB using one opened, bounded file handle;
- refuses binary/SQLite through the text endpoint;
- opens SQLite read-only and caps output to 50 tables and 500 rows per table;
- renders code using escaped tokens;
- renders Markdown with inline HTML disabled and DOMPurify sanitization;
- blocks unexpected link schemes, prevents WebView navigation for session-provided links, and uses a restrictive application CSP.

Evidence: [security.rs](../../crates/tracepilot-tauri-bindings/src/commands/file_browser/security.rs), [commands.rs](../../crates/tracepilot-tauri-bindings/src/commands/file_browser/commands.rs), [markdownLoader.ts](../../packages/ui/src/utils/markdownLoader.ts), [MarkdownContent.vue](../../packages/ui/src/components/MarkdownContent.vue), and [tauri.conf.json](../../apps/desktop/src-tauri/tauri.conf.json).

Residual limitations worth preserving or addressing:

- Extension classification is not content sniffing. Most unknown extensions default to text and are decoded lossily.
- Listing caps are silent, so users cannot tell that the visible tree is partial.
- The list’s metadata read and the later content read are separate snapshots during a live session.
- Content can contain secrets, prompts, proprietary code, filesystem paths, or screenshots. Preview features should remain local, should not make network requests, and should avoid implicit clipboard or external-application actions.

## Secure raster image preview proposal

### Product recommendation

Add in-app preview for **PNG first**, with JPEG and WebP in the same implementation if decoder support and tests are straightforward. Treat GIF as a static first-frame preview initially, or defer it. Continue to show a safe placeholder for all other binary formats.

This is high-value because screenshots, generated diagrams, browser captures, UI references, and test artifacts are common outputs of developer-agent workflows. It also unlocks a later, separate feature: resolving relative image references inside a session Markdown file through the same guarded preview service.

### Why the existing API cannot simply be reused

`session_read_file` explicitly rejects `.png`, `.jpg`, `.webp`, and other binary formats. This is correct: decoding arbitrary bytes through the text path would corrupt data and make size/memory behavior unclear. The desktop CSP also does not allow `file:` or Tauri asset URLs; it currently allows only same-origin and `data:` images.

Therefore image preview requires:

- a new backend command and response type;
- mirrored TypeScript/client bindings;
- image state and stale-request handling in `useSessionFiles`;
- a dedicated viewer branch and controls;
- security, malformed-input, resource-limit, frontend, and CSP tests.

This is a **medium-sized vertical change**, not a deep change to the session index or Copilot data model.

### Recommended API shape

```ts
interface SessionImagePreview {
  // Always generated by TracePilot, rather than trusting the source extension.
  mediaType: "image/png";
  base64Data: string;
  width: number;
  height: number;
  originalSizeBytes: number;
  originalFormat: "png" | "jpeg" | "webp" | "gif";
  wasDownscaled: boolean;
  animationOmitted: boolean;
}

sessionReadImagePreview(
  sessionId: string,
  relativePath: string
): Promise<SessionImagePreview>
```

The WebView can construct `data:image/png;base64,...`, which works with the existing `img-src 'self' data:` CSP. A bounded preview keeps the base64 and IPC overhead predictable. If profiling shows data URLs create too many copies, a narrowly scoped app-owned custom protocol can be evaluated later; it should not be the first implementation.

### Backend safety requirements

Reuse the existing file-browser guards, then add image-specific controls:

1. Validate `sessionId`, relative path, hidden-file policy, canonical containment, and target type exactly as text/SQLite reads do.
2. Allow-list source extensions (`png`, `jpg`, `jpeg`, `webp`, optionally `gif`) **and** verify the decoder-detected format/magic bytes. An extension alone is not proof of content.
3. Open and read through a bounded handle. A reasonable first input limit is 20 MiB; confirm against representative session screenshots.
4. Configure decoder limits before allocating:
   - maximum source dimensions;
   - maximum decoded pixel count;
   - maximum decoder allocation;
   - no multi-frame decode for the first release.
5. Decode in a blocking worker, downscale to a bounded preview (for example, maximum 4,096 px on either edge), and re-encode to PNG.
6. Strip source metadata by re-encoding. This removes EXIF location/camera fields, ICC/comment payloads, and format-specific ancillary data from the WebView payload.
7. Return only the sanitized preview and explicit metadata. Do not return the original absolute path or raw bytes.
8. Do not support SVG rendering in this endpoint. SVG is active XML content and can contain external references, filters, and historically risky constructs. Explorer can continue to show SVG source as escaped text; a future visual SVG preview would require a separate sanitizer/rasterizer threat model.
9. Do not use `convertFileSrc`, `file://`, a broadly scoped Tauri asset protocol, or expanded filesystem capabilities. Those approaches make it easier for a frontend compromise to request files outside the intended session API.
10. Preserve the read-only contract: no thumbnail or cache files should be written inside Copilot’s session directory.

A Rust image library introduces dependency and decoder attack surface, so it should be pinned, audited with the existing Rust supply-chain checks, fuzzed or exercised with a malformed-image corpus, and kept current.

### Frontend behavior

- Use `object-fit: contain` inside the existing bounded viewer.
- Show path, original format, dimensions, original byte size, and whether the preview was downscaled or animation was omitted.
- Offer fit-to-view, actual-size/100%, zoom in/out, reset, and checkerboard/neutral background for transparency.
- Preserve zoom/scroll on silent refresh when dimensions are unchanged; show the existing changed-content pulse when a new preview arrives.
- Provide “Copy File Path” and “Open Containing Folder.” “Copy Image” can be a later enhancement because cross-platform binary clipboard behavior needs separate testing.
- Provide explicit, actionable states for corrupt, unsupported, over-limit, and changed-during-read images.
- Revoke any object URLs if an object-URL implementation is chosen; discard stale responses when the user rapidly selects files.
- Give the image a safe alt label based on its relative filename. Do not infer or transmit image content.

### Image acceptance/security tests

- Valid PNG, JPEG, WebP, transparent PNG, very wide/tall image, and optional animated GIF.
- Incorrect extension, corrupted/truncated file, polyglot input, zero dimensions, oversized encoded file, oversized dimensions/pixel count, and decompression-bomb fixture.
- `../`, absolute, drive-relative, reserved-device, dotfile, directory, symlink, and symlink-swap cases.
- No absolute-path disclosure in the image response or errors.
- Rapid A → B selection cannot display A after B.
- Session change clears preview data.
- Auto-refresh does not flash or reset zoom unnecessarily.
- CSP continues to reject remote images; no new `file:`, `blob:` (unless intentionally chosen), network, object, or frame source is added.
- The Tauri main and viewer-window capability sets grant only the new TracePilot command.

### Estimate

**M: approximately 4–7 engineering days**, including Rust/client/frontend work, dependency review, tests, and visual QA. PNG-only without decode/re-encode could be made faster, but returning raw untrusted image bytes would weaken the safety and privacy story and is not recommended.

## Other common file formats worth showing better

| Format | Current behavior | Recommended next behavior | Security/implementation note | Effort |
| --- | --- | --- | --- | --- |
| `.csv`, `.tsv` | Text/code view | Virtualized table with delimiter/header detection, sort/filter, raw toggle | Existing bounded text API is enough for an initial version; use a parser with formula output treated as inert text | S–M |
| `.json` | Code view | Collapsible tree, path breadcrumb, validation error, find/copy JSON path, raw toggle | Existing text API is enough; parse off the main render path and respect 1 MiB cap | M |
| `.jsonl` | First 1 MiB as JSON-highlighted text | Record list, per-record expand, event-type filter, malformed-line indicators, follow-tail | Structured view can start frontend-only; efficient tailing/ranges require a new backend API | M for structured first chunk; L for tail/follow |
| `.diff`, `.patch` | Usually plain text | Unified/split diff with file/hunk navigation and raw toggle | Reuse/refactor the existing tool-result diff renderer; never apply a patch from preview | S–M |
| `.log`, large `.txt` | First 1 MiB text | Search, wrap toggle, tail N lines, follow mode, pause/resume | Tail/range reads need bounded offset APIs and careful UTF-8 boundary handling | M |
| `.svg` | Escaped source text through the unknown-text fallback | Keep source view; optional rasterized visual preview much later | Do not inject source SVG into DOM or `<img>` without a dedicated sanitizer/rasterizer and external-resource blocking | L |
| `.pdf` | Binary placeholder | Page thumbnails and sandboxed/rasterized page preview | Avoid WebView PDF plugins/iframes; use a maintained parser/rasterizer with page/file/resource caps | L |
| `.zip`, `.tar`, compressed archives | Binary placeholder | Manifest-only list of entries and sizes; no extraction by default | Defend against zip slip, nested archives, compression bombs, huge entry counts, and encrypted archives | M–L |
| `.wav`, `.mp3`, `.mp4` | Binary placeholder | Metadata first; optional explicit local playback later | Disable autoplay, cap metadata parsing, and retain strict CSP; likely lower session-specific value | M |
| `.docx`, `.xlsx`, `.pptx` | Binary placeholder | Metadata/manifest or explicit open externally | Full in-app rendering is high-risk/high-cost and duplicates native tools; do not unzip/render arbitrary embedded HTML automatically | L–XL |
| unknown/binary | Generic placeholder | Hex/strings preview of a small bounded prefix plus detected signature | Useful for diagnostics; never execute, deserialize, or load as a plugin | M |

Suggested order by likely developer-session value: raster images, structured JSON/JSONL, CSV/TSV, diff/patch, log tailing, then PDF/archive metadata. Office and media preview are lower priority.

## Prioritized product opportunities

Effort scale:

- **XS:** less than 1 engineering day
- **S:** 1–3 days
- **M:** 3–7 days
- **L:** 1–3 weeks
- **XL:** more than 3 weeks or significant product/architecture discovery

Estimates include focused tests but not release coordination. They are directional, not commitments.

| Priority | Opportunity and user story | User value | Existing support / required change | Effort |
| --- | --- | --- | --- | --- |
| P0 | **Implemented — wire all error/loading states.** “As a developer, I want to know whether the session is empty, still loading, truncated, or unreadable so I do not mistake a failure for missing data.” | Trust and diagnosability | List/text/image/SQLite loading and errors plus manual retry/refresh are now connected. Explicit listing-limit metadata remains future work. | XS–S |
| P0 | **Implemented — make context actions type-aware.** “As a developer, I only want actions that can succeed for the selected file.” | Removes a predictable failure | Text-copy is no longer offered for image, binary, or SQLite entries. | XS |
| P1 | **Implemented — safe raster image preview.** “As a developer, I want to inspect screenshots and generated diagrams without leaving the session.” | High-value artifact continuity | Dedicated bounded backend endpoint, typed client state, controls, and security tests are present. No index schema change was needed. | M |
| P1 | **Partly implemented — file search/filter and tree controls.** “As a developer, I want to jump to a file by partial name/path or matching content in a large session.” | Faster navigation, especially in `research/` and `files/` | Name/path filtering is frontend-only; bounded content search has a guarded backend API. Type filter and collapse/expand-all remain. | S–M |
| P1 | **Expose freshness and limits.** “As a developer watching a live session, I want accurate changed markers and clear warnings when I am seeing partial data.” | Prevents stale/partial-data confusion | Add `modifiedAt` to entries and explicit `listingTruncated`, depth-limit, text truncation metadata, and SQLite row/table truncation metadata. Requires additive backend response changes. | M |
| P1 | **Partly implemented — structured JSON/JSONL viewer.** “As a developer debugging a session artifact, I want to expand records and filter records instead of scanning raw lines.” | Strong fit with session data | Expandable trees, record filtering, malformed-line feedback, raw fallback, and on-demand 16 MiB reads are present. JSON-path copy and tail/follow remain. | M |
| P1 | **Artifact-aware labels and explanations.** “As a newer TracePilot user, I want to understand what `workspace.yaml`, `events.jsonl`, `session.db`, checkpoints, and rewind files represent.” | Makes raw data approachable | Known file/folder roles can be mapped in the frontend. Show a small role badge/description and links to corresponding TracePilot tabs where applicable. | S |
| P2 | **Efficient tail/follow for active JSONL and logs.** “As a developer, I want to see the newest events without repeatedly loading the start of a large file.” | Better live debugging and performance | Requires a backend `read_range`/`read_tail` contract with byte offsets, stable file identity/size, UTF-8 boundary handling, rotation/truncation behavior, and polling or watcher integration. | L |
| P2 | **Partly implemented — rich CSV and diff viewers.** “As a developer, I want tables and patches to read like their native structures while retaining a raw view.” | Better inspection of common agent outputs | CSV/TSV now has a searchable table/raw viewer. Diff can still share/refactor TracePilot’s existing rich tool diff renderer. | S–M each |
| P2 | **Keyboard-accessible tree, menu, and splitter.** “As a keyboard or assistive-technology user, I want standard tree navigation and pane resizing.” | Accessibility and speed | Implement tree/treeitem semantics, roving tabindex, Arrow/Home/End, Shift+F10 menu, menu roles/focus trap, and keyboard splitter; persist width. Shared SplitPane work in the design system may reduce duplication. | M |
| P2 | **Open file in configured editor/default app.** “As a developer, I want to continue inspection in my editor at the selected artifact.” | Smooth handoff for unsupported/large files | “Open containing folder” exists. Opening a file/default app needs a narrowly validated backend action; editor command/line support adds cross-platform config and command-injection concerns. | M |
| P2 | **Remember per-session explorer state.** “As a developer switching between sessions, I want my selected file, expanded folders, width, scroll, and viewer mode restored.” | Reduces navigation repetition | Mostly frontend persistence. Keys must be bounded/expired so thousands of sessions do not grow local storage indefinitely. | S–M |
| P3 | **Resolve local Markdown image links safely.** “As a developer reading a session report, I want its relative screenshots displayed inline.” | Richer reports/checkpoints | Build only after the guarded image service. Rewrite only relative links that resolve inside the same session; keep remote/data/custom URLs blocked; lazy-load previews. | M |
| P3 | **Cross-link files to events, conversation turns, todos, and checkpoints.** “As a developer, I want to answer who created or changed this artifact and why.” | Converts raw files into session provenance | Some event payloads contain paths, but robust provenance requires normalized path extraction, event/file associations, possibly index changes, and UX for uncertain matches. | L–XL |
| P3 | **Compare artifact versions / rewind snapshots.** “As a developer, I want to compare the current file with a checkpoint or rewind state.” | Powerful debugging/audit workflow | Needs snapshot format handling, bounded retrieval, missing-content behavior, and reusable text/image diff viewers. This is a deeper data/product feature. | L–XL |

## Recommended delivery sequence

### Phase 1 — reliability and navigation

Deliver together as a small Explorer polish release:

- wire list/SQLite loading, errors, empty states, and retry;
- make context actions file-type-aware;
- add manual refresh;
- add file-name/path/type filtering, match count, and collapse/expand controls;
- fix keyboard and viewport behavior for the context menu if scope permits.

This phase uses almost entirely existing data and APIs.

### Phase 2 — secure image vertical slice

- Add the guarded image preview endpoint and response type.
- Support PNG, JPEG, and WebP; decide whether GIF is a static first frame or deferred.
- Add fit/zoom/transparency UI and metadata.
- Add backend malformed-image/resource/security tests and frontend state/race tests.
- Validate both the main session detail and pop-out/viewer-window capability path.

No search-index or Copilot format migration should be needed.

### Phase 3 — structured developer formats

- JSON/JSONL structured/raw toggle.
- CSV/TSV table/raw toggle.
- Diff/patch rich/raw toggle.
- Add explicit structured-result truncation indicators.

### Phase 4 — live and provenance features

- Design a range/tail API before adding log/event follow mode.
- Add `modifiedAt`/file identity and more precise live change detection.
- Explore event-to-artifact provenance and version comparison as separate product proposals.

## Suggested success measures

- Percentage of selected Explorer files that render useful content rather than a generic binary placeholder.
- Image preview success/failure/over-limit rates, recorded locally without filenames or content if telemetry exists.
- Time from entering Explorer to first file selection; searches used per Explorer visit.
- Number of listing/read failures surfaced and successfully retried.
- Percentage of failed context-menu actions (expected to fall to near zero after type-aware actions).
- Performance on a 2,000-entry session, a 1 MiB text preview, a 50-table database, and the maximum permitted image.
- Security regression suite remains green with no CSP or filesystem-scope expansion.

## Implementation map

| Concern | Primary implementation |
| --- | --- |
| Explorer orchestration, resize, refresh, actions | `apps/desktop/src/views/tabs/ExplorerTab.vue` |
| File-list/content/SQLite state and request races | `apps/desktop/src/composables/useSessionFiles.ts` |
| Context menu | `apps/desktop/src/components/session/FileContextMenu.vue` |
| Generic tree UI | `packages/ui/src/components/FileBrowserTree.vue` |
| Tree reconstruction/collapse/sort | `packages/ui/src/composables/useFileBrowserTree.ts` |
| Type-aware viewer | `packages/ui/src/components/FileContentViewer.vue` |
| Code/text rendering | `packages/ui/src/components/renderers/CodeBlock.vue` |
| Markdown rendering and link controls | `packages/ui/src/components/MarkdownContent.vue`, `packages/ui/src/utils/markdownLoader.ts` |
| SQLite table UI | `packages/ui/src/components/SqliteTableView.vue` |
| Shared frontend types | `packages/types/src/session.ts` |
| Typed client wrappers | `packages/client/src/sessions.ts` |
| Tauri file commands | `crates/tracepilot-tauri-bindings/src/commands/file_browser/commands.rs` |
| File classification and resource caps | `crates/tracepilot-tauri-bindings/src/commands/file_browser/types.rs` |
| Path validation and bounded walk | `crates/tracepilot-tauri-bindings/src/commands/file_browser/security.rs` |
| SQLite read-only access | `crates/tracepilot-core/src/utils/sqlite/connection.rs`, `crates/tracepilot-core/src/parsing/session_db.rs` |
| Command registration/capabilities | `crates/tracepilot-tauri-bindings/src/lib.rs`, `apps/desktop/src-tauri/capabilities/` |
| Desktop CSP | `apps/desktop/src-tauri/tauri.conf.json` |
| Existing relevant tests | `apps/desktop/src/composables/__tests__/useSessionFiles.test.ts`, `packages/ui/src/__tests__/FileBrowserTree.test.ts`, `packages/ui/src/__tests__/FileContentViewer.test.ts`, and Rust `file_browser` tests |

## Decisions made for the implemented slice

1. **Initial formats:** PNG, JPEG, WebP, and static first-frame GIF.
2. **Limits:** 20 MiB encoded input, 16,384 px per axis, 40 megapixels, 4,096 px maximum preview edge, and 24 MiB sanitized preview output.
3. **Controls:** fit, 100%, zoom, dimensions/size, and transparency background; binary clipboard and editing remain deferred.
4. **Structured data:** Papa Parse for CSV/TSV; native Vue tree/record components for JSON and JSONL.
5. **Search:** instant client-side name/path filtering plus bounded, literal backend content search.
6. **Large text:** 1 MiB initial preview and explicit, user-requested expansion to 16 MiB.

These decisions preserve the existing read-only, local-first, session-contained security model.
