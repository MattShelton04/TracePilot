# Skills Management — Implementation Plan

> TracePilot feature for browsing, editing, importing, and managing Copilot CLI skills (SKILL.md files).
>
> **Prototype reference:** `docs/design/prototypes/skills/skills-hybrid.html`
>
> **Reviewed by:** Claude Opus 4.6, GPT 5.4, GPT 5.3 Codex — feedback consolidated below.

---

## 0. Reviewer Feedback Summary

Three AI reviewers validated this plan against the actual codebase. Key corrections applied:

1. **Architecture**: Modules in `tracepilot-orchestrator`, NOT a separate crate (user decision)
2. **Store pattern**: Must use `@tracepilot/client` typed wrappers, not raw `invoke()`
3. **YAML parser**: Use `serde_yml` (workspace dep), NOT `serde_yaml` (different crate)
4. **serde conventions**: IPC DTOs use `#[serde(rename_all = "camelCase")]` for frontend
5. **Route meta**: Must include `sidebarId` for sidebar active highlighting
6. **Feature flags**: 3-file update (Rust `config.rs` + TS `config.ts` + TS `defaults.ts`)
7. **Package types/client**: All IPC types need TS definitions + typed wrappers
8. **beforeRouteLeave**: Editor must guard against unsaved changes on navigation
9. **Sidebar coordination**: Share new "Extensions" nav group with MCP
10. **File watching**: Should detect external skill file changes
11. **copilot_home() on fresh machine**: Graceful empty state if `~/.copilot` doesn't exist

---

## 1. Overview

Skills are markdown-based instruction files (`SKILL.md`) that teach Copilot CLI specialized behaviors — from code generation patterns to tool usage policies. TracePilot will provide a GUI for viewing installed skills, editing SKILL.md content with live preview, importing skills from GitHub repositories (including private repos), and managing skill lifecycle — all operating on the same filesystem paths Copilot CLI reads.

### Skill Locations

| Path | Scope | Discovery |
|------|-------|-----------|
| `~/.copilot/skills/<name>/SKILL.md` | Global | Always active for all sessions |
| `<project>/.github/skills/<name>/SKILL.md` | Project | Active when Copilot runs in that project |
| `<project>/.copilot/skills/<name>/SKILL.md` | Project (alt) | Same as above |
| `<project>/.claude/skills/<name>/SKILL.md` | Project (Claude) | Claude-specific path, also scanned |

### SKILL.md Format

```markdown
---
name: playwright-cli
description: Automates browser interactions for web testing
allowed-tools:
  - Bash(playwright-cli:*)
  - Bash(npx:playwright)
license: MIT
compatibility: copilot-cli >= 1.0
---

# Playwright CLI Skill

This skill guides creation of browser automation scripts...

## Capabilities
- Navigate websites and interact with web pages
- Fill forms and submit data
...
```

### Skill Directory Structure

```
skills/<name>/
├─ SKILL.md           # Required — frontmatter + markdown body
├─ scripts/           # Optional — executable scripts the skill can reference
├─ assets/            # Optional — templates, configs, boilerplate files
└─ references/        # Optional — reference documentation for context
   ├─ api-docs.md
   └─ examples.md
```

---

## 2. Existing Infrastructure Reuse

### 2.1 Shared UI Components (packages/ui)

| Prototype Element | Existing Component | Notes |
|---|---|---|
| Skill enable/disable toggle | `FormSwitch` (`modelValue: boolean, label?`) | Card toggle, matches MCP pattern |
| Skill name / description inputs | `FormInput` (`modelValue, type?, placeholder?, disabled?`) | Editor frontmatter fields |
| Scope filter dropdown | `FilterSelect` (`options: string[], placeholder?`) | Manager filter bar |
| Search bar | `SearchInput` (`placeholder?, shortcutHint?`) | Manager search |
| Import wizard modal | `ModalDialog` (`visible, title?, role?`) | Import wizard container |
| Delete skill confirmation | `ConfirmDialog` + `useConfirmDialog()` | Danger variant |
| Scope / category / tools badges | `Badge` (`variant`) | Per-card badges |
| Stats cards | `StatCard` (`value, label, color?, gradient?, mini?`) | Manager stats strip |
| Token budget bar | `TokenBar` (`label, value, percentage, color?`) | Token usage summary |
| Empty state (no skills) | `EmptyState` (`message?, icon?, title?, compact?`) | With "Import" action |
| Error state | `ErrorState` (`heading?, message?, retryable?`) | Load failure |
| Loading states | `SkeletonLoader` (`variant: "card", count?`) | Card grid loading |
| Section panels | `SectionPanel` (`title?, padding?`) | Editor sections |
| Action buttons | `ActionButton` (`disabled?, size?, variant?`) | Save, discard, import |
| Button groups | `BtnGroup` (`options, modelValue`) | Scope selector alternative |
| Markdown preview | `MarkdownContent` (`content, maxHeight?, render?`) | Live preview panel |
| YAML/JSON display | `renderers/CodeBlock` (`code, language?, lineNumbers?`) | Frontmatter preview |
| Tab navigation | `TabNav` (`tabs: {name, routeName, label, count?}[]`) | Import wizard tabs |
| Env var / config table | `DataTable` (`columns, rows, emptyMessage?`) | References file list |

