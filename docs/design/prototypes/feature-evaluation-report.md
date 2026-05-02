# TracePilot Feature Evaluation Report: MCP & Skills

**Date:** 2026-03-30  
**Status:** Reviewed & Consolidated (Opus 4.6, GPT 5.4, Codex 5.3, Sonnet 4.6)

---

## Executive Summary

This report evaluates two potential feature additions for TracePilot: **Model Context Protocol (MCP) Management** and **Skills Management**. Both features align naturally with TracePilot's positioning as the premier command centre for GitHub Copilot CLI power users. MCP and Skills are the two primary extension mechanisms for Copilot CLI — TracePilot already manages sessions, agent configs, worktrees, and launch templates; managing these extension points is the logical next step.

**Key Thesis:** Users currently manage MCP servers and Skills through manual JSON/Markdown file editing and CLI commands. TracePilot can provide a visual, unified management layer that dramatically lowers the barrier to entry while offering power users advanced capabilities like bulk operations, diffing, backup/restore, and cross-environment synchronization.

---

## 1. Model Context Protocol (MCP) Feature

### 1.1 What is MCP?

MCP (Model Context Protocol) is an open standard ("USB-C for AI") that lets AI tools connect to external data sources, APIs, and tools via a standardized protocol. Copilot CLI reads MCP server configurations from `~/.copilot/mcp-config.json` (global) and `.copilot/mcp-config.json` (per-project). Each server exposes **tools** (actions), **resources** (data), and **prompts** (pre-configured inputs).

**Config format:**
```json
{
  "mcpServers": {
    "server-name": {
      "type": "stdio" | "http" | "sse",
      "command": "executable",
      "args": ["arg1", "arg2"],
      "env": { "KEY": "value" },
      "tools": ["*"]
    }
  }
}
```

### 1.2 Feature Map — All Possible Offerings

#### 1.2.1 🔍 MCP Browser (Discovery & Catalog)

**Purpose:** Browse, search, and discover available MCP servers from public registries and curated sources.

| Capability | Simple User | Advanced User |
|-----------|-------------|---------------|
| Browse curated catalog of popular servers | ✅ Tile grid with icons, descriptions, install counts | ✅ + filter by category, transport type, author |
| Search by name/description/capability | ✅ Simple search bar | ✅ + regex, tag-based filtering |
| Server detail view | ✅ Description, tools list, install instructions | ✅ + GitHub stars, last updated, compatibility matrix |
| "Featured" / "Essential" collections | ✅ Curated packs (e.g., "Developer Essentials") | ✅ + community collections |

**Implementation:** Static JSON catalog shipped with app (updatable). Future: fetch from `https://registry.modelcontextprotocol.io` or GitHub-hosted catalog. Each entry has `id`, `name`, `description`, `category`, `installCommand`, `defaultConfig`, `iconUrl`.

#### 1.2.2 📦 MCP Installer / Adder

**Purpose:** One-click installation of MCP servers from the browser or via manual config entry.

| Capability | Simple User | Advanced User |
|-----------|-------------|---------------|
| One-click install from catalog | ✅ Click "Install" → auto-adds to config | ✅ + customize args/env before install |
| "Add Custom Server" dialog | ✅ Guided form with type picker | ✅ + raw JSON editor mode |
| Auto-detect required dependencies | ✅ Check if `npx`/`python` available | ✅ + offer to install missing runtimes |
| Environment variable management | ✅ Simple key-value inputs | ✅ + link to `.env` file, secret masking |
| Per-project vs global scope toggle | ✅ Simple toggle | ✅ + scope indicator per server |
| Batch install from a preset pack | ❌ | ✅ Install "Developer Essentials" pack |
| Import from VS Code / Cursor config | ❌ | ✅ Detect and import `.vscode/mcp.json` |

**Implementation:** Rust backend reads/writes `~/.copilot/mcp-config.json` and `.copilot/mcp-config.json`. Uses `serde_json` for config manipulation. Install verification via process spawn check.

#### 1.2.3 ⚙️ MCP Configurator / Manager

**Purpose:** View and manage all installed MCP servers with rich visual controls.

| Capability | Simple User | Advanced User |
|-----------|-------------|---------------|
| List all installed servers with status | ✅ Card grid showing name, type, status | ✅ + health check ping, tool count |
| Enable/disable servers | ✅ Toggle switch per server | ✅ + conditional enable rules |
| Edit server configuration | ✅ Form-based editing | ✅ + raw JSON editor with validation |
| Tool-level enable/disable | ❌ | ✅ Checkbox list of server's exposed tools |
| View server health/connectivity | ✅ Green/red indicator | ✅ + last response time, error log |
| View exposed tools & resources | ✅ Collapsible list | ✅ + tool schema inspector, test invocation |
| Duplicate server config | ❌ | ✅ Clone with modifications |
| Diff pending changes | ❌ | ✅ Side-by-side before/after diff |

**Implementation:** Frontend Vue components with Pinia store. Config changes preview via diff before save. Health check spawns server process briefly to verify protocol handshake.

#### 1.2.4 📋 MCP Copier / Sync

**Purpose:** Copy MCP configurations between scopes, machines, and tools.

| Capability | Simple User | Advanced User |
|-----------|-------------|---------------|
| Copy server from global → project | ✅ One-click | ✅ + customize for project |
| Copy from project → global | ✅ One-click | ✅ + merge strategy picker |
| Export config to clipboard/file | ✅ "Copy JSON" button | ✅ + selective export |
| Import from clipboard/file | ✅ Paste JSON | ✅ + validation and conflict resolution |
| Sync with VS Code config | ❌ | ✅ Two-way sync with `.vscode/mcp.json` |
| Share config as gist/link | ❌ | ✅ Publish to GitHub Gist |

#### 1.2.5 💾 MCP Backup & Restore

**Purpose:** Protect MCP configurations with versioned backups.

