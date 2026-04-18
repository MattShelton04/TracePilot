# Historical Token Pricing Support — Feasibility Report

## 1. Problem Statement

Historical pricing matters because TracePilot is not just a session viewer; it is implicitly a cost ledger.

If model pricing changes over time and TracePilot always recomputes cost from the **current** pricing table, older sessions become financially inaccurate. That creates several problems:

- **Audit drift** — a session from March could display a different cost in June.
- **Broken trend analysis** — cost charts would change even when token usage did not.
- **Loss of trust** — users cannot rely on the app for retrospective cost analysis.
- **Poor model comparisons** — "what was expensive?" becomes distorted by later price updates.
- **Export instability** — reports generated at different times from the same session could disagree.

For a local-first desktop app, this is especially important: users expect their local history to be durable and self-consistent, even offline.

---

## 2. Current Architecture

TracePilot's current design uses:

- a **static model registry** containing per-model pricing:
  - input cost per million tokens
  - cached input cost per million
  - output cost per million
  - premium-request multiplier
- a **user-configurable pricing preferences store**
- **raw token usage** and premium request usage stored in local session/index data
- **cost computed at read/render time**, not permanently frozen with the session

This is simple and works well for "current estimated cost," but it has a key limitation:

> historical session cost is derived from mutable pricing data.

That means any of the following can change old results:

- app updates that change built-in model prices
- user edits to pricing preferences
- model registry additions or renames
- future changes to premium request pricing logic

In short: the current architecture is good for simulation, but weak for historical accounting.

---

## 3. Feasibility Assessment

**Feasibility: high**  
**Complexity: moderate**

Why it is feasible:

- TracePilot is already **local-first**
- it already stores **raw token usage**
- SQLite is a strong fit for **immutable pricing snapshots** and lightweight migrations
- Tauri/Vue/Rust architecture makes this easy to implement cleanly:
  - Rust backend can own snapshot persistence and migration
  - frontend can display frozen cost plus "recalculate with current pricing" as an optional secondary view

Why it is not trivial:

- existing sessions were likely not stored with historical price context
- pricing is partly **user-configurable**, so "historical truth" may mean "the pricing the user had configured at that time," not just vendor pricing
- the team must decide whether pricing should be frozen:
  - per session
  - per segment/shutdown snapshot
  - per turn
  - or via lookup against an effective-dated history table

Still, this is a contained feature. It does not require cloud infrastructure or major architectural change.

---

## 4. Implementation Approaches

### Approach A — Snapshot pricing directly onto each session record

**Idea:** When a session is first indexed or updated, copy the relevant pricing into that session's persisted data:

- premium request unit price
- per-model input/cached/output rates actually used
- optionally precomputed monetary totals

**What gets stored:** Example fields: `pricing_snapshot_json`, `pricing_source` (`default`, `user_override`, `migrated`), `pricing_captured_at`, `wholesale_cost_frozen`, `copilot_cost_frozen`.

**Pros:**
- Very easy to reason about
- Session remains self-contained
- Reads are fast — no temporal join logic
- Works offline perfectly

**Cons:**
- Duplicates pricing data across many sessions
- If a session spans a pricing change, session-level snapshot may be too coarse
- Less elegant if the team later wants pricing history analytics

**Best fit:** Good if the team wants the **lowest implementation risk** and mostly cares about session-level accuracy.

---

### Approach B — Append-only pricing history table with effective dates

**Idea:** Create a `pricing_history` table in SQLite. Each entry has model/pricing definition, premium request price, effective start/end timestamps, and provenance/source. At query time, TracePilot chooses the pricing row whose effective window matches the session timestamp.

**Pros:**
- Clean temporal model
- Good for answering "what was the official price on date X?"
- Storage efficient

**Cons:**
- More query complexity
- Awkward for **user-edited local pricing**, since user changes are not always date-policy changes
- Old sessions can still shift if selection logic changes or history rows are edited incorrectly

**Best fit:** Best for systems with **canonical vendor pricing timelines**, less ideal for a desktop app with local overrides.

---

### Approach C — Store raw tokens + immutable pricing version ID *(Recommended)*