### 2.2 Composables

| Use Case | Composable | Usage |
|---|---|---|
| Copy SKILL.md to clipboard | `useClipboard()` | Export/copy button |
| Delete skill dialog | `useConfirmDialog()` | Danger confirmation with checkbox |
| Dismiss onboarding tips | `useDismissable(key)` | First-run guidance |
| Toast notifications | `useToast()` via `useToastStore()` | Save/import/delete feedback |
| Multi-select skills for import | `useToggleSet<string>()` | Import wizard checkboxes |

### 2.3 Utility Functions

| Function | Use |
|---|---|
| `formatTokens()` | Skill token count display |
| `formatBytes()` | File sizes in assets tree |
| `formatNumber()` | Skill/file counts |
| `formatRelativeTime()` | "Modified 2 hours ago" |
| `toErrorMessage()` | Error handling |
| `truncateText()` | Long descriptions |

### 2.4 Layout Components

| Component | Use |
|---|---|
| `AppSidebar` | Add "Skills" nav item with badge (skill count). `featureFlag: 'skills'` |
| `BreadcrumbNav` | "Settings / Skills", "Settings / Skills / Edit: playwright-cli" |

### 2.5 Rust Backend Patterns

| Existing Module | Reuse For | Pattern |
|---|---|---|
| `templates.rs` | Skill CRUD, enable/disable | CRUD over directory-based entities. "Dismiss instead of delete" → rename `SKILL.md` to `SKILL.md.disabled`. Safe ID validation against path traversal. Default + user override merge |
| `repo_registry.rs` | Skill registry/discovery | List + add + remove with atomic writes. Discovery from session directories |
| `config_injector.rs` | SKILL.md read/write, backups | `create_backup()` before overwrite. `diff_files()` for edit preview. Atomic write with tmp+rename |
| `process.rs` | `gh` CLI invocation for import | `run_hidden_stdout()` for `gh api` calls. `run_hidden()` for shell commands |
| `launcher.rs` | Path resolution | `copilot_home()` for `~/.copilot` path |

### 2.6 New Shared Infrastructure (from MCP plan — reused here)

| Module | Location | Use in Skills |
|---|---|---|
| `tokens.rs` | `tracepilot-orchestrator` | Estimate tokens for SKILL.md body + frontmatter |
| `github.rs` | `tracepilot-orchestrator` | Import skills from GitHub repos (public + private via `gh` CLI) |
| `json_io.rs` | `tracepilot-orchestrator` | Atomic read/write for metadata files |
| `TagList.vue` | `packages/ui` | `allowed-tools` display |
| `SegmentedControl.vue` | `packages/ui` | Scope selector (Global / Project) |

---

## 3. Backend — New Modules in `tracepilot-orchestrator`

Skills logic lives as modules inside the existing `tracepilot-orchestrator` crate, alongside MCP modules.

```
crates/tracepilot-orchestrator/src/
├─ ... (existing modules)
├─ mcp/                   # MCP modules (see MCP plan)
├─ skills/
│  ├─ mod.rs              # Public API re-exports
│  ├─ error.rs            # SkillsError enum
│  ├─ types.rs            # Skill, SkillFrontmatter, SkillAsset, SkillScope
│  ├─ discovery.rs        # Scan filesystem for installed skills
│  ├─ parser.rs           # Parse SKILL.md (YAML frontmatter + markdown body)
│  ├─ writer.rs           # Generate SKILL.md from structured data
│  ├─ manager.rs          # Enable/disable, delete, move scope
│  ├─ import.rs           # Import from local path, GitHub URL, file upload
│  └─ assets.rs           # Asset directory management (scripts/, assets/, references/)
├─ tokens.rs              # Shared: token estimation (from MCP plan)
├─ github.rs              # Shared: gh CLI wrapper (from MCP plan)
└─ json_io.rs             # Shared: atomic JSON read/write (from MCP plan)
```

### 3.1 Additional Dependencies in `tracepilot-orchestrator`

```toml
# serde_yml is already a workspace dependency — use it
serde_yml = { workspace = true }
# tokio, serde, serde_json, thiserror already in this crate
```

> **Critical**: Use `serde_yml` (workspace dep), NOT `serde_yaml` (different crate not in workspace).

### 3.2 `types.rs` — Core Types