| Capability | Simple User | Advanced User |
|-----------|-------------|---------------|
| One-click backup | ✅ "Backup Now" button | ✅ + named backup with description |
| Auto-backup on change | ✅ Automatic | ✅ + configurable retention |
| Restore from backup | ✅ Pick from list | ✅ + diff preview before restore |
| Backup history with timestamps | ✅ Simple list | ✅ + version comparison |

#### 1.2.6 📊 MCP Analytics (Session Integration)

**Purpose:** Show MCP tool usage within session analytics.

| Capability | Simple User | Advanced User |
|-----------|-------------|---------------|
| Track which MCP tools used per session | ✅ Badge on session card | ✅ + tool usage breakdown |
| MCP tool invocation timeline | ✅ In session timeline | ✅ + duration, success/failure |
| Most-used MCP tools dashboard | ✅ Chart view | ✅ + cross-session trends |
| Cost attribution for MCP calls | ❌ | ✅ Token cost per MCP tool |

### 1.3 MCP UI/UX Design

#### Navigation
- New **"MCP Servers"** item in the sidebar under Orchestration section (alongside Config Injector, Worktrees)
- Icon: 🔌 or plug/connector icon
- Sidebar badge shows installed server count

#### Layout — Three-Panel Design
```
┌──────────────────────────────────────────────────────────┐
│ MCP Servers                                    [+ Add]   │
├──────────────────────────────────────────────────────────┤
│ ┌─ Filter Bar ─────────────────────────────────────────┐ │
│ │ [Search...] [Scope: All ▾] [Status: All ▾] [Type ▾] │ │
│ └──────────────────────────────────────────────────────┘ │
│                                                          │
│ ┌─ Server Card Grid ──────────────────────────────────┐  │
│ │ ┌──────────┐ ┌──────────┐ ┌──────────┐             │  │
│ │ │ 🔌 GitHub│ │ 📁 Files │ │ 🎭 Play- │             │  │
│ │ │  Server  │ │  ystem   │ │   wright │             │  │
│ │ │ ● Active │ │ ● Active │ │ ○ Paused │             │  │
│ │ │ 14 tools │ │  7 tools │ │  5 tools │             │  │
│ │ │ [⚙][🗑] │ │ [⚙][🗑] │ │ [⚙][🗑] │             │  │
│ │ └──────────┘ └──────────┘ └──────────┘             │  │
│ └────────────────────────────────────────────────────┘  │
│                                                          │
│ ── CATALOG ──────────────────────────────────────────── │
│ "Discover new servers"                                   │
│ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐   │
│ │ 🔍 Brave │ │ 🗄 Post- │ │ 📊 Supa- │ │ 📝 Notion│   │
│ │  Search  │ │  greSQL  │ │  base    │ │          │   │
│ │          │ │          │ │          │ │          │   │
│ │ [Install]│ │ [Install]│ │ [Install]│ │ [Install]│   │
│ └──────────┘ └──────────┘ └──────────┘ └──────────┘   │
└──────────────────────────────────────────────────────────┘
```

#### Server Detail View (on click / ⚙ button)
- Split panel: config form on left, tool list on right
- Form fields: name, type (dropdown), command, args (tag input), env (key-value table)
- JSON editor toggle at bottom
- "Test Connection" button that spawns server and validates protocol
- Changes tracked with diff preview before save

#### Add Server Flow
1. Click "+ Add" → Modal with two tabs: "From Catalog" | "Custom"
2. **From Catalog:** Browse grid → Click → Prefilled form → Review → Install
3. **Custom:** Empty form with type selector → Fill in → Validate → Save

### 1.4 Technical Architecture

```
┌─────────────────────────────────────────┐
│              Vue Frontend               │
│  ┌──────────┐ ┌───────────┐            │
│  │ McpStore │ │ McpViews  │            │
│  │ (Pinia)  │ │ (Vue SFC) │            │
│  └────┬─────┘ └───────────┘            │
│       │                                 │
├───────┼─────────────────────────────────┤
│       │      Tauri Command Bridge       │
│       ▼                                 │
│  ┌──────────────────────────────────┐   │
│  │   tracepilot-tauri-bindings      │   │
│  │   ┌─────────────────────────┐    │   │
│  │   │ mcp.rs                  │    │   │
│  │   │ - read_mcp_config()     │    │   │
│  │   │ - write_mcp_config()    │    │   │
│  │   │ - list_mcp_servers()    │    │   │
│  │   │ - add_mcp_server()      │    │   │
│  │   │ - remove_mcp_server()   │    │   │
│  │   │ - test_mcp_server()     │    │   │
│  │   │ - backup_mcp_config()   │    │   │
│  │   └─────────────────────────┘    │   │
│  └──────────────────────────────────┘   │
│                                         │
│  Config file I/O:                       │
│  ~/.copilot/mcp-config.json (global)    │
│  .copilot/mcp-config.json   (project)   │
└─────────────────────────────────────────┘
```

**Key Rust Types:**
```rust
#[derive(Serialize, Deserialize)]
pub struct McpConfig {
    #[serde(rename = "mcpServers")]
    pub mcp_servers: HashMap<String, McpServerEntry>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum McpTransport { Stdio, Local, Http, Sse }

#[derive(Serialize, Deserialize)]
pub struct McpServerEntry {
    #[serde(rename = "type")]
    pub transport: McpTransport,
    pub command: Option<String>,
    pub args: Option<Vec<String>>,
    pub env: Option<HashMap<String, String>>,
    pub url: Option<String>,
    pub tools: Option<Vec<String>>,
    pub headers: Option<HashMap<String, String>>,
    pub cwd: Option<String>,
    pub instructions: Option<String>,
    // Forward-compatibility: preserve unknown fields
    #[serde(flatten)]
    pub extra: HashMap<String, serde_json::Value>,
}
```

### 1.5 Underlying Operations (Implementation Detail)