**Idea:** Introduce immutable `pricing_versions` and `pricing_version_models` tables. Each session (or segment) stores raw usage plus a `pricing_version_id`.

**Tables:**

`pricing_versions`:
- `id`, `captured_at`, `source` (`default`, `user_override`, `migration`), `premium_request_unit_price`, `hash` (to dedupe identical versions), optional `notes`

`pricing_version_models`:
- `pricing_version_id`, `model_id`, `input_per_m`, `cached_input_per_m`, `output_per_m`, `premium_requests_multiplier`

**Pros:**
- Strong historical correctness
- Deduplicates identical pricing snapshots
- Easy to compare "frozen historical cost" vs "recomputed current cost"
- Fits SQLite very well

**Cons:**
- Slightly more schema work than Approach A
- Need logic to create a new version whenever pricing preferences change

**Best fit:** Very strong fit for TracePilot.

---

### Approach D — Store frozen monetary totals only

**Idea:** At indexing time, compute and persist only `copilot_cost_frozen` and `wholesale_cost_frozen`. Do not store the underlying pricing snapshot.

**Pros:** Smallest schema change, very fast reads.

**Cons:** Poor auditability, cannot explain how a number was derived later, fragile if pricing formula evolves.

**Best fit:** Not recommended except as a minimal stopgap.

---

## 5. Recommended Approach

### Recommendation: **Approach C with optional materialized totals**

Use an **immutable pricing version/snapshot model**, referenced by session data, with frozen totals stored for convenience.

For a local desktop app with SQLite, this gives the best balance of historical correctness, storage efficiency, query simplicity, and future flexibility.

### Recommended behavior

- When pricing preferences change, create a **new immutable pricing version**
- New indexing/reindexing uses the latest version
- Existing sessions keep their original `pricing_version_id`
- UI displays:
  - **Historical Cost** (frozen)
  - optional **Recalculate with Current Pricing** (comparison mode)

### Why not pure effective-dated history?

Because TracePilot is local and user-configurable. In this context, "the right historical price" is usually **the exact local pricing configuration that existed when the session was recorded**, not an abstract vendor timeline.

---

## 6. Migration Considerations

Existing session data is the hardest part because historical price context likely does not exist.

### Practical migration strategy

1. **Preserve raw usage** — do not rewrite token usage data; that remains the durable source of truth.

2. **Backfill a synthetic pricing version** — on migration, create one `pricing_version` from the user's current pricing settings and mark it `source = migrated` / `is_exact_historical = false`. Link all legacy sessions to this version only if no better information exists.

3. **Be explicit in the UI** — legacy sessions should show a label such as:
   - *"Estimated using migrated pricing"*
   - *"Historical pricing unavailable for sessions recorded before version X"*

4. **Freeze all new sessions going forward** — from the migration release onward, every newly indexed session should get a real immutable pricing version.

5. **Optional reindex behavior** — if TracePilot reindexes sessions from raw event logs, it should **retain the original `pricing_version_id`** unless the user explicitly asks to recompute using current pricing.

### Key policy decision

The team should decide whether "reindex" means:

- **Repair data without changing historical prices** ← recommended
- **Rebuild everything from current settings** ← not recommended as default

---

## 7. Complexity Summary

### Overall effort: **Medium**

| Area | Effort |
|---|---|
| Schema + backend support | Low–Medium |
| Migration + provenance handling | Medium |
| UI updates and comparison mode | Low |
| Testing and edge cases | Medium |

**Why not low:** This touches several layers — SQLite schema migration, backend indexing/writing logic, pricing preference lifecycle, UI display and labeling, and migration semantics for legacy sessions.

**Why not high:** It is still a local, single-user system — no distributed consistency problem, no server rollout coordination, no multi-tenant historical billing engine. Existing raw usage data already provides a solid base.

### Bottom line

This is a worthwhile feature if TracePilot wants cost analytics to be trusted over time. For a session-tracking desktop app, **historical pricing support is not over-engineering — it is a correctness feature**.

If the team invests, they should do it with **immutable pricing snapshots/versioning**, not with live recomputation from mutable defaults.