> All DTO types sent to frontend **must** use `#[serde(rename_all = "camelCase")]`.
> Internal-only types (not crossing IPC boundary) may use snake_case.

```rust
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// Internal type — full skill data, not sent directly to frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Skill {
    pub name: String,
    pub directory: PathBuf,
    pub scope: SkillScope,
    pub enabled: bool,
    pub frontmatter: SkillFrontmatter,
    pub body: String,
    pub assets: Vec<SkillAsset>,
    pub estimated_tokens: u32,
}

/// Frontmatter parsed from SKILL.md YAML header.
/// Uses serde_yml for parsing, NOT serde_yaml.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillFrontmatter {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(rename = "allowed-tools", default, skip_serializing_if = "Vec::is_empty")]
    pub allowed_tools: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub license: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub compatibility: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum SkillScope {
    Global,
    Project,
}

/// IPC DTO — sent to frontend, must be camelCase
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillAsset {
    pub path: String,
    pub asset_type: AssetType,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum AssetType {
    Script,
    Asset,
    Reference,
    SkillMd,
}

/// IPC DTO — summary sent to frontend for list views
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillSummary {
    pub name: String,
    pub scope: SkillScope,
    pub enabled: bool,
    pub description: Option<String>,
    pub has_allowed_tools: bool,
    pub file_count: u32,
    pub estimated_tokens: u32,
}

/// Import source for a skill
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ImportSource {
    #[serde(rename = "local")]
    Local { path: String },
    #[serde(rename = "github")]
    GitHub { owner: String, repo: String, ref_: String, skill_path: String },
    #[serde(rename = "file")]
    File { content: Vec<u8>, filename: String },
}

/// Result of scanning a directory/repo for importable skills
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredSkill {
    pub name: String,
    pub path: String,
    pub has_frontmatter: bool,
    pub description: Option<String>,
    pub file_count: u32,
}
```

### 3.3 `parser.rs` — SKILL.md Parser

```rust
/// Parse a SKILL.md file into structured frontmatter + body.
pub fn parse_skill_md(content: &str) -> Result<(SkillFrontmatter, String)> {
    // 1. Detect YAML frontmatter delimiters (---)
    // 2. Parse YAML section with serde_yml (NOT serde_yaml)
    // 3. Return (frontmatter, remaining markdown body)
}

/// Parse just the frontmatter for quick scanning (no body needed).
pub fn parse_frontmatter_only(content: &str) -> Result<SkillFrontmatter> { ... }
```

### 3.4 `writer.rs` — SKILL.md Generator

```rust
/// Generate SKILL.md content from structured data.
pub fn render_skill_md(frontmatter: &SkillFrontmatter, body: &str) -> String {
    // 1. Serialize frontmatter to YAML
    // 2. Wrap in --- delimiters
    // 3. Append body
}
```

### 3.5 `discovery.rs` — Filesystem Scanning

Uses `launcher::copilot_home()` for global path resolution.

| Function | Description |
|----------|-------------|
| `discover_global_skills()` | Scan `~/.copilot/skills/` for SKILL.md files |
| `discover_project_skills(project_path)` | Scan `.github/skills/`, `.copilot/skills/`, `.claude/skills/` |
| `discover_all_skills(project_path?)` | Merge global + project with scope annotation |
| `load_skill(skill_dir)` | Load full Skill struct from directory |
| `scan_for_importable_skills(path)` | Scan arbitrary path for SKILL.md files (import wizard) |

### 3.6 `manager.rs` — Lifecycle Operations

| Function | Description |
|----------|-------------|
| `enable_skill(name, scope)` | Rename `SKILL.md.disabled` → `SKILL.md` |
| `disable_skill(name, scope)` | Rename `SKILL.md` → `SKILL.md.disabled` |
| `delete_skill(name, scope)` | Remove entire skill directory (with backup via `config_injector::create_backup()`) |
| `move_skill(name, from_scope, to_scope)` | Move directory between global/project paths |
| `save_skill(name, scope, frontmatter, body)` | Atomic write via `config_injector` pattern |
| `create_skill(name, scope, frontmatter, body)` | Create new skill directory + SKILL.md |

### 3.7 `import.rs` — Import Operations

Uses `tracepilot_orchestrator::github::{gh_auth_status, gh_get_file, gh_list_tree}` for GitHub operations.

| Function | Description |
|----------|-------------|
| `import_from_local(source_path, name, scope)` | Copy skill directory to target location |
| `import_from_github(owner, repo, ref_, skill_path, scope)` | Fetch via `gh` CLI API, write locally |
| `scan_github_repo(owner, repo, ref_)` | List skills in a repo using `gh_list_tree()` |
| `check_github_auth()` | Check `gh auth status` via `gh_auth_status()` |
| `validate_import(source)` | Verify SKILL.md exists and parses correctly |

### 3.8 `assets.rs` — Asset Management