```
Config File Locations:
  Global: ~/.copilot/mcp-config.json
  Project: .copilot/mcp-config.json (repo root)
  VS Code: .vscode/mcp.json (key: "servers", not "mcpServers")

Read Config:
  Rust: std::fs::read_to_string(path) → serde_json::from_str::<McpConfig>()
  Fallback: Return empty McpConfig { mcp_servers: HashMap::new() } if file doesn't exist

Write Config:
  1. Read current file from disk (detect external changes)
  2. Apply modifications to in-memory config
  3. Create backup: cp mcp-config.json → ~/.copilot/tracepilot/backups/mcp-config-{timestamp}.json
  4. Atomic write: write to tempfile in same directory, then fs::rename()
  5. Emit file-change event to frontend via Tauri event bus

Test Connection (stdio transport):
  1. Spawn: Command::new(cmd).args(args).envs(env).stdin(Piped).stdout(Piped).stderr(Piped)
  2. Send JSON-RPC initialize:
     {"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{}},"id":1}
  3. Read response, validate protocolVersion field
  4. Send tools/list request: {"jsonrpc":"2.0","method":"tools/list","id":2}
  5. Parse tool names + descriptions from response
  6. Kill child process (process group kill on timeout)
  7. Hard timeout: 5 seconds → kill + return error

Test Connection (http/sse transport):
  1. POST initialize to url
  2. Validate response
  3. GET tools/list
  4. Parse tools array

Enable/Disable (TracePilot-managed, no native CLI support):
  Disable: Remove entry from mcp-config.json, store in ~/.copilot/tracepilot/disabled-mcp.json
  Enable: Restore entry from disabled-mcp.json back to mcp-config.json

Import from VS Code:
  1. Read .vscode/mcp.json → parse with "servers" as root key
  2. Translate schema: "servers" → "mcpServers", ${env:VAR} → $VAR
  3. Show diff preview of what will be added
  4. Merge into target config (global or project)
```

---

## 2. Skills Feature

### 2.1 What are Skills?

Skills are reusable, on-demand procedural packages for Copilot CLI. Each skill is a folder containing a `SKILL.md` file (with YAML frontmatter for `name` and `description`) plus optional supporting assets (scripts, templates, configs). Skills live in:
- **Project scope:** `.github/skills/<name>/SKILL.md`
- **User scope:** `~/.copilot/skills/<name>/SKILL.md`

Skills activate contextually — when your prompt matches the skill's description, Copilot loads the full instructions. They can also be invoked explicitly.

### 2.2 Feature Map — All Possible Offerings

#### 2.2.1 🔍 Skills Browser (Discovery & Catalog)

**Purpose:** Browse, search, and discover available skills from community and curated sources.

| Capability | Simple User | Advanced User |
|-----------|-------------|---------------|
| Browse curated skill catalog | ✅ Card grid with categories | ✅ + filter by trigger, complexity, author |
| Search by name/description/trigger | ✅ Simple search | ✅ + trigger keyword matching |
| Skill detail view | ✅ Rendered SKILL.md preview | ✅ + asset listing, dependency info |
| Category filtering | ✅ "Review", "Testing", "Debug" etc. | ✅ + custom tags |
| Featured / community collections | ✅ Curated packs | ✅ + trending, most-installed |

**Implementation:** Curated JSON index of skills bundled with app + optional fetch from GitHub-hosted registry. Each entry: `id`, `name`, `description`, `category`, `sourceRepo`, `files[]`.

#### 2.2.2 📦 Skills Installer / Adder

**Purpose:** Install skills from catalog, repositories, or create from scratch.

| Capability | Simple User | Advanced User |
|-----------|-------------|---------------|
| One-click install from catalog | ✅ Click "Install" → copies to skills dir | ✅ + choose scope (project/global) |
| Install from GitHub repo URL | ✅ Paste URL → auto-detect skill | ✅ + branch/tag selector |
| Create new skill from template | ✅ Wizard with name, description, body | ✅ + scaffold with supporting files |
| Create from session history | ❌ | ✅ Extract skill from successful session pattern |
| Batch install from skill pack | ❌ | ✅ Install "Code Review Pack" |
| Version management | ❌ | ✅ Update installed skills from source |

#### 2.2.3 ✏️ Skills Editor

**Purpose:** Visual editor for creating and modifying skills with live preview.

| Capability | Simple User | Advanced User |
|-----------|-------------|---------------|
| Visual SKILL.md editor | ✅ Form: name, description, body sections | ✅ + raw Markdown editor |
| Live preview | ✅ Rendered preview alongside editor | ✅ + frontmatter validation |
| Template gallery | ✅ Start from "Review", "Debug", "Test" templates | ✅ + custom templates |
| Asset management | ❌ | ✅ Attach scripts, checklists, templates |
| Syntax highlighting | ✅ Markdown highlighting | ✅ + YAML frontmatter highlighting |
| Validation | ✅ Required field checks | ✅ + description quality scoring |

#### 2.2.4 ⚙️ Skills Manager

**Purpose:** View and manage all installed skills across scopes.

| Capability | Simple User | Advanced User |
|-----------|-------------|---------------|
| List all installed skills | ✅ Card grid by scope | ✅ + sort by name, scope, date, usage |
| View skill details | ✅ Rendered SKILL.md | ✅ + raw files, asset tree |
| Enable/disable skills | ✅ Toggle switch | ✅ + conditional activation rules |
| Delete skills | ✅ With confirmation | ✅ + batch delete |
| View skill scope (project/global) | ✅ Badge indicator | ✅ + move between scopes |
| Skill conflict detection | ✅ Warning on duplicate names | ✅ + priority order visualization |

#### 2.2.5 📋 Skills Copier / Importer

**Purpose:** Import skills from repositories, other machines, or share with teams.

