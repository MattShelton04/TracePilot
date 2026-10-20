# Linked pull requests per session

Status: **phase 1 delivered** (extraction, storage, list and detail UI). Phases 2
and 3 are planned in [§7](#7-delivery-plan).

Goal: show the GitHub pull requests that a Copilot CLI or Claude Code session
**created, updated, merged or reviewed**, so they're easy to see and open. Show them
on the session itself and in the session list. A session that only reviewed a pull
request is still linked to it; pull requests it merely came across (in a fetched
page, a file, a search result or the assistant's own text) are not.

This document covers what the local session data records, every approach that was
measured, the extraction design, where it appears in the UI, and a phased plan.
All numbers come from the maintainer's own sessions on 2026-10-20 (read-only), and
from read-only `gh pr list` queries used as ground truth.

## 1. Summary

- **Claude Code already records the link.** It appends a `pr-link` record to the
  transcript when a session creates a PR, and (since 2.1.205) when it pushes to,
  edits, merges or comments on one. That record alone finds 98.6% of the PRs the
  sessions created. TracePilot already parses the record and then keeps only
  `prRepository`.
- **Copilot CLI records nothing PR-specific.** `workspace.yaml`, `events.jsonl`
  and `session-store.db` have no PR field. `session_refs` is close to empty and
  has had no new rows since May. Copilot links have to come from the transcript:
  the output of `gh pr create`, `gh pr merge` and a few others.
- **The branch is a hint, not a link.** Looking PRs up by the session's branch
  finds only 50% (Copilot, `workspace.yaml` branch) to 68% (Claude, `gitBranch`)
  of created PRs. It also attaches PRs to sessions that only sat on the branch:
  126 false pairs across 105 Copilot sessions. The branch is useful only for
  branches the session actually **pushed**, checked against GitHub.
- **Matching every PR URL in the transcript is wrong.** Most PR URLs in a
  transcript are PRs that were being reviewed, listed, fetched or pasted. A naive
  regex is 39% precise on Claude and worse on Copilot.
- **The design: a role-aware extractor over the parsed event stream**
  (Section 4), shared by both sources. For Claude it also uses `pr-link`. It runs
  inside normal indexing, never as a separate sweep, and stores rows in new
  tables in TracePilot's own index database (`index.db`; see §4.4). Existing
  sessions pick the links up through the usual analytics version bump. Live
  state (open, draft, merged, closed, title, checks) is optional, comes from the
  `gh` CLI, and is cached per PR.
- **Where it shows** (Section 6):
  - a state-coloured PR chip in the session header, visible on every tab;
  - a compact PR indicator on session list cards;
  - a **Pull requests** section on the Overview tab with full details and a
    "jump to where it was created" link;
  - in a later phase, a `pr:` search qualifier and pasting a PR URL into search.

## 2. What the local data contains

### 2.1 Claude Code (173 sessions, CLI 2.1.274–2.1.302, CLI and desktop)

**`pr-link` record.** This is a top-level line in the main `<sessionId>.jsonl`.
It never appears in `subagents/*.jsonl`; a PR a subagent creates is linked in the
parent transcript. Real example:

```json
{"type":"pr-link","sessionId":"0155f400-…","prNumber":118,
 "prUrl":"https://github.com/MattShelton04/41026ASDProject/pull/118",
 "prRepository":"MattShelton04/41026ASDProject","timestamp":"2026-09-27T04:08:20.995Z"}
```

| Fact | Value |
|---|---|
| Sessions with ≥1 `pr-link` | 137 / 173 (CLI 85/107, desktop 52/67) |
| `pr-link` lines → distinct (session, PR) pairs | 2,683 → ≈215. The latest PR is re-appended in each end-of-turn metadata block (up to 259 copies in one session). |
| Distinct PRs per linked session | 1 in 120 sessions, 2–7 in 14, and 11, 16, 17 in three orchestrator sessions |
| What writes it | `gh pr create` output (main thread or subagent). Also `git push` to a branch with an open PR: 62/63 on the main thread, only 10/28 from subagents. Not written by MCP tools, nor by `gh pr view` of an unrelated PR. |
| False positives | none |
| Misses | 3 of 215 created PRs. When one Bash call created several PRs, only the **last** got a `pr-link` (e.g. #996 and #997 created together, only #997 linked). |

Rules for reading `pr-link`:

- Collect **every** `pr-link` line, not only the last one. Only the most recent PR
  is re-appended, so reading just the last line would drop the earlier PRs of a
  multi-PR session.
- Deduplicate on `prRepository#prNumber`.

**Other fields.**

- Every message record carries `gitBranch` and `cwd`. `gitBranch` takes 2+ values
  in 112 of 173 sessions (typically `main` → feature → `main`).
- For 68/214 PRs (32%), the PR's head branch never appears as `gitBranch`.
  Orchestrators `cd` into `.agent/worktrees/*` inside Bash, and subagents work
  elsewhere.

**Desktop app metadata** (`%APPDATA%\Claude\claude-code-sessions\…\local_*.json`).
This holds a `prs[]` array per desktop session (`prNumber, repo, host, url, branch,
state, baseRef, own`), keyed to transcripts by `cliSessionId`. It matches `pr-link`
in 61/66 sessions.

- It adds the multi-create miss.
- It also adds one false link, from branch detection in a shared checkout.
- It misses 4 PRs from orchestrator sessions.
- Its `state` is a cached snapshot.

This file is **not used** in this plan (Section 3).

### 2.2 Copilot CLI (623 session dirs, 411 with events, CLI 0.0.409–1.0.100)

**`workspace.yaml`** has `cwd, git_root, repository, branch, host_type, …` and no
PR keys. `branch` is the *latest* context. It equals the created PR's head branch
in only 34/68 cases, because sessions usually end back on `main`.

**`session.start.data.context`** has
`{cwd, gitRoot, branch, headCommit, baseCommit, repository, hostType, repositoryHost}`.

- `repositoryHost` exists from 1.0.34. `session.resume` and
  `session.context_changed` (480 events, 73 sessions) have the same shape.
- TracePilot types `session.context_changed` but doesn't apply it.
- The union of the start, resume and context_changed branches contains the head
  branch for 67/68 created PRs.

**`session-store.db` `session_refs`.** It has 389 `pr` rows across 37 sessions,
and they're bare numbers with no repository.

- Every row can be rebuilt from tool **arguments** alone: GitHub MCP `pullNumber`,
  or `gh pr <verb> N`. So it can't see `gh pr create`.
- Only 17 of the 70 sessions that created a PR have any `pr` row.
- 537 of 541 rows came from one backfill on 2026-04-27, and the last row is from
  2026-05-10.
- **Verdict: not a usable source.** This matches the maintainer's own experience.

**A current CLI writes no PR record either.** Today's 1.0.100 session (asked to
"find the PR linked to this branch") recorded only the `gh pr view` shell call and
its JSON output. The CLI's own answer was that it has no "register PR to session"
mechanism; `/pr` and the status-line badge look the branch up live.

**What the transcript shows** (shell tool calls run through `tool.execution_start`
and `tool.execution_complete`, joined on `toolCallId`):

| Signal | Sessions | Notes |
|---|---|---|
| `gh pr create` with a PR URL in the output | 70 (75 PRs) | The real output is a TTY spinner with **no separator** before the URL: `⣾⣽⣻Creating pull request for Matt/Subagent_Model_Attribution_Fix into main in MattShelton04/TracePilot⣾⣽https://github.com/MattShelton04/TracePilot/pull/475`. A naive regex missed 34 of the 70 sessions because of this. |
| `gh pr create`, PR already exists | 2 | `a pull request for branch "cli/tech_debt_a3f7e" into branch "main" already exists:\nhttps://github.com/MattShelton04/TracePilot/pull/490` (exit 1) |
| `gh pr merge` | 16 (179 PRs) | `Ô£ô Squashed and merged pull request MattShelton04/TracePilot#261 (…)`. The ✓ is stored as mojibake and there's no URL. Orchestrator sessions merge many PRs. |
| `git push` of a non-default branch | 102 | `remote: Create a pull request for 'x' on GitHub by visiting: …/pull/new/x` appears on 86/87 first pushes. **It is not a PR.** |
| GitHub MCP `pull_request_read` | 37 | `arguments:{method, owner, repo, pullNumber}`: reviewing a PR, not linking one. Zero `create_pull_request` calls. |
| Any PR URL anywhere | 112 (645 pairs) | 85% are other repos' PRs being reviewed or listed. Placeholders such as `octo-org/octo-repo` also occur. |

Things that make Copilot output harder to parse:

- **Async shells.** The `tool.execution_complete` says the shell is still running,
  and the real output arrives in a later `read_powershell` call. That call is
  matched by `shellId`.
- **Truncated results.** These show only a 500-character preview, so check
  `detailedContent` too.
- **Failed attempts.** Parse errors, denied calls and help text are common, so
  a `gh pr create` command never counts without a PR URL in its output.

## 3. Approaches considered

| Approach | Precision | Recall (created PRs) | Verdict |
|---|---|---|---|
| Copilot `session_refs` | medium (mentions) | Copilot 17/70 sessions | **Reject.** Stale, numbers only, misses creation. |
| Naive regex for any `github.com/o/r/pull/n` | 0.39 (Claude) | high | **Reject as a link signal.** It finds mentions, not links. Keep only for the hidden "referenced" tier. |
| Claude `pr-link` records | 1.00 | 0.986, plus pushes to existing PRs | **Primary for Claude.** |
| Role-aware shell-output extraction (`gh pr create/merge`, "already exists", `gh pr view` of the current branch) | ~1.00 with the safeguards in §4.3 | Copilot 75/75; fills Claude's 3 misses | **Primary for Copilot; supplement for Claude.** |
| PR for the session's branch via `gh` (`workspace.yaml` / `gitBranch`) | low: 126 false pairs (Copilot), 15 extra (Claude); one PR spread over up to 11 sessions | 0.50 Copilot, 0.68 Claude | **Reject as a link signal.** |
| PR for a branch the session **pushed** to via `gh`, with the PR open during the session | high | Adds 15 Copilot sessions whose only link is a push to an existing PR | **Use** (phase 2) for the "updated" role. Needs network. |
| REST `commits/{sha}/pulls` on `headCommit` | medium | `headCommit` is the *start* commit, not the session's work | **Reject.** The pushed-branch lookup answers the question directly. |
| Claude desktop `prs[]` metadata | high | Same set as `pr-link`, desktop sessions only | **Defer.** It would mean reading a new folder outside `~/.claude`, under account and org IDs, for one extra PR in this corpus. Cached state comes from `gh` anyway. |
| Live `gh pr view` per session when opened | — | — | **Only for state.** It would be slow, need the network, and only knows the *current* branch. |
| Git notes or commit trailers (Entire, Git AI) | — | — | **Out of scope.** TracePilot reads, it never writes to the user's repositories. |

Expected coverage after phase 2, on this corpus:

- **Claude:** every created PR (`pr-link` ∪ `gh pr create` output = 218 pairs), plus
  pushes to existing PRs, including subagent pushes the CLI misses.
- **Copilot:** 75/75 created PRs, the 2 "already exists" cases, 179 merges, and
  about 15 sessions linked only by a push.
- **What's left:** PRs created entirely outside the session (on the web) for work the
  session never pushed. These are rare and correctly unlinked.

## 4. Extraction design

### 4.1 Where it runs

The extractor is a new pure module, `tracepilot-core/src/analysis/pull_requests/`.
It reads the **already-parsed, normalized event stream** that both providers
produce:

- Claude `Bash` and `PowerShell` calls, including subagents, are already
  translated to `tool.execution_start` / `tool.execution_complete` with
  `arguments.command` and `parentToolCallId`.
- `pr-link` records already reach the stream as `Unknown("pr-link")` events with
  their raw data.

So **no parser in `provider/` changes.** The indexer calls the extractor inside the
existing per-session write, so rows rebuild exactly when the session is
re-indexed.

That avoids what got #845 reverted:

- no full sweep after every reindex;
- no second gate held across a sweep;
- no reads of `session-store.db`, which the CLI writes to constantly.

### 4.2 Roles and evidence

Each (session, PR) pair is keyed `host/owner/repo#number`, compared without case.
It keeps the **set** of roles it was seen in, what established each one, the
first and last time, and the event that established its strongest role.

| Role | Evidence (all from tool calls, their output, or the user's prompt; never from assistant prose) |
|---|---|
| **created** | A URL printed by a successful `gh pr create`. For Claude, also a `pr-link` whose PR matches that output. |
| **updated** | A Claude `pr-link` without creation evidence (push, edit or comment on an existing PR); Copilot's "already exists" output; `gh pr view` with **no** number (the current branch's PR); `gh pr edit/comment/close/ready/reopen N`; the Claude desktop app's `bind_pr`. Phase 2 adds pushed-branch lookups. |
| **merged** | `gh pr merge` output `(Squashed and merged\|Rebased and merged\|Merged) pull request (o/r)?#N`, or a merge command with a URL or number and exit code 0. |
| **reviewed** | `gh pr view/diff/checks/checkout/review N`, or a GitHub MCP pull-request read (`pull_request_read`, `get_pull_request*`). |
| **mentioned** | A PR URL the **user** pasted in a prompt. |
| *(not stored)* | URLs in assistant text, web fetches, file reads, list or search output, logs. |

All five roles are links. A session that reviewed a pull request is still
attached to it, so it shows wherever created PRs show.

The **primary PR**, the one shown on chips, is the PR with the strongest role.
Ties go to the most recent, then the highest number.

### 4.3 Safeguards that keep a regex honest

1. **Command position.** Split the shell command on `;`, `&&`, `||`, `|` and
   newlines, and match `gh pr <verb>` only at the start of a segment, allowing
   `cd x &&` and env prefixes. This stops `grep 'gh pr create'` and docs examples
   from counting; that false positive was observed in research sessions.
2. **Outcome.** A link needs a PR URL (or the merge pattern) **in that call's
   output**. Read the exit code from:
   - `shellExecution.exitCode`;
   - the trailer `<exited with exit code N>` or `<shellId: N completed with exit code N>`;
   - Claude's `is_error`.

   "Already exists" is the one accepted non-zero case.
3. **Copilot output quirks.**
   - Strip ANSI codes and Braille spinner characters (U+2800–U+28FF).
   - Allow a URL glued to the preceding repo name.
   - Anchor the merge pattern on words, not on the mojibake ✓.
   - Scan both `content` and `detailedContent`.
   - Follow `shellId` from an async call to its later `read_powershell` / `read_bash` output.
4. **URL grammar.**
   `https?://HOST/OWNER/REPO/pull/N` followed by an end, `/`, `#`, `?`, whitespace
   or a quote.
   - OWNER: `[A-Za-z0-9-]{1,39}`. REPO: `[A-Za-z0-9._-]{1,100}`.
   - N: 1–9 digits, greater than 0.
   - Reject `/pull/new/` and `/compare/`.
   - Reject placeholder owners and repos: `owner/repo`, `OWNER/REPO`,
     `octo-org/octo-repo`, `user/repo`, `org/repo`, `example/*`.
5. **Host allowlist:**
   - `github.com`;
   - `*.ghe.com`;
   - the session's own `repositoryHost` (Copilot `session.start`) or origin
     remote host (Claude).

   GitLab and Bitbucket URLs (which Claude's `--from-pr` accepts) are ignored for
   now. The host comes from the reference itself, never from `host_type`.
6. **Bare numbers** (`gh pr merge 976`, MCP `pullNumber`) resolve against `owner`
   and `repo` arguments when present. Otherwise they use the session's repository
   *at that point in the session*, taken from the latest start, resume or
   context_changed event, or `cwd`'s origin for Claude. If none is known, drop
   the reference.
7. **Untrusted strings.** Every value comes from a session file and may be
   hostile.
   - Store validated parts only.
   - Rebuild the URL as `https://{host}/{owner}/{repo}/pull/{n}`; never open the
     stored text.
   - Open only through `openExternal`.
   - Pass values to `gh` as separate arguments, never through a shell.
8. **Bounds.** At most 1,000 rows per session. Skip shell outputs over 1 MB except
   their first and last 64 KB.

### 4.4 Storage (migration 26)

Everything lives in TracePilot's own index database, `index.db` in its data
folder, next to the rest of the index. TracePilot never writes to Copilot's or
Claude Code's folders. The full column reference is in
[the schema doc](../database/schema.md#session_pull_requests).

| Table | Filled by | Rebuilt on reindex |
|---|---|---|
| `session_pull_requests` | The extractor, one row per (session, PR): roles and evidence bits, `is_primary`, head and base refs, title, first and last seen, event index | Yes (child row) |
| `session_pushed_branches` | The extractor, from `git push` output | Yes (child row) |
| `session_branch_pull_requests` | Phase 2: PRs found on GitHub for a pushed branch | No: network results survive reindexing |
| `pull_request_status` | Phase 2: last known GitHub state per PR, shared by every session linking it | No: keyed by PR, not session |
| `sessions.linked_pr_count`, `primary_pr_host/owner/repo/number` | The extractor | Yes |

The list reads the primary PR straight from `sessions`, and its state with one
indexed lookup into `pull_request_status`, so the list needs no join over the
child table.

### 4.5 Picking up existing sessions

This uses the existing mechanism, with no custom reindex logic. The analytics
versions go up once (Copilot 21 → 22, Claude Code 33 → 34), so every session is
re-extracted on the next background index. All schema and extraction changes for
the three phases landed together in phase 1, so phases 2 and 3 need no further
reindex: they only read these tables, or fill the two network tables.

### 4.6 Live state through `gh` (phase 2)

This reuses `tracepilot-orchestrator/src/github.rs`: the existing `gh` wrapper,
hidden processes, timeouts and GraphQL batching.

- **One query for many PRs.** One `gh api graphql --hostname <host>` call per
  host, with up to 50 aliased `repository(owner,name){pullRequest(number){…}}`
  lookups. That is 1 rate-limit point, against a budget of 5,000/hour.
- **Fields:** `title state isDraft mergedAt closedAt createdAt headRefName
  baseRefName headRepositoryOwner reviewDecision` and the last commit's
  `statusCheckRollup.state`.
- **When it fetches:**
  - When a session detail opens: its PRs, if never fetched or open and older than
    10 minutes.
  - On a manual refresh button.
  - At most one batched call a minute, only while the window has focus, for open
    PRs on visible list cards.
  - Merged and closed PRs are terminal and never re-fetched automatically.
- **Pushed-branch lookup.** For each `session_pushed_branches` row, excluding
  the default branch, `main`, `master`, `develop` and `gh-pages`, query
  `pullRequests(headRefName:$b, first:5, states:[OPEN,MERGED,CLOSED])`.
  - Accept a PR whose head owner matches the push remote's owner, and whose open
    interval overlaps the session's active span (from the first push to the last
    event + 24 h).
  - Accepted PRs gain the **updated** role, with evidence "branch lookup".
- **Without `gh`** (not installed, signed out, or the setting off), PRs still show
  as `#1046`, using the title the transcript recorded when it had one, with no state
  colour. The Overview section explains this once. Errors are stored per PR and
  never block indexing.
- **Setting:** **Settings → General → "Look up pull request status with the GitHub
  CLI"**, next to the existing update check. The proposal is to turn it on by
  default when `gh auth status` succeeds; see §8. The query sends
  only repository names and PR numbers that are already the user's, to their own
  GitHub host, with their own `gh` sign-in.

## 5. Copilot vs Claude at a glance

| Signal | Copilot CLI | Claude Code |
|---|---|---|
| Native link record | none | `pr-link` (collect all lines, deduplicate) |
| `gh pr create` output | **primary**: TTY spinner and glued URL | supplement (multi-create misses) |
| Already exists, merge, view of the current branch | yes | yes (same shell parser) |
| Async shell output | `shellId` → `read_powershell` | `backgroundTaskId` → `shellId`, already mapped |
| Subagents | events carry `parentToolCallId` | folded into the parent stream |
| Branch timeline (for push resolution) | start, resume, context_changed + push output | push output (`gitBranch` is unreliable inside orchestrators) |
| Host | URL; `repositoryHost` (1.0.34+) | URL; origin remote |

## 6. Where to show it

The session overview alone is too deep. PRs are the most common "what came out of
this" answer for coding sessions: 137/173 Claude and 70+/411 Copilot sessions
have one. So the PR shows in three places, all built from existing components and
styling.

1. **Session detail header** (`SessionDetailHeader.vue`). This is the primary
   place, visible on every tab.
   - One `Badge` after the branch chip, coloured by state:

     ```
     [Claude Code] [MattShelton04/TracePilot] [feat/everyday-frictions] [Opus 5.5] [⑂ #1046 Merged]  [+2]
     ```

   - Colours use existing variants: success = open, neutral = draft or unknown,
     done = merged, danger = closed.
   - Clicking the chip opens the PR. `+N` opens a small popover listing the other
     linked PRs.
   - The tooltip shows the title, `head → base`, and the roles ("Created in this
     session").
   - In pop-out viewers, which have no opener permission, the click copies the
     link instead of widening `viewer.json`.
2. **Session list cards** (`packages/ui/.../SessionCard.vue`). In the footer stats
   row, not the badge row, so long repository and branch names keep their room:

   ```
   ⚡ 412   💬 18   ⑂ #1046
   ```

   The icon carries the state colour. A count shows when there's more than one
   linked PR, and a tooltip lists them. `SessionListItem` gains a small
   `linkedPullRequests: { primary, count }` summary, read from `sessions`.
3. **Overview → Pull requests section.** A new entry in `overviewSections.ts`,
   placed right after Summary, and hidden when the session has none.
   - **One card per linked PR:**
     - title, `owner/repo#n`, state pill, `head → base`;
     - checks and review decision, when fetched;
     - role chips (*Created*, *Updated*, *Merged*, *Reviewed*, *Mentioned*);
     - first-linked time, with **"Show in conversation"**, which jumps to
       its `event_index`;
     - **Open** and **Copy link** buttons.
   - **Grouping.** More than 5 merged-only PRs (orchestrator sessions merged up to
     179) collapse into "Merged 23 pull requests".
   - **Reviewed** and **mentioned** PRs are linked too. They follow the others,
     and a group collapses only past five rows.
   - **Related sessions** (phase 3): "Also linked from 2 other sessions" links to
     them. This uses `idx_session_pull_requests_pr`, and connects orchestrators to
     their workers and the five sessions that touched #845.
4. **Search** (phase 3):
   - `pr:1046` and `pr:owner/repo#1046` qualifiers, using parameterized `EXISTS`
     clauses over `session_pull_requests`;
   - pasting a PR URL into search finds its sessions, like Claude's
     `/resume <PR URL>`;
   - a "Has pull request" filter on the session list.

Not chosen: a new detail tab (too heavy for 1–3 items), and the Timeline or
Conversation tabs (the "Show in conversation" jump covers them).

## 7. Delivery plan

All index schema and extraction changes ship in phase 1, so existing sessions are
re-extracted **once**. Phases 2 and 3 change no analytics or extractor version.

### Phase 1: links from the transcript (delivered)

- `tracepilot_core::pull_requests`: the extractor (§4) and its unit tests.
- Migration 26: all four tables and the `sessions` summary columns (§4.4), written
  at index time. Analytics versions bumped once (§4.5).
- `get_session_pull_requests` IPC command (specta), and `linkedPullRequests` on
  `SessionListItem`.
- UI without GitHub state: the header chip, the list-card indicator and the
  Overview **Pull requests** section (§6). Every PR shows as linked, and
  colours stay neutral until phase 2 supplies a state.
- Synthetic Copilot and Claude Code fixture sessions with pull requests.

### Phase 2: state from GitHub, and pushed branches

Network only; no reindex.

- **Setting.** **Settings → General → Look up pull request status with the GitHub
  CLI**, on by default when `gh auth status` succeeds. It covers both
  `pull_request_status` and branch lookups.
- **Status cache.**
  - A `gh api graphql --hostname <host>` batch, up to 50 aliased
    `repository{pullRequest(number)}` lookups per call, through the existing
    wrapper in `tracepilot-orchestrator/src/github.rs` (hidden process, timeout,
    no shell).
  - Upsert into `pull_request_status`; store each failure in `error`.
  - Merged and closed PRs are terminal and aren't refetched automatically.
- **When it runs:**
  - when a session detail opens, for its PRs that were never fetched, or are
    open and older than 10 minutes;
  - when the user clicks a refresh action in the Pull requests section;
  - at most one batched call a minute while the window has focus, for open PRs
    on visible list cards.
- **Pushed-branch lookup.**
  - For each `session_pushed_branches` row (except the default branch and `main`,
    `master`, `develop`, `gh-pages`), query
    `pullRequests(headRefName:, states:[OPEN,MERGED,CLOSED], first:5)`.
  - Accept a PR whose head owner matches the push remote, and whose open interval
    overlaps the session's span (first push to last event + 24 h).
  - Store matches in `session_branch_pull_requests`.
  - `get_session_pull_requests` unions them in with the **updated** role. That
    covers Copilot sessions whose only link is a push to an existing PR, and
    Claude subagent pushes that wrote no `pr-link`.
  - The list count and primary come from the extractor's columns, so branch-only
    links show in the detail view but not on list cards.
- **UI.**
  - State colours and words on the chip, the card and the section (open, draft,
    merged, closed).
  - Checks and review decision on section cards.
  - "Updated" from GitHub when fetched.
  - A short note when `gh` isn't installed or signed in.
- **Pop-out viewers** keep reading only; fetching runs from the main window.

### Phase 3: find sessions by pull request

Index reads only.

- **Search qualifiers.** `pr:1046` and `pr:owner/repo#1046`, as parameterized
  `EXISTS` over `session_pull_requests` (`idx_session_pull_requests_pr`), listed
  in the search syntax help.
- **PR URLs in search.** Pasting a PR URL into search finds the sessions linked to
  it, like Claude Code's `/resume <PR URL>`.
- **Filter.** A "Has pull request" filter on the session list
  (`linked_pr_count > 0`).
- **Related sessions.** "Also linked from n other sessions" on each Overview PR
  card, linking to them. This connects orchestrator sessions with their workers.

### Validation (phase 1)

- **Unit tests** for every pattern in §2 with sanitized real output:
  - the spinner and glued URL;
  - mojibake merge output;
  - "already exists";
  - `/pull/new/`;
  - `grep 'gh pr create'`;
  - placeholders;
  - async `shellId` joins;
  - multiple PRs created in one call;
  - repeated `pr-link` records.
- **Indexer tests:**
  - writing, reading, list summary and status joins;
  - a reindex replaces the links but keeps GitHub state;
  - pruning a session removes its links.
- **Real-corpus check.** Local and read-only, aggregates only: the extractor
  against the research ground truth in §2.
- **Native app check** with `-Fixtures` at 1440×960, 960×640 and 2560×1440.

## 8. Decisions

1. **Reindexing:** use the normal analytics version bump, once, with all schema
   changes in phase 1. No custom backfill.
2. **Reviewed counts as linked:** a session that reviewed a PR stays attached to
   it, and it shows like any other link (ranked below created, updated and
   merged).
3. **Storage:** new tables in TracePilot's `index.db` (§4.4). Nothing is written
   to the CLIs' folders.
4. **Claude desktop metadata** (`prs[]` in the desktop app's session files) is
   not read. It adds almost nothing over `pr-link`, and it lives in a new folder
   under account IDs.
5. **Phase 2 default:** look up status when `gh` is signed in. Confirm this
   before phase 2 starts.