| Function | Description |
|----------|-------------|
| `list_assets(skill_dir)` | List all files with types (script/asset/reference/skill_md) and sizes |
| `add_asset(skill_dir, asset_type, filename, content)` | Write file to appropriate subdirectory |
| `remove_asset(skill_dir, relative_path)` | Delete asset file |
| `get_asset_content(skill_dir, relative_path)` | Read asset file content |

### 3.9 `error.rs`

Errors chain through `OrchestratorError` → `BindingsError` (no separate crate boundary).

```rust
#[derive(Debug, thiserror::Error)]
pub enum SkillsError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("YAML parse error: {0}")]
    Yaml(#[from] serde_yml::Error),  // serde_yml, NOT serde_yaml
    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("Skill not found: {0}")]
    NotFound(String),
    #[error("Skill already exists: {0}")]
    AlreadyExists(String),
    #[error("Invalid skill name: {0}")]
    InvalidName(String),
    #[error("Missing SKILL.md in directory: {0}")]
    MissingSkillMd(String),
    #[error("Invalid frontmatter: {0}")]
    InvalidFrontmatter(String),
    #[error("GitHub auth not available")]
    GitHubAuthUnavailable,
    #[error("GitHub API error: {0}")]
    GitHubError(String),
}

// In orchestrator's error.rs, add:
// #[error(transparent)]
// Skills(#[from] skills::SkillsError),
//
// This chains: SkillsError → OrchestratorError → BindingsError (via existing From impl)
```

---

## 4. Backend — Tauri Bindings

### 4.1 New File: `crates/tracepilot-tauri-bindings/src/commands/skills.rs`

| IPC Command | Returns | Prototype View |
|-------------|---------|----------------|
| `list_skills(project_path?)` | `Vec<SkillSummary>` | Skills Manager cards |
| `get_skill(name, scope)` | `Skill` | Skill Editor (full data) |
| `create_skill(name, scope, frontmatter, body)` | `()` | New Skill button |
| `save_skill(name, scope, frontmatter, body)` | `()` | Editor Save button |
| `delete_skill(name, scope)` | `()` | Card remove action |
| `toggle_skill(name, scope, enabled)` | `()` | Card toggle |
| `move_skill(name, from_scope, to_scope)` | `()` | Change scope |
| `scan_local_skills(path)` | `Vec<DiscoveredSkill>` | Import wizard Local tab |
| `scan_github_skills(owner, repo, ref_?)` | `Vec<DiscoveredSkill>` | Import wizard GitHub tab |
| `import_skills(sources: Vec<ImportSource>, scope)` | `Vec<String>` (imported names) | Import wizard footer |
| `check_github_auth()` | `GhAuthInfo` | Import wizard GitHub tab |
| `list_skill_assets(name, scope)` | `Vec<SkillAsset>` | Editor assets tree |
| `get_skill_asset_content(name, scope, path)` | `String` | Asset preview |
| `add_skill_asset(name, scope, asset_type, filename, content)` | `()` | Add file button |
| `remove_skill_asset(name, scope, path)` | `()` | Remove file |
| `get_skills_token_summary(project_path?)` | `SkillsTokenSummary` | Token info bar |

### 4.2 Existing Files to Modify

| File | Change |
|------|--------|
| `crates/tracepilot-tauri-bindings/src/commands/mod.rs` | Add `pub mod skills;` |
| `crates/tracepilot-tauri-bindings/src/lib.rs` | Register 16 commands in `generate_handler![]` |
| (No new crate dep — skills module is inside orchestrator, which is already a dep) |

---

## 5. Frontend — Vue 3 / Pinia

### 5.1 New Store: `apps/desktop/src/stores/skills.ts`

Pattern follows `stores/worktrees.ts` (list + detail + async actions). **Must use `@tracepilot/client` typed wrappers** — NOT raw `invoke()`.