| Capability | Simple User | Advanced User |
|-----------|-------------|---------------|
| Import from repository | ✅ Clone skill from `.github/skills/` | ✅ + selective import |
| Import from another project | ✅ Browse and pick | ✅ + batch import |
| Copy skill between scopes | ✅ Project ↔ Global toggle | ✅ + adapt paths for scope |
| Export skill to clipboard/file | ✅ "Copy" button | ✅ + zip with assets |
| Share as GitHub Gist | ❌ | ✅ Publish skill with one click |
| Import from Gist/URL | ✅ Paste URL | ✅ + auto-detect format |
| Import repo's full skill set to global | ❌ | ✅ Bulk copy .github/skills/* → ~/.copilot/skills/ |

#### 2.2.6 💾 Skills Backup & Restore

**Purpose:** Protect skills with versioned backups.

| Capability | Simple User | Advanced User |
|-----------|-------------|---------------|
| One-click backup all skills | ✅ "Backup Now" | ✅ + named snapshot |
| Restore individual skills | ✅ Pick from backup | ✅ + diff preview |
| Auto-backup on modification | ✅ Automatic | ✅ + configurable retention |
| Export backup archive | ❌ | ✅ Zip archive of all skills |

#### 2.2.7 📊 Skills Analytics

**Purpose:** Track skill usage across sessions.

| Capability | Simple User | Advanced User |
|-----------|-------------|---------------|
| Track which skills activated per session | ✅ Badge on session | ✅ + activation context |
| Most-used skills chart | ✅ Dashboard widget | ✅ + cross-session trends |
| Skill effectiveness scoring | ❌ | ✅ Correlate with session health scores |

### 2.3 Skills UI/UX Design

#### Navigation
- New **"Skills"** item in the sidebar under Orchestration section
- Icon: ⚡ or lightning/skill icon
- Sidebar badge shows installed skill count

#### Layout — Manager View with Integrated Editor
```
┌──────────────────────────────────────────────────────────┐
│ Skills                              [+ New] [📦 Import]  │
├──────────────────────────────────────────────────────────┤
│ ┌─ Filter/Scope Bar ──────────────────────────────────┐  │
│ │ [Search...] [Scope: All ▾] [Category: All ▾]       │  │
│ └────────────────────────────────────────────────────┘  │
│                                                          │
│ ── YOUR SKILLS ─── (Global: 5 | Project: 3) ─────────  │
│ ┌──────────┐ ┌──────────┐ ┌──────────┐                 │
│ │ ⚡ Code   │ │ 🧪 Test  │ │ 🔍 Debug │                │
│ │  Review  │ │ Generator│ │  Helper  │                 │
│ │          │ │          │ │          │                 │
│ │ 🌐 Global│ │ 📁 Proj  │ │ 🌐 Global│                │
│ │ [✏][📋][🗑]│ │[✏][📋][🗑]│ │[✏][📋][🗑]│              │
│ └──────────┘ └──────────┘ └──────────┘                 │
│                                                          │
│ ── SKILL PACKS ──────────────────────────────────────── │
│ ┌──────────┐ ┌──────────┐ ┌──────────┐                 │
│ │ 📦 Code  │ │ 📦 DevOps│ │ 📦 Doc   │                │
│ │ Review   │ │  Pack    │ │ Writer   │                 │
│ │ Pack     │ │          │ │ Pack     │                 │
│ │ 4 skills │ │ 3 skills │ │ 2 skills │                 │
│ │[Install] │ │[Install] │ │[Install] │                 │
│ └──────────┘ └──────────┘ └──────────┘                 │
└──────────────────────────────────────────────────────────┘
```

#### Skill Editor View
```
┌──────────────────────────────────────────────────────────┐
│ ← Back to Skills        Edit: code-review       [Save]   │
├─────────────────────────┬────────────────────────────────┤
│ FRONTMATTER             │  PREVIEW                       │
│ ┌─────────────────────┐ │  ┌────────────────────────┐    │
│ │ Name: [code-review] │ │  │ # Code Review          │    │
│ │ Desc: [Review PRs   │ │  │                        │    │
│ │  for quality and    │ │  │ 1. Check for bugs      │    │
│ │  security issues]   │ │  │ 2. Review security     │    │
│ └─────────────────────┘ │  │ 3. Suggest improvements│    │
│                         │  │                        │    │
│ INSTRUCTIONS            │  │ ## Checklist           │    │
│ ┌─────────────────────┐ │  │ - [ ] Error handling   │    │
│ │ # Code Review       │ │  │ - [ ] Input validation │    │
│ │                     │ │  │ - [ ] Test coverage    │    │
│ │ 1. Check for bugs   │ │  └────────────────────────┘    │
│ │ 2. Review security  │ │                                │
│ │ 3. Suggest improve  │ │  ASSETS                        │
│ │                     │ │  ┌────────────────────────┐    │
│ │ ## Checklist        │ │  │ 📄 checklist.txt       │    │
│ │ - Error handling    │ │  │ 📜 review-template.md  │    │
│ │ - Input validation  │ │  │ [+ Add Asset]          │    │
│ └─────────────────────┘ │  └────────────────────────┘    │
└─────────────────────────┴────────────────────────────────┘
```

#### Import from Repository Flow
1. Click "📦 Import" → Dialog
2. **Tab 1 — From Repository:** Enter repo path → scans for `.github/skills/` → checkbox list → Import to Global/Project
3. **Tab 2 — From URL:** Paste GitHub URL → auto-detect → Import
4. **Tab 3 — From File:** Drag & drop or browse for skill folder/zip

### 2.4 Technical Architecture