```typescript
import { defineStore } from 'pinia'
import {
  listSkills, getSkill, createSkill as createSkillCmd, saveSkill as saveSkillCmd,
  deleteSkill as deleteSkillCmd, toggleSkill as toggleSkillCmd, moveSkill as moveSkillCmd,
  scanLocalSkills, scanGithubSkills, importSkills as importSkillsCmd,
  checkGithubAuth, listSkillAssets, getSkillAssetContent,
  addSkillAsset, removeSkillAsset, getSkillsTokenSummary,
} from '@tracepilot/client'
import type {
  SkillSummary, Skill, SkillFrontmatter, DiscoveredSkill,
  ImportSource, GhAuthInfo, SkillsTokenSummary,
} from '@tracepilot/types'
import { ref, computed } from 'vue'

export const useSkillsStore = defineStore('skills', () => {
  // State
  const skills = ref<SkillSummary[]>([])
  const selectedSkill = ref<Skill | null>(null)
  const loading = ref(false)
  const saving = ref(false)
  const error = ref<string | null>(null)
  const scopeFilter = ref<'all' | 'global' | 'project'>('all')
  const searchQuery = ref('')

  // Editor state
  const editorDirty = ref(false)
  const editorFrontmatter = ref<SkillFrontmatter | null>(null)
  const editorBody = ref('')

  // Import state
  const importVisible = ref(false)
  const importSource = ref<'local' | 'github' | 'file'>('local')
  const discoveredSkills = ref<DiscoveredSkill[]>([])
  const githubAuth = ref<GhAuthInfo | null>(null)

  // Getters
  const filteredSkills = computed(() => { /* scope + search filter */ })
  const activeCount = computed(() => skills.value.filter(s => s.enabled).length)
  const globalCount = computed(() => skills.value.filter(s => s.scope === 'global').length)
  const projectCount = computed(() => skills.value.filter(s => s.scope === 'project').length)

  // Actions — all use @tracepilot/client wrappers (which prefix with plugin:tracepilot|)
  async function loadSkills(projectPath?: string) { ... }
  async function loadSkill(name: string, scope: string) { ... }
  async function createSkill(name: string, scope: string, frontmatter: any, body: string) { ... }
  async function saveSkill() { ... }
  async function deleteSkill(name: string, scope: string) { ... }
  async function toggleSkill(name: string, scope: string, enabled: boolean) { ... }
  async function moveSkill(name: string, fromScope: string, toScope: string) { ... }
  async function scanLocal(path: string) { ... }
  async function scanGitHub(owner: string, repo: string, ref_?: string) { ... }
  async function importSkills(sources: ImportSource[], scope: string) { ... }
  async function checkGitHubAuth() { ... }
  async function loadAssets(name: string, scope: string) { ... }

  return { skills, selectedSkill, loading, saving, error,
           scopeFilter, searchQuery, editorDirty, editorFrontmatter, editorBody,
           importVisible, importSource, discoveredSkills, githubAuth,
           filteredSkills, activeCount, globalCount, projectCount,
           loadSkills, loadSkill, createSkill, saveSkill, deleteSkill,
           toggleSkill, moveSkill, scanLocal, scanGitHub, importSkills,
           checkGitHubAuth, loadAssets }
})
```

### 5.2 New Views

#### `apps/desktop/src/views/skills/SkillsManagerView.vue`

Maps to prototype "Skills Manager" view. Composed from:

| Prototype Section | Implementation |
|---|---|
| Page header + "Import" / "New Skill" buttons | `<ActionButton variant="ghost">` + `<ActionButton variant="primary">` |
| Stats strip | Row of `<Badge>` with counts |
| Token info bar | `<TokenBar>` with skill token estimate |
| Scope segmented control | `<SegmentedControl>` (shared from MCP) or `<BtnGroup>` |
| Skill card grid | CSS grid with `<SkillCard>` components |
| Empty state | `<EmptyState>` with action slots |
| Loading state | `<SkeletonLoader variant="card" :count="4">` |

#### `apps/desktop/src/views/skills/SkillEditorView.vue`

Maps to prototype "Skill Editor" view. Route param: `:skillName/:scope`.

| Prototype Section | Implementation |
|---|---|
| Top bar (back, name, save/discard) | `<BreadcrumbNav>` + `<ActionButton>` pair + dirty indicator |
| Frontmatter card | Custom `<SkillFrontmatterCard>` with `<FormInput>`, char counts, `<TagList>` for allowed-tools |
| Scope selector | `<SegmentedControl>` |
| Markdown toolbar | Custom `<MarkdownToolbar>` (bold, italic, headings, lists, code, link) |
| Line-numbered editor | Custom `<LineNumberedEditor>` with `<textarea>` + gutter sync |
| Preview panel | `<MarkdownContent :content="editorBody" render>` with `<CodeBlock>` for frontmatter |
| Assets tree | Custom `<SkillAssetsTree>` using `<DataTable>` or custom tree |
| Resize handle | Custom composable `useResizeHandle()` for split-panel |

### 5.3 New Components

```
apps/desktop/src/components/skills/
├─ SkillCard.vue              # Card with badges, scope, allowed-tools warning, toggle
├─ SkillFrontmatterCard.vue   # Frontmatter form: name, description, allowed-tools, scope
├─ SkillImportWizard.vue      # Modal with TabNav: Local / GitHub / File tabs
├─ SkillImportLocal.vue       # Local tab: path input, scan results, checkboxes
├─ SkillImportGitHub.vue      # GitHub tab: auth status, repo URL, scan results
├─ SkillImportFile.vue        # File tab: drop zone, format info
├─ SkillAssetsTree.vue        # File tree with type icons, sizes, add/remove
├─ MarkdownToolbar.vue        # Toolbar buttons (B, I, H1, H2, list, code, link)
└─ LineNumberedEditor.vue     # Textarea with line number gutter, scroll sync
```