```
┌─────────────────────────────────────────┐
│              Vue Frontend               │
│  ┌──────────┐ ┌───────────┐            │
│  │SkillStore│ │ SkillViews│            │
│  │ (Pinia)  │ │ (Vue SFC) │            │
│  └────┬─────┘ └───────────┘            │
│       │                                 │
├───────┼─────────────────────────────────┤
│       │      Tauri Command Bridge       │
│       ▼                                 │
│  ┌──────────────────────────────────┐   │
│  │   tracepilot-tauri-bindings      │   │
│  │   (thin IPC wrappers only)       │   │
│  └────────────┬─────────────────────┘   │
│               ▼                         │
│  ┌──────────────────────────────────┐   │
│  │   tracepilot-orchestrator        │   │
│  │   ┌─────────────────────────┐    │   │
│  │   │ skills.rs               │    │   │
│  │   │ - list_skills()         │    │   │
│  │   │ - read_skill()          │    │   │
│  │   │ - write_skill()         │    │   │
│  │   │ - delete_skill()        │    │   │
│  │   │ - import_skill_local()  │    │   │
│  │   │ - import_skill_github() │    │   │
│  │   │ - backup_skills()       │    │   │
│  │   │ - parse_skill_md()      │    │   │
│  │   └─────────────────────────┘    │   │
│  └──────────────────────────────────┘   │
│                                         │
│  Skill directories:                     │
│  ~/.copilot/skills/<name>/SKILL.md      │
│  .github/skills/<name>/SKILL.md         │
└─────────────────────────────────────────┘
```

### 2.5 Skill Directory Structure (Deep Detail)

```
<skill-name>/
├── SKILL.md              # Required — YAML frontmatter + markdown
├── scripts/              # Optional — executable scripts (sh, py, ps1)
├── assets/               # Optional — templates, configs, resources
└── references/           # Optional — supporting documentation (.md)
```

**SKILL.md Frontmatter Fields:**
```yaml
---
name: playwright-cli                    # Required: lowercase-hyphenated, 1-64 chars, must match dir
description: "Automates browser..."     # Required: 10-1024 chars, triggers Copilot matching
allowed-tools: Bash(playwright-cli:*)   # Optional: pre-approved tool grants (security-sensitive)
license: MIT                            # Optional: license identifier
compatibility: "requires Node.js"      # Optional: constraints
---
```

**Real-world example from this machine:**
- `playwright-cli/` has `allowed-tools: Bash(playwright-cli:*)` and 7 files in `references/` (request-mocking.md, running-code.md, session-management.md, storage-state.md, test-generation.md, tracing.md, video-recording.md)
- `frontend-design/` is minimal — just a SKILL.md with name and description

### 2.6 Import from GitHub (Private Repository Support)

TracePilot currently has **no GitHub OAuth implementation**. To support private repo imports, we propose two auth methods:

**Method 1 — GitHub CLI (`gh`) — Recommended:**
```
# Check auth status
gh auth status → "Logged in to github.com as MattShelton04"

# Scan repo for skills
gh api /repos/{owner}/{repo}/git/trees/{branch}?recursive=1
→ Filter for .github/skills/**/SKILL.md paths

# Download each skill file
gh api /repos/{owner}/{repo}/contents/{path} --jq '.content' | base64 -d
```

**Method 2 — Personal Access Token (PAT):**
```
GET https://api.github.com/repos/{owner}/{repo}/git/trees/{branch}?recursive=1
Authorization: Bearer {token}
Accept: application/vnd.github+json
```

**Auth detection flow:**
1. Check if `gh` CLI is available via `which gh` / `where gh`
2. If available, run `gh auth status` to check login state
3. If authenticated, use `gh api` for all GitHub requests (zero config)
4. If not available or not authenticated, prompt for PAT input
5. PAT requires `repo` scope for private repositories

**Key Rust Types:**
```rust
#[derive(Serialize, Deserialize)]
pub struct SkillFrontmatter {
    pub name: String,
    pub description: String,
    #[serde(rename = "allowed-tools")]
    pub allowed_tools: Option<String>,
    pub license: Option<String>,
    pub compatibility: Option<String>,
    // Forward-compatibility
    #[serde(flatten)]
    pub extra: HashMap<String, serde_json::Value>,
}

#[derive(Serialize, Deserialize)]
pub struct Skill {
    pub frontmatter: SkillFrontmatter,
    pub body: String,         // Markdown content after frontmatter
    pub path: String,         // String at IPC boundary, PathBuf internally
    pub scope: SkillScope,
    pub assets: Vec<SkillAsset>,
}

#[derive(Serialize, Deserialize)]
pub enum SkillScope {
    Global,  // ~/.copilot/skills/
    Project, // .github/skills/
}

#[derive(Serialize, Deserialize)]
pub struct SkillAsset {
    pub name: String,
    pub relative_path: String,  // e.g., "references/tracing.md"
    pub size_bytes: u64,
    pub is_directory: bool,
}
```

---

## 3. Cross-Feature Integration Points

### 3.1 Session Detail Enhancement
- **MCP tab** in session detail showing which MCP tools were invoked during the session
- **Skills badge** on sessions showing which skills were active
- Cross-reference between installed MCP servers and tool calls in session data

### 3.2 Orchestration Integration
- **Session Launcher** gains optional MCP server selection (override which servers are active for this session)
- **Session Launcher** gains optional skill selection (force-load specific skills)
- **Config Injector** Environment tab shows MCP config alongside agent YAML

### 3.3 Search Integration
- MCP server names and skill names become searchable entities
- Filter sessions by "used MCP tool X" or "activated skill Y"

### 3.4 Settings Integration
- **Settings → MCP** section for global defaults (auto-backup, sync preferences)
- **Settings → Skills** section for global defaults (default scope, editor preferences)

---

## 4. Implementation Priority & Complexity

### Phase 1 — Foundation (Medium complexity)
1. **MCP Manager** — Read/write config, list servers, add/remove/edit
2. **Skills Manager** — Read/write SKILL.md files, list skills, add/remove/edit

### Phase 2 — Enhanced UX (Medium complexity)
3. **MCP Browser** — Static catalog, one-click install
4. **Skills Editor** — Visual editor with live preview
5. **Skills Importer** — Import from repo path