**Component → Shared UI reuse map:**

| New Component | Shared Components Used |
|---|---|
| `SkillCard` | `Badge`, `FormSwitch`, `ActionButton` |
| `SkillFrontmatterCard` | `FormInput`, `TagList` (shared), `SegmentedControl` (shared), `Badge` |
| `SkillImportWizard` | `ModalDialog`, `TabNav`, `ActionButton`, `useToggleSet()` |
| `SkillImportLocal` | `FormInput`, `ActionButton`, `Badge`, `LoadingSpinner` |
| `SkillImportGitHub` | `FormInput`, `ActionButton`, `Badge`, `ErrorAlert`, `LoadingSpinner` |
| `SkillImportFile` | `ActionButton`, `Badge` |
| `SkillAssetsTree` | `DataTable`, `Badge`, `ActionButton`, `useConfirmDialog()` |
| `MarkdownToolbar` | `ActionButton` (×9), `BtnGroup` |
| `LineNumberedEditor` | _(custom — no existing equivalent)_ |

### 5.4 New Composables

| Composable | Location | Description |
|---|---|---|
| `useResizeHandle()` | `packages/ui/src/composables/` | Draggable split-panel resize. Tracks mouse, updates CSS variable. Reusable for any split-panel layout. |
| `useCharCount()` | `apps/desktop/src/composables/` | Reactive char count with near-limit/at-limit thresholds. Used by frontmatter fields. |
| `useSkillEditor()` | `apps/desktop/src/composables/` | Editor state management: dirty tracking, frontmatter ↔ body sync, unsaved changes guard. |

### 5.5 Router Changes

**File:** `apps/desktop/src/router/index.ts`

All routes must include `sidebarId` in meta for AppSidebar highlighting.

```typescript
{
  path: '/skills',
  name: 'skills-manager',
  component: () => import('@/views/skills/SkillsManagerView.vue'),
  meta: { title: 'Skills', sidebarId: 'skills' },
},
{
  path: '/skills/:scope/:skillName',
  name: 'skills-editor',
  component: () => import('@/views/skills/SkillEditorView.vue'),
  meta: { title: 'Skill Editor', sidebarId: 'skills' },
  props: true,
},
```

### 5.5.1 `beforeRouteLeave` Guard (SkillEditorView)

The editor view **must** guard against unsaved changes on navigation:

```typescript
import { onBeforeRouteLeave } from 'vue-router'
import { useConfirmDialog } from '@tracepilot/ui'

const { confirm } = useConfirmDialog()
const store = useSkillsStore()

onBeforeRouteLeave(async () => {
  if (!store.editorDirty) return true
  const ok = await confirm({
    title: 'Unsaved Changes',
    message: 'You have unsaved changes to this skill. Discard them?',
    confirmLabel: 'Discard',
    destructive: true,
  })
  return ok
})
```

### 5.6 Sidebar Update

**File:** `apps/desktop/src/components/layout/AppSidebar.vue`

Add to "Extensions" nav group (shared with MCP — see MCP plan §6.6):
```typescript
{ id: 'skills', label: 'Skills', to: '/skills', icon: 'skills', featureFlag: 'skills' }
```

### 5.7 Preferences Update

Feature flags require **3-file update**:

1. **Rust:** `crates/tracepilot-tauri-bindings/src/config.rs` — add to `FeaturesConfig`:
```rust
pub skills: bool,  // default true
```

2. **TypeScript type:** `packages/types/src/config.ts`:
```typescript
skills: boolean
```

3. **TypeScript default:** `packages/types/src/defaults.ts`:
```typescript
skills: true,
```

Also update `apps/desktop/src/stores/preferences.ts` if it has a hardcoded default.

---

## 6. Tauri Capabilities

No new permissions needed. Skill directories are under user home (`~/.copilot/skills/`) and project directories, both accessible via standard `std::fs`. The `gh` CLI is invoked via `std::process::Command` (through `process::run_hidden_stdout`), not Tauri's shell plugin.

---

## 7. Testing Strategy

### Backend Tests

| Test File | Coverage | Pattern Reference |
|---|---|---|
| `tracepilot-orchestrator/src/skills/parser.rs` | Frontmatter parsing, missing frontmatter, malformed YAML | — |
| `tracepilot-orchestrator/src/skills/writer.rs` | Round-trip: parse → write → parse = identical | — |
| `tracepilot-orchestrator/src/skills/discovery.rs` | Scan with/without skills, disabled skills, nested dirs | `session/discovery.rs` |
| `tracepilot-orchestrator/src/skills/manager.rs` | Enable/disable rename, delete with backup, scope move | `templates.rs` tests |
| `tracepilot-orchestrator/src/skills/import.rs` | Local import, validation, path traversal rejection | `templates.rs` ID validation |
| `tracepilot-orchestrator/src/skills/assets.rs` | List, add, remove assets, type categorization | — |
| `tracepilot-orchestrator/src/github.rs` | gh auth parsing, mock tree responses | — |

Run: `cargo test -p tracepilot-orchestrator skills` and `cargo test -p tracepilot-orchestrator github`

### Frontend Tests

| Test File | Coverage |
|---|---|
| `apps/desktop/src/__tests__/stores/skills.test.ts` | Store actions, getters, filter logic, dirty tracking |
| `packages/ui/src/__tests__/SegmentedControl.test.ts` | Selection, keyboard nav |
| `apps/desktop/src/__tests__/composables/useResizeHandle.test.ts` | Mouse tracking, min/max constraints |
| `apps/desktop/src/__tests__/composables/useCharCount.test.ts` | Count, thresholds |

Run: `pnpm --filter @tracepilot/desktop test` and `pnpm --filter @tracepilot/ui test`

---

## 8. Complete File Inventory

### New Files (CREATE)

| # | File | Size Est. | Category |
|---|------|-----------|----------|
| 1 | `crates/tracepilot-orchestrator/src/skills/mod.rs` | ~0.5KB | Backend |
| 2 | `crates/tracepilot-orchestrator/src/skills/error.rs` | ~1.5KB | Backend |
| 3 | `crates/tracepilot-orchestrator/src/skills/types.rs` | ~3KB | Backend |
| 4 | `crates/tracepilot-orchestrator/src/skills/parser.rs` | ~2KB | Backend |
| 5 | `crates/tracepilot-orchestrator/src/skills/writer.rs` | ~1KB | Backend |
| 6 | `crates/tracepilot-orchestrator/src/skills/discovery.rs` | ~3KB | Backend |
| 7 | `crates/tracepilot-orchestrator/src/skills/manager.rs` | ~3KB | Backend |
| 8 | `crates/tracepilot-orchestrator/src/skills/import.rs` | ~3KB | Backend |
| 9 | `crates/tracepilot-orchestrator/src/skills/assets.rs` | ~2KB | Backend |
| 10 | `crates/tracepilot-tauri-bindings/src/commands/skills.rs` | ~5KB | IPC layer |
| 11 | `packages/types/src/skills.ts` | ~2.5KB | TS types |
| 12 | `packages/client/src/skills.ts` | ~2.5KB | Client wrappers |
| 13 | `apps/desktop/src/stores/skills.ts` | ~4KB | Frontend |
| 14 | `apps/desktop/src/views/skills/SkillsManagerView.vue` | ~5KB | Frontend |
| 15 | `apps/desktop/src/views/skills/SkillEditorView.vue` | ~8KB | Frontend |
| 16 | `apps/desktop/src/components/skills/SkillCard.vue` | ~3KB | Frontend |
| 17 | `apps/desktop/src/components/skills/SkillFrontmatterCard.vue` | ~4KB | Frontend |
| 18 | `apps/desktop/src/components/skills/SkillImportWizard.vue` | ~2KB | Frontend |
| 19 | `apps/desktop/src/components/skills/SkillImportLocal.vue` | ~3KB | Frontend |
| 20 | `apps/desktop/src/components/skills/SkillImportGitHub.vue` | ~4KB | Frontend |
| 21 | `apps/desktop/src/components/skills/SkillImportFile.vue` | ~2KB | Frontend |
| 22 | `apps/desktop/src/components/skills/SkillAssetsTree.vue` | ~3KB | Frontend |
| 23 | `apps/desktop/src/components/skills/MarkdownToolbar.vue` | ~2KB | Frontend |
| 24 | `apps/desktop/src/components/skills/LineNumberedEditor.vue` | ~3KB | Frontend |
| 25 | `packages/ui/src/composables/useResizeHandle.ts` | ~1.5KB | Shared UI |

### Modified Files (MODIFY)

| # | File | Change |
|---|------|--------|
| 1 | `crates/tracepilot-orchestrator/src/lib.rs` | Add `pub mod skills;` (+ shared mods if not already from MCP) |
| 2 | `crates/tracepilot-orchestrator/src/error.rs` | Add `Skills(#[from] skills::SkillsError)` variant |
| 3 | `crates/tracepilot-orchestrator/Cargo.toml` | Add `serde_yml = { workspace = true }` (if not already from MCP) |
| 4 | `crates/tracepilot-tauri-bindings/src/commands/mod.rs` | Add `pub mod skills;` |
| 5 | `crates/tracepilot-tauri-bindings/src/lib.rs` | Register 16 commands |
| 6 | `crates/tracepilot-tauri-bindings/src/config.rs` | Add `skills` to FeaturesConfig |
| 7 | `packages/types/src/config.ts` | Add `skills` to FeaturesConfig TS type |
| 8 | `packages/types/src/defaults.ts` | Add `skills: true` to feature flag defaults |
| 9 | `packages/types/src/index.ts` | Export Skills types |
| 10 | `packages/client/src/index.ts` | Export Skills client functions |
| 11 | `apps/desktop/src/router/index.ts` | Add Skills routes (with `sidebarId: 'skills'` in meta) |
| 12 | `apps/desktop/src/components/layout/AppSidebar.vue` | Add "Skills" to "Extensions" nav group |
| 13 | `apps/desktop/src/stores/preferences.ts` | Add feature flag default |
| 14 | `packages/ui/src/index.ts` | Export useResizeHandle |
| 15 | `packages/ui/src/composables/index.ts` | Export useResizeHandle |