### Phase 3 — Power Features (Higher complexity)
6. **MCP Health Check** — Process spawn, protocol validation
7. **Skills from Session** — Extract patterns from session history
8. **Backup & Restore** — Both features
9. **Cross-tool Sync** — VS Code config synchronization

### Phase 4 — Analytics (Medium complexity)
10. **MCP Analytics** — Tool usage tracking in session data
11. **Skills Analytics** — Activation tracking

---

## 5. Risk Assessment

| Risk | Mitigation |
|------|-----------|
| Config file corruption | Always diff before save, auto-backup on write |
| MCP server process management | Use stdio transport for health checks with timeout (5s hard kill) |
| SKILL.md frontmatter parsing | Use mature YAML parser (serde_yaml), validate schema |
| Cross-platform path differences | Use `dirs` crate for home dir, normalize paths |
| Catalog freshness | Ship static catalog, optional background update check |
| Scope confusion (global vs project) | Clear visual indicators, scope badge on every item |
| **Tauri 2 fs permissions** | Audit `capabilities/` config; add scoped write permissions in Phase 0 |
| **Concurrent file access** | Use `notify` crate for file watching; reload on change; warn before overwriting newer file |
| **MCP health check resource leak** | Enforce hard timeout, kill process group, limit concurrent health checks to 3 |
| **VS Code schema differences** | Build explicit translation layer (`servers`→`mcpServers`, `${env:VAR}`→`$VAR`) |
| **Skills `allowed-tools` security** | Display prominently; warn on wildcard permissions like `Bash(*)` |
| **No native enable/disable** | Store disabled state in TracePilot's own metadata DB; re-inject on enable |
| **Large skill asset directories** | Lazy-load assets; only read frontmatter for listing; load full content on demand |

---

## 6. Competitive Analysis

| Feature | TracePilot (Proposed) | VS Code MCP | Claude Desktop | Cursor |
|---------|----------------------|-------------|----------------|--------|
| Visual MCP browser | ✅ Rich card grid | ❌ JSON only | ❌ JSON only | ❌ JSON only |
| One-click MCP install | ✅ From catalog | ⚠️ Gallery | ❌ Manual | ❌ Manual |
| MCP health checking | ✅ Protocol test | ❌ | ❌ | ❌ |
| MCP backup/restore | ✅ | ❌ | ❌ | ❌ |
| Visual skill editor | ✅ Split preview | ❌ | N/A | N/A |
| Skill import from repo | ✅ Scan & import | ⚠️ Manual | N/A | N/A |
| Skill analytics | ✅ Session correlation | ❌ | N/A | N/A |
| Cross-scope management | ✅ Global + Project | ⚠️ Workspace | ❌ | ❌ |

---

## 7. Summary of Genuinely Useful Features (Ranked)

### MCP — Must Have
1. **Server Manager** — Visual CRUD for mcp-config.json (replaces manual JSON editing)
2. **Server Browser/Installer** — Discover and one-click install popular servers
3. **Scope Management** — Clear global vs per-project management
4. **Config Import from VS Code** — Many users have VS Code configs already

### MCP — High Value
5. **Health Check** — Verify server connectivity
6. **Backup/Restore** — Protect configs during experimentation
7. **Session Integration** — See which MCP tools were used per session

### Skills — Must Have
1. **Skills Manager** — Visual list of installed skills with scope indicators
2. **Skills Editor** — Create/edit SKILL.md with live preview
3. **Import from Repository** — Copy a project's skills to global scope

### Skills — High Value
4. **Skills Browser** — Discover community skills
5. **Create from Template** — Start with battle-tested templates
6. **Backup/Restore** — Protect skills library
7. **Bulk Import** — Import all skills from a repo to global

---

---

## 8. Consolidated Reviewer Feedback & Revisions

Four AI models (Claude Opus 4.6, GPT 5.4, GPT 5.3 Codex, Claude Sonnet 4.6) independently reviewed this report. Below is the consolidated, de-duplicated feedback organized by theme, along with the resulting revisions.

### 8.1 Technical Corrections Applied

| Original Claim | Correction | Source |
|---------------|-----------|--------|
| MCP transport types: `stdio / http / sse` | `local` is also a valid synonym for `stdio`; SSE deprecated but still supported | GPT 5.4, Opus 4.6 |
| `.copilot/mcp-config.json` per-project | Not clearly documented in official CLI docs; also `.mcp.json` (flat, no wrapper) at project root | GPT 5.4, Opus 4.6 |
| Skills only in `.github/skills/` and `~/.copilot/skills/` | Also supported: `.claude/skills/`, `.agents/skills/`; optional `license` frontmatter field | GPT 5.4 |
| `McpServerEntry.transport: String` | Should be an enum/variant, not a raw string | Codex 5.3, Opus 4.6 |
| Rust types use `PathBuf` | Use `String` at IPC boundary (Tauri serializes strings); convert to `PathBuf` internally | Codex 5.3 |
| `McpServerEntry` fields incomplete | Missing `cwd`, `instructions`, `oauth`, `sandbox` fields | Opus 4.6 |
| `SkillFrontmatter` missing `allowed-tools` | Real skills use `allowed-tools: Bash(playwright-cli:*)` for tool permissions — security-critical | Opus 4.6 |
| VS Code uses `"servers"` not `"mcpServers"` | Import must translate schema keys; also translate `${env:VAR}` → `$VAR` | Opus 4.6 |
| Business logic placement | MCP/Skills logic belongs in `tracepilot-orchestrator`, NOT in bindings crate (thin IPC wrappers only) | Opus 4.6 |

### 8.2 Architecture Fit Confirmation

All four reviewers confirmed the proposed architecture is a strong fit:

- **Pattern match:** Follow `configInjector.ts` pattern exactly — Rust in `tracepilot-orchestrator`, IPC in `tracepilot-tauri-bindings`, client wrappers in `packages/client`, DTOs in `packages/types`, Pinia setup stores with `loading/error/saving` refs. *(Codex 5.3)*
- **Reuse:** Leverage existing `copilot_home()`, `validate_path_within()`, atomic file writes, and backup/diff flows. *(Codex 5.3)*
- **Naming:** Follow `snake_case` for IPC commands, `camelCase` for client functions. *(Codex 5.3)*
- **Error handling:** Use `BindingsError` consistently with new variants (`McpConfigRead`, `McpConfigWrite`, `SkillParse`, `SkillNotFound`). Surface via store `error` ref + `toErrorMessage()`. *(Codex 5.3)*
- **Mock fallbacks:** Add mock implementations in `packages/client` for non-Tauri dev environments. *(Codex 5.3)*

### 8.3 Missing Features Identified (Added to Feature Map)

| Feature | Description | Reviewer |
|---------|-----------|----------|
| **Secret/keychain storage for env vars** | MCP env vars with API keys should support keychain-backed storage, not just plain JSON. Missing-secret detection and masked UI with show/hide toggle | GPT 5.4 |
| **Skill provenance/versioning** | Track source repo, pinned commit/tag, "update available" indicator, local modifications diff | GPT 5.4 |
| **Real-time MCP heartbeat** | Heartbeat/last-seen/latency/retry state beyond one-shot "test connection" | GPT 5.4 |
| **Four-state status model** | `unknown` (grey, never checked) → `checking` (pulsing amber) → `healthy` (green) → `error` (red with message) | Sonnet 4.6 |
| **Health check timeout** | 5s timeout on MCP protocol handshake; capture stderr/stdout for diagnostics | GPT 5.4, Sonnet 4.6 |
| **Typed error categories** | Spawn failed, bad JSON, missing runtime, auth/secret missing, handshake timeout, bad URL | GPT 5.4 |
| **Skill name collision handling** | Same name across scopes is valid (show prominent scope badge); same name within scope shows warning badge | Sonnet 4.6 |
| **Empty state design** | Dedicated empty states for "no servers" / "no skills" with CTA to catalog/create | Sonnet 4.6 |
| **Network-offline catalog fallback** | Fail silently, use bundled static catalog, show "last updated: bundled" indicator | Sonnet 4.6 |
| **No native enable/disable mechanism** | Copilot CLI has no "disabled" flag — servers exist or don't. TracePilot must store disabled state in its own metadata DB or use a `_disabled` convention | Opus 4.6 |
| **Existing `skill.invoked` parsing** | Codebase already parses `SkillInvokedData` events and MCP tool metadata from sessions — analytics Phase 4 has a head start | Opus 4.6 |
| **Tauri 2 filesystem permissions** | Writing to `~/.copilot/mcp-config.json` and `~/.copilot/skills/` requires explicit scope entries in Tauri capabilities config | Opus 4.6 |
| **File watching for concurrent access** | Use `notify` crate to detect external config edits; reload on change; warn before overwriting newer file | Opus 4.6 |
| **Config merge visualization** | When global + project configs both define a server, show "effective config" merged view with source indicators | Opus 4.6 |
| **`allowed-tools` security display** | Show `allowed-tools` prominently in skill detail; warn on wildcard permissions like `Bash(*)` | Opus 4.6 |
| **Progressive "Test Connection" output** | Multi-step: "Starting process…" → "Protocol handshake…" → "Listing tools…" → "✅ 14 tools available" | Opus 4.6 |
| **Phase 0: Permissions & Plumbing** | Verify Tauri fs permissions, add routes/sidebar entries/empty stores before any feature work | Opus 4.6 |

### 8.4 UX Revisions (Based on Sonnet 4.6 Deep UX Review)

#### 8.4.1 Information Architecture — Revised
- **Unified "Extensions" view:** MCP and Skills should be a single sidebar item **"Extensions"** with `tab-nav` (MCP Servers | Skills), not two separate items. Halves sidebar items, provides unified mental model for "things that extend Copilot." *(Sonnet 4.6)*
- **OrchestrationHome tiles:** Add summary tiles for MCP (servers active/unhealthy) and Skills (installed count) on the Command Centre dashboard.
- **Settings integration:** Embed preferences directly in the manager view header (gear popover), don't fragment across Settings. Reserve Settings only for truly app-wide defaults.

#### 8.4.2 Layout Revisions
- **Catalog as a tab, not scroll continuation:** The MCP catalog should be a separate tab, not mixed on the same page as installed servers. No existing view mixes owned items with a discovery catalog.
- **Consider list+detail over card grid for MCP:** For small-count entities (3-15 servers), a compact list with detail panel (like WorktreeManagerView) may be more appropriate than cards. Cards remain good for catalog browsing.
- **Skills editor: tabs over split-panel:** Use `tab-nav` (`[Edit] [Preview] [Assets]`) instead of a permanent side-by-side split. On 1280px with sidebar, content area is ~1040px — 50/50 split gives 520px per column, cramming 3 panels into 520px. Sequential tabs are less overwhelming and work at any window width.
- **Card grid should use `repeat(auto-fill, minmax(300px, 1fr))`** instead of fixed column counts for responsive behavior.

#### 8.4.3 Interaction Pattern Revisions
- **Catalog in modal is an antipattern:** Replace with: `+ Add` → small choice modal: "Browse Catalog" (navigates to full view) vs "Add Manually" (focused form modal). Scrollable grid inside a modal creates nested scroll contexts.
- **Action buttons on hover only:** Surface card action buttons (configure/delete) on hover with `opacity: 0 → 1`, consistent with existing card patterns. Not always-visible.
- **Scope as segmented control, not filter dropdown:** Global/Project is not a filter — it's where config lives. Use `btn-group` segmented control in page header, not a dropdown.
- **Auto-save frontmatter, explicit save body:** Match ConfigInjector pattern (auto-save form fields) while requiring explicit save for markdown body edits.
- **Use existing `useConfirmDialog()` for deletions**, not custom inline confirmations.
- **Use SVG icons, not emoji:** TracePilot uses inline SVG icons exclusively (16×16, stroke="currentColor"). Emoji won't honor theme colors.