### Total: 25 new files + 15 modified files

---

## 9. Implementation Phases

### Phase 1: Backend Core
- Create `skills/` module directory in orchestrator (types, parser, writer, error)
- Use `serde_yml` for YAML frontmatter parsing (NOT `serde_yaml`)
- Unit tests for SKILL.md parse/write round-trip

### Phase 2: Discovery & Manager
- `discovery.rs` — filesystem scanning for installed skills
- `manager.rs` — enable/disable/delete/create
- IPC commands in tauri-bindings
- Graceful handling if `copilot_home()` fails (fresh machine)
- Unit tests

### Phase 3: Frontend Core (Read-Only)
- Pinia store (using @tracepilot/client wrappers)
- Router routes with `sidebarId: 'skills'`
- Sidebar nav item in "Extensions" group
- SkillsManagerView with skill card grid
- SkillCard component with badges and toggles
- Feature flag gating (3 files: Rust + TS type + TS default)
- `packages/types/src/skills.ts` TypeScript types
- `packages/client/src/skills.ts` typed IPC wrappers

### Phase 4: Skill Editor
- SkillEditorView with split-panel layout
- SkillFrontmatterCard with form inputs and char counts
- MarkdownToolbar + LineNumberedEditor
- MarkdownContent preview integration
- SkillAssetsTree for file management
- `useResizeHandle` composable
- Save/discard with dirty tracking
- **`beforeRouteLeave` guard** for unsaved changes protection

### Phase 5: Import Wizard
- SkillImportWizard with TabNav
- Local tab: path scan + skill discovery
- GitHub tab: `gh` CLI auth check + repo scan + fetch
- File tab: drag-and-drop upload
- Import execution with scope selection

### Phase 6: Advanced Features
- Move skill between scopes
- Asset add/remove/preview
- Token estimation display
- Allowed-tools security warning with explanation
- File mtime check for external skill changes

---

## 10. Cross-Feature Shared Work Summary

These files are created once and shared between MCP and Skills:

| File | Created For | Also Used By |
|---|---|---|
| `crates/tracepilot-orchestrator/src/tokens.rs` | MCP token estimation | Skills token estimation |
| `crates/tracepilot-orchestrator/src/github.rs` | Skills GitHub import | MCP could use for server discovery |
| `crates/tracepilot-orchestrator/src/json_io.rs` | MCP metadata persistence | Skills metadata if needed |
| `packages/ui/src/components/TagList.vue` | MCP args display | Skills allowed-tools display |
| `packages/ui/src/components/EnvVarTable.vue` | MCP env vars | — |
| `packages/ui/src/components/SegmentedControl.vue` | MCP transport selector | Skills scope selector |
| `packages/ui/src/composables/useResizeHandle.ts` | Skills split-panel editor | Any future split-panel view |

---

## 11. Risk Considerations

| Risk | Mitigation |
|------|------------|
| SKILL.md format changes upstream | Parse defensively; ignore unknown frontmatter fields; `#[serde(flatten)]` for forward compat |
| `allowed-tools` grants security-sensitive access | Show prominent warning badge (amber); explain what tools are pre-approved; require confirmation for skills with allowed-tools |
| Large skill body (>100KB) | Warn user; use virtual rendering; cap token estimation display |
| GitHub import from private repo without gh | Graceful error + install instructions; PAT fallback option |
| Filename collisions on import | Detect conflict; prompt rename or skip; never overwrite silently |
| Editor loses unsaved changes on navigate | `beforeRouteLeave` guard with `useConfirmDialog()` |
| Mixed line endings (CRLF/LF) | Normalize to LF on read; write LF |
| Path traversal in skill names | Validate: alphanumeric + hyphens only (following `templates.rs` pattern) |
| `copilot_home()` fails on fresh machine | Catch error; show "Copilot CLI not installed" empty state with setup link |
| External skill file changes | File mtime check on view focus; refresh skills list if stale |
| `serde_yaml` vs `serde_yml` confusion | **Use `serde_yml = { workspace = true }`** — `serde_yaml` is NOT in the workspace |