#### 8.4.4 Progressive Disclosure — Revised Strategy
- **Feature flag gating:** Gate advanced capabilities (tool-level enable/disable, raw JSON editor, diff preview, clone, batch operations, VS Code sync) behind `usePreferencesStore.isFeatureEnabled()` as "Power User Mode" in SettingsExperimental.
- **Hide transport type on cards in simple mode:** `stdio/http/sse` is meaningless to non-technical users. Show only in detail panel.
- **Default scope without requiring understanding:** Default to Global for Skills, Project for MCP (if project config exists). Only surface scope selector on explicit "Change scope" click.

### 8.5 Scalability Revisions (GPT 5.4)

- **Card grid doesn't scale to 50+ items.** Use virtualized table/list for installed items; keep cards only for catalog discovery.
- **Add faceted filters, bulk actions, grouping, compact density mode** for power users with many servers/skills.
- **Lazy-load detail panes** — don't parse all SKILL.md bodies upfront; load on demand.

### 8.6 Test Strategy (Codex 5.3)

#### Rust Tests (using `tempfile`)
- Read/write config roundtrip for MCP JSON and SKILL.md
- Malformed JSON/YAML handling (graceful errors, not panics)
- Scope path resolution (global vs project)
- Backup/restore verification
- Path validation (no directory traversal)

#### Frontend Store Tests (Vitest + mocked client)
- Initialize with partial failures (some files missing)
- CRUD flow tests (add/edit/remove server or skill)
- Optimistic update rollback on error
- Error state management

#### Error Mapping Tests
- New backend error sentinel strings mapped correctly in `backendErrors.ts`

### 8.7 Bloat Assessment (GPT 5.4)

| Feature | Assessment |
|---------|-----------|
| MCP CRUD, test/status, simple skill list | **Daily use** — must have |
| Import existing config, basic skills editor | **Weekly use** — high value |
| Catalog browsing, one-click install | **Onboarding use** — high initial value |
| Gist sharing, backup/restore | **Rare** — nice to have, lower priority |
| Skills from session extraction | **Rare** — defer to Phase 4+ |
| Conditional activation rules | **Bloat** — remove from scope |
| Cost-per-MCP-tool analytics | **Bloat** — remove from scope |
| Community packs/marketplace | **Deferred** — needs ecosystem maturity |

---

## 9. Revised Implementation Phases

Based on reviewer feedback, the phases are adjusted:

### Phase 0 — Permissions & Plumbing (Pre-requisite)
0. Audit and configure Tauri 2 filesystem permissions for `~/.copilot/mcp-config.json`, `~/.copilot/skills/`, `.copilot/`, `.github/skills/`
1. Add Vue Router routes, sidebar "Extensions" entry, empty Pinia stores (`useMcpStore`, `useSkillsStore`)
2. Add `mcp.rs` and `skills.rs` in `tracepilot-orchestrator` (business logic) and thin IPC wrappers in `tracepilot-tauri-bindings`

### Phase 1 — Core Management (Foundation)
1. MCP config read/write backend (Rust, following `configInjector` patterns)
2. Skills directory read/parse backend (Rust, SKILL.md + frontmatter)
3. **Extensions view** with MCP Servers tab and Skills tab
4. MCP server list (compact list+detail, not card grid)
5. Skills list with scope badges and enable/disable
6. Empty states and error handling

### Phase 2 — CRUD & Editing
7. Add MCP server (manual form + JSON editor)
8. Edit MCP server configuration
9. Skills editor with tab-based UI (Edit | Preview | Assets)
10. Create new skill from template
11. Delete with `useConfirmDialog()`

### Phase 3 — Discovery & Import
12. MCP catalog browser (separate tab/view, static JSON catalog)
13. One-click MCP install from catalog
14. Skills import from repository path
15. Skills import from URL
16. Bulk "Import all from repo to global" action
17. Import from VS Code `mcp.json`

### Phase 4 — Advanced & Analytics
18. MCP health check with 4-state model + timeout
19. Secret masking with show/hide toggle
20. Backup/restore for both features
21. OrchestrationHome summary tiles
22. Feature-flag gated "Power User Mode"
23. Session integration (MCP tool usage badges)

### Phase 5 — Polish & Scale
24. Skill provenance tracking (source repo, update detection)
25. Virtualized lists for large collections
26. Cross-tool config sync (VS Code ↔ Copilot CLI)
27. Skill packs / bundles

---

## 10. Final Assessment

### Verdict: Both features are **strongly recommended** for implementation.

**MCP Management** directly addresses a pain point: users currently edit JSON files by hand to manage MCP servers. A visual manager with health checking and catalog discovery would be a significant competitive advantage — no other tool offers this.

**Skills Management** is equally valuable but slightly less urgent since skills are newer and the ecosystem is still maturing. The editor and import capabilities are the standout features; the catalog/marketplace aspects should be deferred until community skill collections exist.

**Combined as "Extensions"** in the sidebar, these features reinforce TracePilot's position as the complete command centre for Copilot CLI, moving beyond session inspection into full lifecycle management of the AI development environment.

### Key Design Principles (from reviewer consensus)
1. Follow existing patterns religiously (ConfigInjector, WorktreeManager, SettingsView)
2. Use `BindingsError` for all backend errors, `useToast()` for transient feedback
3. Feature-flag advanced capabilities behind "Power User Mode"
4. Default to safe, simple behavior (auto-scope, bundled catalog, graceful degradation)
5. Design for 3-15 servers and 5-20 skills as the common case; support 50+ with virtualization

---

*Report reviewed by: Claude Opus 4.6, GPT 5.4, GPT 5.3 Codex, Claude Sonnet 4.6*  
*All reviewers confirmed technical accuracy of the core proposal. Corrections and enhancements above have been incorporated.*
