# Validated findings

Evidence under `.playwright-cli` is local until reviewed and selected for publication. Screenshots of existing sessions are private and will not be committed. The fixture corpus is parsed/indexed by the actual Rust backend; it does not simulate IPC.

## UX-001 — Sessions toolbar overflows the minimum desktop viewport

- Severity: P1 usability. Search shrinks to an icon-width input and refresh/auto-refresh controls extend past the visible content area.
- Reproduction: expanded sidebar, dark theme, 100% scale, 960×640 CSS viewport; open Sessions with populated repositories/branches. Reproduced with 583 existing sessions and 73 visible disposable sessions.
- Expected: every toolbar control remains readable and reachable without horizontal page scrolling.
- Before: `.playwright-cli/toolbar-before-M.png` (fixture, inspected); `.playwright-cli/existing-sessions-M.png` (private, inspected).
- Root cause: unwrapped toolbar flex row plus a viewport breakpoint at 900px, despite the sidebar consuming 240px at the 960px supported size.
- Implementation: intrinsic toolbar wrapping, usable search minimum, wrapping filter and action groups; obsolete 900px workaround removed. Native M after screenshot `.playwright-cli/toolbar-after-M.png` inspected: all controls inside content. Five focused session-list tests pass; D/L smoke pending.

- Public evidence: [Before at M](evidence/toolbar-before-M.png) / [After at M](evidence/toolbar-after-M.png). Root inspected both fixture-only copies for privacy. The primary toolbar state matches; some experimental sidebar items differ between captures.

## UX-002 — Keyboard focus enters hidden onboarding steps

- Severity: P1 usability. Tab can scroll the wizard to a different slide while progress still indicates the previous step.
- Reproduction: first-run Welcome at 1440×960, focus Begin Setup, press Tab.
- Observed: focus moves to the hidden Features Continue button and the overflow viewport scrolls. All five steps are simultaneously exposed to accessibility APIs.
- Expected: only active step controls participate in keyboard navigation; next/previous navigation moves focus to the active heading.
- Before: `.playwright-cli/setup-hidden-focus-before.png` (inspected), `.playwright-cli/setup.yml`.
- Root cause: every slide stays mounted in a translated flex track with no inactive/inert semantics.
- Implementation: inactive slides use inert and aria-hidden; form paths receive accessible names. Nine wizard tests pass. Native Welcome Begin → Tab now focuses Step 1, leaving Welcome visible; `.playwright-cli/setup-hidden-focus-after.png` inspected.

## UX-003 — Setup folder validation becomes stale

- Severity: P2. Continue can remain enabled for an edited invalid folder, and resetting can display an error for the previous folder.
- Reproduction: validate default fixture Copilot home; enter a nonexistent task-local path without blurring. Also validate invalid path, then Reset to default and Continue.
- Observed: enabled Continue alongside invalid path/old error; reset leaves stale error from a superseded request.
- Expected: validation belongs to the exact current path; editing invalidates prior success; delayed responses cannot overwrite newer results.
- Before: `.playwright-cli/setup-stale-before.png`, `.playwright-cli/setup-stale.yml`, `.playwright-cli/setup-step4.yml`.
- Root cause: state survives input edits and asynchronous validation has no request identity guard.
- Implementation: synchronous invalidation and stale response guards. Nine original wizard tests include delayed-result races. Native invalid edit immediately disables Continue; Enter validates and reports missing directory; Reset recovers and setup completes. `.playwright-cli/setup-stale-after.png` inspected. The separate dot/arrow bypass is addressed and natively rechecked under UX-035.

## UX-004 — First-run empty Sessions gives irrelevant filter advice

- Severity: P2. A user who completed setup with no sessions receives no useful next action.
- Reproduction: complete real setup with empty task-local session-state folder, no filters active; open Sessions.
- Observed: “No sessions found / Try adjusting your search or filters.”
- Expected: explain how sessions appear and provide a path to verify data settings; distinguish filtered-out and hidden empty sessions.
- Before: `.playwright-cli/empty-sessions-M.png` (inspected).
- Root cause: one unconditional EmptyState serves every zero-result situation.
- Implementation: distinct first-run, hidden-empty and filtered-empty guidance with Settings, Show empty sessions, or Clear filters. Native no-match Clear filters restores list and clears input. First-run after check pending; five focused tests pass.

## UX-005 — Release notes loses keyboard focus and ignores Escape

- Severity: P2. Keyboard users can reach background controls while a blocking overlay is open and cannot dismiss with Escape.
- Reproduction: Settings → View Release Notes; focus Got it, press Tab; press Escape.
- Observed: active element becomes BODY, next Tab reaches background; Escape leaves the dialog open. Subsequent pointer navigation is blocked by the overlay.
- Expected: initial focus inside dialog; Tab/Shift+Tab contained; Escape closes the topmost modal; focus returns to trigger.
- Before: `.playwright-cli/modal-focus-before.png` (inspected); CLI interaction observed BODY and navigation timeout due overlay interception.
- Root cause: custom release/update overlays omit keyboard lifecycle; shared ModalDialog and Drawer also have incomplete focus behavior.
- Implementation: shared overlay focus lifecycle integrated into ModalDialog, Drawer and dedicated overlays. Native release notes Tab containment and Escape pass; skill asset Escape restores link focus and dirty confirmation cancellation works. Independent review reproduced nested-confirmation preferred-focus and nonmodal-drawer ownership edge cases; both were fixed and covered by the twenty passing overlay/dialog tests, including SVG return focus. Native checks of those exact nested combinations and all migrated consumers remain pending.

## UX-006 — MCP health response appends milliseconds twice

- Severity: P3; health error diagnostic displayed `3msms`.
- Reproduction: disposable missing-executable server → Test Connection at M.
- Before: `.playwright-cli/mcp-health-before-M.png` (inspected).
- Root cause: child appends `ms` to already formatted duration. Removed duplicate suffix; 15 MCP child tests pass. Native after check pending.

## UX-007 — Configuration forms lack programmatic field labels

- Severity: P2 accessibility; MCP fields and row removal controls are ambiguous to keyboard/assistive users.
- Reproduction/evidence: Add MCP Server at D/M, `.playwright-cli/mcp-add.yml` and matching screenshots; skill metadata/editor fields similarly unnamed.
- Root cause: visual labels have no associated input IDs; repeated environment/header icon actions lack names.
- Solution: unique label/control IDs, descriptive row actions, transport selection semantics, validation alert, initial name focus; skill metadata and Instructions names.
- Checks: five MCP accessibility tests and desktop typecheck pass. Native skill Instructions lookup/save and modal initial focus verified. MCP transport switching and advanced-option persistence are not fully verified; UX-012 records the unsupported options and argument handling. Native MCP after checks remain pending, with deeper experimental integration workflows deferred at the user's direction.

## UX-008 — Leaving a dirty skill silently loses edits

- Severity: P1; Back or sidebar navigation discarded unsaved instructions without warning.
- Reproduction: create disposable skill, edit Instructions, click Back; reopen and observe unchanged file. Before `.playwright-cli/skill-unsaved-before-M.png` and snapshot.
- Root cause: editor owns dirty state but router navigation has no guard.
- Solution: shared pending confirmation for route leave and changing skill identity; Keep Editing or Discard and Leave; successful delete clears obsolete dirty state.
- Verification: 15 composable tests pass including navigation cancellation/discard. Native Back → Keep Editing preserved text; Settings → Discard and Leave navigated and file remained unchanged. Native OS-window close remains outside this route guard.

## UX-009 — New skill does not open the promised editor

- Severity: P2; create dialog promises the next editor page but returned to list.
- Root cause: successful creation closes modal without navigating.
- Solution: route to newly created skill using its directory; guard duplicate create calls while busy.
- Native verification: created `audit-create-opens-editor`, landed in editable Instructions immediately. Persistence and dirty guard checked in that editor.

## UX-010 — Saved skill and Windows asset metadata are misleading

- Severity: P3; existing persisted skill says Not saved yet; linked asset preview says 0 B while asset tree says 53 B.
- Root causes: no-save-this-component-session conflated with unsaved file; Windows backslash tree paths compared with normalized link paths.
- Solution: Saved/Unsaved changes state uses editor dirty state; normalize asset lookup separators.
- Checks: composable regressions cover Windows path and initial saved status. Native after metadata recheck pending.

## UX-011 — MCP health tiles exceed the minimum-width panel

- Severity: P2; Context cost tile extends beyond the panel at 960×640.
- Before: `.playwright-cli/mcp-health-before-M.png` (inspected).
- Root cause: fixed four-column grid inside a shrink-resistant split panel.
- Solution: allow panel shrinkage and wrap health tiles by available width. Native after verification pending.

## UX-012 — MCP configuration offers unsupported options and splits literal commas in arguments

- Severity: P2; users can believe a server has a working directory or repository scope that is never saved, and comma-containing process arguments can be changed into separate arguments.
- Reproduction: disposable Add MCP Server at 960×640, dark theme; set the advanced working-directory/scope fields and inspect the configuration preview. In Add/Edit, enter one argument `--headers=a,b` or a path containing a comma on a single line.
- Expected: every offered option is supported by the saved configuration, and one argument per line preserves literal commas and internal spaces. Observed: advanced directory/scope values are omitted; comma splitting changes argument boundaries.
- Before: `.playwright-cli/mcp-advanced-before-M.png`, `mcp-advanced-before.yml` and `mcp-advanced.yml`; source and regression tests establish argument transformation. Native argument round-trip after evidence remains pending.
- Root cause: advanced form state has no corresponding fields in the submitted/backend configuration contract; Add/Edit use argument splitting that treats commas as separators.
- Solution: remove unsupported advanced choices, retain supported description/tags in `AddServerMetadata.vue`, and explain the global configuration location. Shared [`mcpArguments.ts`](../../../apps/desktop/src/components/mcp/mcpArguments.ts) now parses one argument per line in preview, creation and editing.
- Regression coverage: [`McpArguments.test.ts`](../../../apps/desktop/src/components/mcp/__tests__/McpArguments.test.ts) checks comma-containing flags, paths and JSON across Add preview/submission and editor round-trips; existing form tests cover names and validation.
- Status: implemented; native after verification pending. Deeper MCP service/transport exploration is explicitly deferred by user direction, not represented as verified.

## UX-013 — Overflowing detail tabs hide destinations and move the page

- Severity: P2; end tabs become clipped at minimum desktop width and keyboard focus can move the surrounding page instead of keeping the selected destination visible.
- Reproduction: large populated session, expanded sidebar, dark theme, 960×640; inspect all eight detail tabs and navigate to the end with End/arrows. Before measurements: strip client width 650px, content width 725px, clipped Timeline and horizontal page movement.
- Expected: the tab strip scrolls independently; active/focused tabs and their indicators remain visible without losing the content position.
- Before: `.playwright-cli/real-conversation-M.png` (private, inspected). Native after geometry reports the active end tab visible and page horizontal offset `0`; the dark themed scrollbar was inspected. `.playwright-cli/explorer-resize-after-M.png` also shows the resulting scrollbar in a representative consumer, not a matching conversation before/after pair.
- Root cause: shared `TabNav` lacked confined overflow/reveal behavior. An intermediate `scrollbar-width` override also bypassed the app's themed WebView2 scrollbar treatment.
- Solution: [`TabNav.vue`](../../../packages/ui/src/components/TabNav.vue) contains horizontal overflow, prevents tab shrinkage, and reveals selection/focus by changing only the strip's scroll offset. Route/local selection, keyboard navigation and resize share that behavior; focus/active indicators remain inside the scrollport. The obsolete scrollbar override was removed.
- Regression coverage: [`TabNav.scrolling.test.ts`](../../../packages/ui/src/__tests__/TabNav.scrolling.test.ts) covers initial local selection, Home/End, route changes, resize and unchanged ancestor scroll positions alongside existing TabNav tests.
- Status: native minimum-size behavior and dark scrollbar verified; detached, pill and remaining scale/theme consumers still require coverage. Publication needs sanitized matching evidence.

## UX-014 — Explorer resizing can reduce the file reader to an unusable sliver

- Severity: P2; an enlarged file tree retains its width in a smaller workspace, leaving too little room to read the selected file. Keyboard users cannot resize the divider.
- Reproduction: populated session Explorer with `plan.md`, dark theme, expanded sidebar; enlarge the tree to 500px in the 2560×1440 workspace, then shrink to 960×640. The original divider responds only to mouse drag.
- Expected: resizing preserves a usable reader and exposes a keyboard-operable separator with its current bounds. Before/after screenshots: `.playwright-cli/explorer-resize-before-M.png` and `explorer-resize-after-M.png` (private, inspected).
- Root cause: a fixed 160–500px tree clamp ignores available container width; no separator keyboard/value semantics.
- Solution: [`useExplorerPaneResize.ts`](../../../apps/desktop/src/composables/useExplorerPaneResize.ts) observes available width and reserves 320px for the reader plus the 5px divider. Explorer exposes separator values, visible focus, Left/Right with larger Shift steps, Home/End and reset; drag listeners clean up on release/blur/unmount.
- Verification: native End at L reaches 500px; shrinking to M yields tree 339px and reader 320px with readable content. Three [`useExplorerPaneResize.test.ts`](../../../apps/desktop/src/composables/__tests__/useExplorerPaneResize.test.ts) regressions pass; independent review found no regression in the bounded change.
- Limit: below 485px of available pane width, a 160px tree, 5px divider and 320px reader cannot all fit. The tree minimum is retained, so the reader can be narrower there; high UI scale/smaller detached layouts need explicit follow-up rather than a universal 320px claim.

## UX-015 — Todo graph selection is inaccessible by keyboard and gives hidden feedback

- Severity: P2; SVG nodes cannot be reached/activated by keyboard. Pointer selection opens details below the viewport without focus movement, and Escape leaves those details open. Zoom controls expose glyphs rather than useful names.
- Reproduction: real 68-item Todos → Graph at 960×640, dark theme; attempt to focus a node, then pointer-select one and press Escape. Before: `.playwright-cli/todo-node-before-M.png`, `todo-detail.yml`; native inspection confirms the panel stays open.
- Expected: full node names/statuses, Enter/Space activation, visible selection feedback, named zoom actions, and Escape/Close returning to the originating node without trapping page focus.
- Root cause: click-only SVG groups; inline details have no focus/Escape lifecycle or reveal behavior; the shared overlay return target originally accepted only HTML elements.
- Solution: native-focusable named SVG buttons and focus outlines; a named nonmodal detail region reveals itself and focuses Close. Closing reveals the graph viewport and restores the selected SVG node through the shared overlay helper. Keyed details maintain the correct return target when selection changes; zoom actions have explicit labels.
- Verification: native Enter opens the visible detail region and Escape restores SVG-node focus. `.playwright-cli/todo-keyboard-after.yml` and `todo-node-after-M.png` record after behavior (private; image inspected). Thirteen graph tests and twenty overlay/dialog tests pass, including both activation keys, latest-node focus return, and the shared SVG return target.
- Scope: native pointer/keyboard selection and return are verified at M; remaining graph topology, zoom/pan and D/L variants remain partial. Component scroll assertions do not substitute for native geometry checks.

## UX-016 — Search keyboard focus enters collapsed filters and cannot cycle content types

- Severity: P2; hidden controls receive Tab focus, individual include/exclude filters have no keyboard operation or announced state, and selected-result shortcuts can consume Enter intended for a filter button.
- Reproduction: Search at 960×640, dark theme; close Toggle filters, focus Sort results, then Tab. Native focus lands on Select All inside `aside.filter-sidebar.collapsed`. Expanded content-type rows are click-only divs. A mounted integration regression additionally reproduces Enter expanding a previously highlighted result while a filter button has focus.
- Expected: collapsed filters are absent from focus/accessibility navigation; each content type can cycle off/include/exclude with its current state and instructions announced. Closing a panel containing focus returns to its toggle.
- Before: `.playwright-cli/search-hidden-focus-before-M.png` and `real-search.yml`; native DOM/focus inspection is decisive because a capture during the collapse transition may still show the outgoing panel.
- Solution: [`SearchFilterSidebar.vue`](../../../apps/desktop/src/components/search/SearchFilterSidebar.vue) applies inert/aria-hidden, uses styled native cycle buttons with state/instructions and labels repository/tool selects. The hero toggle exposes expanded state and controls linkage; focus returns before hiding. The Search keyboard controller preserves native button/link keys despite stale highlighted-result state.
- Verification: thirty-five targeted Search tests pass; [`SearchFilterAccessibility.test.ts`](../../../apps/desktop/src/__tests__/components/search/SearchFilterAccessibility.test.ts) covers collapse/reopen, focus ownership, the tri-state data changes and the Enter conflict. Desktop typecheck and Biome pass.
- Native after: Sort → Tab skips the collapsed inert aside and reaches a visible preset. `search-hidden-focus-after-M.png` was captured and inspected during the collapse transition; the focus/DOM assertion proves exclusion, but that image does not prove settled geometry. Enter/Space tri-state cycles, populated-result integration and a stable matching visual pair remain pending.

## UX-017 — Analytics custom dates overflow the minimum desktop width

- Severity: P2; Custom adds two date fields to a nonwrapping preset row, placing controls beyond the available content width.
- Reproduction: expanded sidebar, 960×640, dark theme; Analytics → Custom. The shared control is also used by Tools, Code and Models.
- Expected: all six presets and both date fields remain visible/reachable, wrapping according to available width.
- Root cause: `TimeRangeFilter` combines a shrink-resistant unwrapped outer row, unwrapped preset group and two fixed-width date fields.
- Solution: [`TimeRangeFilter.vue`](../../../apps/desktop/src/components/TimeRangeFilter.vue) wraps the outer row and preset group and constrains their width to the available container while preserving the date-pair layout.
- Native after: `.playwright-cli/analytics-dates-after-M.png` inspected; all six presets and From/To fields are visible at M. The date fields show the selected values alongside the resulting native analytics data.
- Evidence limitation: the first `analytics-custom-before-M.png` / `analytics-custom-after-M.png` artifacts were overwritten or captured different states and are not a valid matching visual pair. The final after image supports the resulting layout; matching sanitized before/after publication evidence remains outstanding.
- Regression scope: existing [`TimeRangeFilter.test.ts`](../../../apps/desktop/src/components/__tests__/TimeRangeFilter.test.ts) checks preset order, not layout. Native M verifies the layout change; other shared consumers, D/L and date-order/error scenarios remain partial.

## UX-018 — Model matrix sorting and normalization state are unavailable to keyboard users

- Severity: P2; the seven Performance Matrix headings support pointer clicks only, expose no sort direction and cannot receive keyboard focus. Normalization's current state is conveyed only by styling in both tables.
- Reproduction: populated Models at 1440×960, dark theme; attempt to Tab to a sort heading. Native inspection finds all seven `th` elements at tab index -1 with no `aria-sort` or child control.
- Expected: named sort buttons support standard keyboard activation, keep focus after sorting and announce the selected direction; Raw/Per 10M Tokens/Share announce their current state consistently.
- Before: `.playwright-cli/models-table-before-D.png` (private, inspected) and `real-models.yml`.
- Solution: [`ModelLeaderboard.vue`](../../../apps/desktop/src/components/modelComparison/ModelLeaderboard.vue) renders native sort buttons in scoped column headings and applies `aria-sort` only to the selected column. Decorative arrows are hidden from accessible names; focus outlines remain inside the scroll boundary. Both model-table normalization groups expose `aria-pressed`; existing alignment and header hit area are preserved.
- Verification: twenty-one targeted model tests pass, including actual composable row-order changes, focus retention, changing sort direction/column and synchronized normalization states. [`ModelComparisonAccessibility.test.ts`](../../../apps/desktop/src/components/modelComparison/__tests__/ModelComparisonAccessibility.test.ts), typecheck and Biome pass. Native M Enter sorts descending and Space ascending, with visible focus and confined table scrolling; `models-keyboard-after-M.png` was inspected.
- Status: bounded native keyboard/scroll checks verified; remaining columns, normalization, chart/null/error and L checks remain partial. The original Worktree click-only sorting lead was separately reproduced and addressed by UX-024; it is no longer a current source-only lead.

## UX-019 — Session comparison invents percentages for zero baselines

- Severity: P2, misleading analysis. Native D/M comparison of a six-turn session with the historical 2,822-turn session showed 0 → 69 Files Modified as `↑ 6900%`; 0 → 100787 lines showed `↑ 10078700%`.
- Expected: explain zero-baseline growth without a percentage; normalized nonzero values must use their actual baseline. Observed root cause: `formatSessionDelta` divided by `max(abs(a), 1)` and switched small changes to unlabeled absolute units.
- Before: `compare-populated-D.png` / `compare-populated-M.png`, inspected, private. After: `compare-populated-after-D.png`, inspected, same sessions/theme/viewport; shows `From 0`. A later adjustment retains existing whole-percent rounding for large changes; final matching recapture pending.
- Solution: actual nonzero denominator, `From 0` for zero, consistent percent units. Session normalization buttons now announce their pressed state. Native Enter selected Per Turn; 20 delta tests pass, including zero and fractional baselines. Independent review found no additional calculation defect.

## UX-020 — Export session selection is pointer-only

- Severity: P2. Native Export D, search for a title shared by two existing sessions, ArrowDown then Enter leaves Export disabled; clicking a result enables it. Expected a keyboard-operable searchable picker with identifiable duplicate titles.
- Before: `export-picker-before-D.png`, inspected/private; root cause is click-only div results and mouseleave dismissal in `ExportSessionPicker.vue`.
- Solution: input-owned combobox focus, stable option IDs, Up/Down/Enter/Escape, Tab/focusout/outside dismissal and confined option scrolling. Removed selected-text overlay and accidental mouseleave closure. Duplicate names retain repository metadata and distinct session IDs.
- Native after: same query, ArrowDown/Enter enables Export and loads a Rust-generated preview. Seven combined export/import accessibility regressions failed before; 21 targeted tests passed after. Final matching screenshot and remaining pointer/empty-result checks pending.

## UX-021 — Import's only action is not keyboard accessible

- Severity: P2. At M, Import shows a click-only div advertising file drop. Native snapshot has no focusable chooser; source has no drag/drop handler. Expected a named, reachable action describing supported behavior.
- Before: `import-before-M.png`, inspected. Solution: native `Choose a .tpx.json file` button with matching panel styling and focus outline; removed unsupported drop claim. File dialog and Rust import contracts unchanged.
- Component tests verify native semantics and browse invocation. Native M focus on the named chooser and `import-after-M.png` were inspected. The original chooser check did not open/complete the OS dialog. A later native D attempt to load a freshly exported synthetic JSON archive reaches Rust validation but fails its own hash check (UX-041). Successful OS-dialog interaction and persisted import remain unverified. The user deferred deeper Import journeys; UX-041 now passes native original-archive validation/preview after correction, with Import canceled unchanged.

## UX-022 — Export preview presents stale content under new settings

- Severity: P2. Native M/D switching JSON → Markdown → Raw Zip showed old JSON/Markdown with the new format badge and an active Copy control. Expected immediate pending feedback and no obsolete copyable content.
- Before: `export-rendered-D.png` and `export-zip-M.png`, inspected/private. Root cause: the 400ms debounce started before invalidating the previous request/content, allowing an older IPC response to finish in the gap.
- Solution: synchronously invalidate/clear on every input change, show pending feedback during debounce, cancel pending work on Raw Zip and explain its unavailable preview. Nineteen composable tests pass, including a response arriving during the next input's debounce and redaction/format changes.
- Independent review found a related visual mode mismatch after Rendered → JSON/Zip. Native classes reproduced `Rendered active disabled` while Raw was effective; effective mode now drives both styling and pressed state, with a component regression. Native after Raw mode and Zip explanatory text/no Copy were checked (`export-mode-after-M.png`, `export-zip-after-M.png`). Final evidence for mode labels still needs explicit matching header scroll alignment; the first M capture did not show those buttons. Remaining preview options, save output and request-race scenarios are separate checks.

## UX-023 — Command Centre offers an unavailable action as enabled

- Severity: P2. Native clicking Open Mission Control does nothing; snapshot presents an enabled button. Source action has `disabled: true`, but the div/role button never exposes it and supports Enter only.
- Before: `command-centre-D.png`, inspected/private. Solution: native buttons, actual disabled state, and `coming soon` description for the unimplemented dashboard. Working actions gain standard Space activation. Independent source review passed; native M confirms Mission Control is disabled. `command-centre-after-M.png` caught loading/animation and is rejected as visual proof; settled after image and other quick-action journeys remain pending.

## UX-024 — Worktree names disappear at minimum desktop width

- Severity: P1 for this workflow. Native 960×640 expanded shell: fixed columns consume the right pane, branch width collapses to zero, and names vanish. Sort headers/repository/detail selectors are also pointer-only.
- Before: `worktrees-before-M.png` and D comparison, both inspected/private. Root cause: separate grids/scroll owners with fixed columns, no minimum branch width, and action buttons wider than their allotted column.
- Solution: one table scrollport, sticky aligned headers, minimum branch width, bounded repository sidebar and native sort/detail/repository buttons with separate action buttons. Repository Remove also becomes visible when its row contains keyboard focus. Twelve tests/typecheck pass.
- Native after: 11 populated rows at D/L have aligned, readable headers/columns in `worktrees-after-D.png` and `worktrees-after-L.png`, both root inspected. M repository Remove focus visibility was also checked. The matching M table geometry/sorting/detail checks are not established by those D/L images and remain to reconcile. No worktree/repository mutation was performed.
- Scope: user explicitly deprioritized Worktrees/Launcher after these issues were found. Complete the obvious fixes; deeper create/prune/lock/delete journeys are deferred, preserving real repositories.

## UX-025 — Launcher fields collapse and lose accessible labels

- Severity: P2. Native M screenshot `launcher-M.png` shows a repository-path field around 8px wide. `real-launcher.yml` / `launcher-advanced.yml` show unnamed selects/switches and fields named only by placeholders. D image inspected for comparison.
- Root cause: fixed two-column form inside a narrow split pane, nonwrapping path/Browse row, and disconnected visual labels.
- Solution: intrinsic form wrapping, wrapping repository controls, associated field labels, named switches, pressed reasoning state and expanded Advanced state. SearchableSelect gains only an optional input ID. Twenty launcher and seven selector tests pass.
- Native after: after a stable app restart, the M Repository textbox measures 232px and Branch, Model and the full Initial Prompt are visible in `launcher-fields-settled-after-M.png` (root inspected). Repository and Registered or recent repository controls expose their labels; expanded Advanced switches expose names and were inspected. `launcher-fields-after-M.png` accidentally captured loading and is rejected as evidence. No launch or worktree mutation was performed; remaining D/L/bounded interactions are separate.
- Deeper launch execution/template lifecycle deferred at user request. Existing nested template action buttons remain a source-only lead requiring separate interaction validation; no existing templates were deleted or reordered.

## UX-026 — Settings path, sizing and log controls lack names

- Severity: P2 accessibility. Native `real-settings.yml` exposes two unnamed path textboxes, unnamed Content width input, symbol-only adjustment buttons and unnamed Log level selector. Expected labels to identify and focus their fields.
- Solution: associated labels/IDs and specific Browse/adjust/reset names in Data & Storage, Appearance and Logging. Native after checks confirm path/Browse, content-width adjustment/reset and log-control accessible names. `settings-paths-after-M.png` was inspected: labels, Browse controls and field widths are usable at M. No data paths or logging preferences changed; native persistence and the remaining Settings regression checks are separate pending work.

## UX-027 — Shared Clear search button renders at zero size

- Severity: P2. Settings pricing search `audit-model-no-match` returns guidance, but Clear search cannot be clicked. Native measurement: width 0px, height 0px despite display:flex; `settings-clear-search-before-M.png` inspected/private.
- Root cause: SearchInput's clear control and icon depend on utility classes unavailable in the running desktop stylesheet.
- Solution: component-scoped 28×28px clear control, explicit 14px icon, themed hover/focus states and 40px input right padding while populated. Clearing emits once and restores input focus without moving the page. SettingsPricing and SessionListView share the component.
- Verification: five shared SearchInput tests, UI typecheck, Biome and diff checks pass. Native Settings M Clear now measures 28×28px; clicking it empties the query, restores the rate list and focuses the input. `settings-clear-search-after-M.png` was inspected against the matching before state. Sessions clear, keyboard activation and remaining D/L/theme/scale variants still require native checks.

## UX-028 — Enter on palette Clear does not clear the query

- Severity: P2 keyboard usability. With query `hello` in the command palette at 960×640, focus Clear search and press Enter. Native inspection confirmed the Clear button had focus, but the query remained `hello`.
- Expected: Enter activates the focused button, empties the query and returns focus to the search input; result navigation must not intercept the button's activation.
- Before: `palette-clear-enter-before-M.png` (root inspected, private) plus the focus/query assertion above. Root cause: the palette-level keydown handler intercepts Enter from every descendant and treats it as result activation.
- Solution: result navigation handles keys from the input only, while the palette's Tab cycle remains available to all controls. A dedicated clear handler empties the query and restores input focus without scrolling.
- Verification: native Enter on focused Clear now leaves an empty query with the input focused; matching `palette-clear-enter-after-M.png` was inspected. Component regressions cover native control activation and input result navigation. Remaining palette results, Escape/return, D/L and typing races are separate workflows.

## UX-029 — Palette offers disabled destinations and omits available views

- Severity: P2 navigation. With Replay disabled in preferences, the palette still offers Go to Replay; Enter closes the palette and routes to Sessions. Code, Models, Compare and Skills are absent from its static navigation list.
- Expected: palette destinations follow the app's available navigation and feature gates, so an offered action opens the named view and available destinations remain discoverable.
- Before: `palette-gated-replay-before-M.png` was root inspected at 960×640, but captured during a transition. The disabled preference, offered action and resulting Sessions route establish the interaction defect; this image is not settled-layout proof.
- Root cause: `useSearchPaletteController.ts` owns a separate static `NAV_ACTIONS` list that does not reflect the sidebar/route feature-gating contract.
- Solution: palette destinations now follow the navigation availability contract instead of the separate static list; implementation was completed by the independently assigned owner.
- Native after: with Replay disabled, the palette exposes zero Replay actions. Ctrl+K → Skills → Enter reaches `#/skills` with the Skills heading visible. `palette-gated-replay-after-M.png` was captured but is awaiting root image inspection; only the interaction/route result is verified at this checkpoint. Code/Models/Compare, enabling Replay, preference changes while open and final independent review remain pending.

## UX-030 — Space cannot open a focused Skills card

- Severity: P2 keyboard usability. At 960×640, focus the first Built-in skill card and press Space: the route remains `#/skills`. Enter on the same card opens its read-only editor.
- Expected: a card exposed as a button supports standard Enter and Space activation, with its separate enable/delete/tooltip controls retaining their own focus and activation.
- Before: `skills-card-space-before-M.png` was root inspected with visible focus. `skills-readonly-M.png` was also inspected after Enter: Name, Description and Instructions have `readOnly=true`, toolbar editing controls are disabled, and Save/Delete are absent. The read-only behavior worked; the defect is card activation.
- Root cause: `SkillCard.vue` used a focusable div with `role="button"`, click and `keydown.enter` handlers, but no Space behavior; child actions lived within the same role-button container.
- Solution: a native Open skill button is separate from sibling actions and preserves the full card hit area. Native Space now opens the read-only editor; the focused footer action is visible with opacity 1. `skills-card-keyboard-after-M.png` was root inspected. Other action/tooltip isolation, card variants and D/L remain separate checks.

## UX-031 — Long JSON values squeeze their property names into vertical letters

- Severity: P2 readability. In CLI Context, open the existing saved snapshot (56.5KB, 19 tools), choose Raw, and view the parsed tree at 960×640. Its approximately 27,000-character `instructions` string reduces the adjacent key to 6.609px wide and 234px high, wrapping the name into individual letters.
- Expected: property names remain recognizable beside large scalar values; both the key and value remain readable without causing page overflow.
- Before: native geometry and source inspection establish the layout defect. `json-long-scalar-before-M.png` was root inspected and confirms the key wraps into single letters. The snapshot and screenshots contain private data and will not be published without review.
- Root cause: shared `packages/ui/src/components/file-viewers/JsonTreeNode.vue` places key and scalar in one flex row with default shrinking and `overflow-wrap:anywhere`; the long scalar's base size can consume nearly all width and force the key to its smallest breakable width.
- Verification: three real-Chromium geometry regressions reproduce the 6.609px key before the shared fix and pass after it. Native Explorer JSON after images at D/M/L were inspected (`explorer-json-after-D.png`, `explorer-json-after-M.png`, `explorer-json-after-L.png`); the M property key is below the viewport, so that image does not prove its readability. These representative-consumer checks do not replace the still-pending matching after check of the original CLI snapshot. Explorer JSONL/CSV filtering and other formats now have separate native evidence in the coverage matrix. Capture execution and remaining nested/long-key variants remain unverified.

## UX-032 — An invalid content width collapses Settings to one pixel

- Severity: P1 usability/recovery. In the isolated profile at 960×640, Settings → Appearance → Content width, replace the value with `1`. The entire Settings content immediately collapses to a 1px width, making its own controls unusable.
- Expected: invalid/in-progress numeric input must not be applied to the live page layout or persisted as a valid preference; users need visible validation and a reliable way to recover.
- Before: `settings-width-invalid-before-M.png` was root inspected. The live owner restored 1600 in the isolated profile only; existing user preferences were not changed for this test.
- Root cause: the number input binds directly to `preferences.contentMaxWidth`, which drives the live layout. Its `min="400"` attribute affects native validity but does not prevent v-model from writing `1`; the +/- handlers' clamp does not protect direct typing.
- Solution: `SettingsAppearance.vue` keeps a local numeric draft and commits valid whole-number widths on blur/Enter; Escape restores the saved value. Shared preference normalization protects the live CSS and persisted backend range from direct invalid writes.
- Native after: entering `1` then Tab restores input 1600 and CSS `1600px`, with the whole-number/minimum-400 validation and previous-value-restored explanation. `settings-width-invalid-after-M.png` was root inspected. Feature flags and scroll position differ from before, so the images prove each recorded state but are not a matching visual pair. Further empty/boundary/custom-width and persistence checks remain separate.
- Regression checks: the assigned owner reports 56 focused Settings/preference tests passed, including draft typing without layout/persistence changes, invalid recovery, Enter/Escape, the Full preset and runtime normalization. Independent numeric-fix review is in progress.

## UX-033 — Invalid negative model rates are saved despite failed field validity

- Severity: P2 data correctness. In isolated Settings → AIC pricing, create disposable model `audit-invalid-price` with Input `-1`. Native `checkValidity()` returns false, but Add rate remains enabled and saving writes `inputPerM = -1.0` to the profile TOML.
- Expected: only finite, nonnegative token rates are accepted, with understandable validation; an invalid field cannot create a saved pricing override or affect estimates.
- Before: `pricing-invalid-before-M.png` was root inspected. The live owner verified the disposable model's persisted negative value, then deleted only that disposable entry. Existing model rates were not edited/deleted for this check.
- Root cause: `SettingsPricing.vue` gives numeric inputs `min="0"`, but Add rate checks only a nonempty model ID; its handler forwards the numeric form values without validating rate bounds. The click action bypasses native form submission validation.
- Solution: shared finite/nonnegative rate parsing guards both add and edit mutations. New invalid rates disable Add with an explanation; existing-rate edits remain local drafts until a valid blur/Enter commit, with Escape restoring the saved rate.
- Native after: a negative rate leaves Add disabled, while a disposable valid rate of 1.25 saves to the isolated TOML. `pricing-invalid-after-M.png` and the recorded pricing after images were root inspected. Editing that existing rate to -2 then Tab leaves an invalid local draft while TOML remains 1.25; Escape restores 1.25. In the isolated profile, a default input rate changed from 5 to 99 returns to 5 on Reset defaults; disposable custom rates were removed. Other rate fields/bounds, reflected estimates and D/L remain separate checks. Existing user pricing was preserved.
- Regression checks: the assigned owner's 56 focused Settings/preference tests include invalid add/edit values, no invalid autosave, zero/small decimal rates, Escape restoration and valid persistence. Independent review is in progress; the full-suite checkpoint predates these changes.

## UX-034 — Search rebuild reports an impossible session total

- Severity: P2 feedback correctness. In isolated Settings at 960×640, rebuild the 74-session search fixture. The completed operation reports `Indexed 74 of 0 sessions`, making a successful rebuild look inconsistent or incomplete.
- Expected: report the number indexed and, where applicable, the number already up to date. The second backend count is skipped sessions, not a total.
- Before/after: `settings-search-rebuild-before-M.png` and `settings-search-rebuild-after-M.png` were both root inspected. The result changes to `Indexed 74 sessions`; the toast is mid-animation in the captures, but the relevant result text is clear. Existing user search data was not rebuilt for this check.
- Root cause: Rust's `index_search_content` returns `(indexed_count, skipped_count)`, passed through the Tauri binding. The client comment and `SettingsDataStorage.vue` mislabeled the second value as total.
- Solution: clarify the named client tuple in `packages/client/src/maint.ts` and render indexed sessions with an optional `already up to date` suffix in `SettingsDataStorage.vue`.
- Verification: three regression cases failed before and the original four [`SettingsDataStorage.test.ts`](../../../apps/desktop/src/__tests__/components/SettingsDataStorage.test.ts) cases passed after, covering ordinary, skipped/singular and empty counts plus path-draft behavior. That suite subsequently expanded to 18 passing cases for UX-036, including confirmation focus recovery. Native M before/after result is verified; UX-036 records save/maintenance exclusion and confirmation cancellation. Failure, running-job cancellation and large-corpus maintenance remain separate.

## Independent review checkpoint

- A read-only review of the uncommitted product changes found no additional actionable regression in the Export picker/preview, Todo graph focus transitions, Explorer resize, shared controls, labels, normalization, Worktree focus visibility or palette Clear handling. This is a source review, not additional native verification or a completed review of future edits.
- The review identified stale findings/matrix claims and historical source leads still written as current defects. These records have been reconciled with the bounded native observations. All 124 source IDs have one coverage row, without missing, extra or duplicate IDs. Later Settings/Skills changes retain separate review and final-check requirements; earlier review passes do not cover them automatically. Read-only UX-038 review identified permission preservation and partial-I/O recovery gaps in the first exclusive-create implementation; the staging follow-up now passes 26 Windows Rust tests, Clippy and formatting, with its final native D staging-backend duplicate/preservation/Open/Escape repeat passed. The UX-036 review also caught trigger focus lost when confirmation locking disabled the trigger; real mounted confirmation regressions and native Reset Cancel/Escape checks now cover the correction.
- [Validation and commit checkpoint](validation.md) records the completed repository-wide test/build/typecheck snapshot, scoped checks, initial retry and baseline limitations. Later changes retain their own targeted/native verification requirements.

## UX-035 — Onboarding progress controls bypass folder validation

- Severity: P1 for setup. In the disposable native M profile, reset → Step 3 → nonexistent Copilot home → blur. Continue correctly disables, but Step 5 still opens Ready and Launch saves that invalid folder. Settings confirms the invalid persisted home; indexing then finds zero sessions.
- Before: `setup-navigation-bypass-before-M.png` / `setup-bypass-saved-M.png` in the private capture directory; root inspected the Ready state and independently read back the saved path. The fixture profile was recovered to its original valid home and 74 sessions rebuilt. Existing user settings were never reset.
- Root cause: progress dots and keyboard navigation call a separate unchecked navigation path; final save trusts prior UI state without validating the selected folder.
- Solution: shared navigation eligibility, current-path validation at Launch, busy locking and duplicate/late-response guards. Skip deliberately saves startup defaults and completes setup, including installations with no sessions yet. It never saves an invalid edited draft.
- Checks: 18 wizard/navigation regressions, desktop typecheck and file-size policy pass. Native M after: an invalid Copilot home disables Continue and Step 4/5, and ArrowRight on the heading stays at Step 3. Skip then completes using the valid startup home, independently confirmed in Settings. `setup-bypass-blocked-after-M.png` was root inspected. Commit `278d7ea7` includes this fix. No-CLI/missing default-home handling, forced save failures and delayed-response races have component coverage but remain unverified natively.

## UX-036 — Data maintenance can race a path save

- Severity: P2. In native M Settings, Apply a corrected disposable Copilot home and immediately select analytics Rebuild. Before the fix, Rebuild is enabled while the path save is pending and indexes the former invalid directory, reporting zero sessions despite the correct visible field. Waiting for save then repeating rebuild finds 74.
- Before: `settings-path-maintenance-race-before-M.png`, root-inspected result; task-owned path only. Expected maintenance to use the saved configuration and make the busy state clear.
- Root cause: each operation owns an independent busy flag; saving also reads live draft fields across multiple awaits.
- Solution: a shared busy guard covers path browsing/saving, indexing, rebuilds, confirmations, snapshot deletion and reset. Disable competing controls; handlers reject duplicate requests. Validate and persist one immutable path snapshot.
- Checks: 18 DataStorage tests pass, including UX-034 results, delayed saves, competing maintenance, validation failures and cancellation. Independent review found that disabling the trigger before confirmation focus capture caused Escape to return to BODY. The confirmation helper now captures the trigger before locking, unlocks before restoring it and avoids taking focus from another modal. Real mounted Reset/Delete confirmation tests cover Cancel/Escape, plus another-modal focus preservation; four return-focus cases failed before the correction. Native M after: Apply a slash-format correction to the valid disposable home; both Rebuild buttons disable during save. After `Path settings saved`, analytics rebuild reports 74 sessions. `settings-path-maintenance-after-M.png` was root inspected. Reset confirmation Cancel and Escape both restore trigger focus after the confirmation-review fix. Delete captures is disabled with zero snapshots, so deletion/persistence remains untested. Commit `278d7ea7` includes the fix; forced I/O errors and cancellation of running maintenance remain separate.

## UX-037 — Skill assets cannot be opened by keyboard and New File loses focus

- Severity: P2 accessibility. In native M `audit-imported`, Tab from the expanded references folder skips `checklist.md` and reaches an unnamed Remove button. File opener is a click-only span (`tabIndex=-1`); Remove is invisible except on hover. New File → Escape returns focus to BODY.
- Before: `skill-asset-keyboard-before-M.png`, root inspected. Expected named, visible keyboard controls and focus returning to New File on cancellation.
- Solution: separate native Open/Remove buttons with full asset-path names, focused-row Remove visibility and themed focus outlines. Name the new-file input and restore its trigger on Enter/Escape, while blur cancellation preserves the next control's focus. Removed the obsolete delayed blur timer.
- Checks: six focused tests pass, including composition-event suppression; physical IME input remains untested. Native M after: Tab reaches the named file Open action; Enter opens the actual 53-byte checklist text; Escape restores Open focus; Tab to Remove shows opacity 1. `skill-asset-keyboard-after-M.png` and `skill-asset-preview-after-M.png` were root inspected. Earlier preview attempts were invalidated by Settings HMR and are not evidence; the final rerun waited for actual text before capture. New File duplicate Enter returns focus to its trigger under UX-038. Native New File Escape/blur and remaining file variants remain separate checks.

## UX-038 — Creating an existing skill asset silently destroys its contents

- Severity: P1 data loss. In native M disposable `audit-imported`, New File → `references/checklist.md` → Enter silently changes the existing 53-byte asset to zero bytes. No conflict warning appears. Disk length independently confirmed zero; root restored the fixture from its task-owned backup immediately.
- Before: `skill-asset-duplicate-before-M.png` and `skill-asset-duplicate-result-before-M.png`, both root inspected. Expected the existing asset to remain intact with an actionable name-conflict error.
- Root cause: Rust `add_asset` uses truncating `fs::write`; `copy_asset_from` similarly replaces destinations with `fs::copy`. No supported editing consumer requires replacement.
- Solution: add and copy validate source/parent paths, write into an owned temporary sibling and publish only complete content with `persist_noclobber`. Existing files remain intact and receive an actionable already-exists error, announced by the editor via `role=alert`. Independent review of the first exclusive-create implementation found lost imported permissions and partial destinations blocking retry. The staging revision retains source permissions, cleans failed temporary writes automatically and preserves the existing file on a publication race. Canonical parent checks reject escapes through existing symlink parents.
- Checks: four initial Rust regressions fail against the former behavior. The first exclusive-create revision passed native M: duplicate `references/checklist.md` shows the already-exists alert, returns New File trigger focus and leaves the original disk content at 53 bytes. `skill-asset-duplicate-result-after-M.png` was root inspected alongside the recorded before images. That result predates the temporary-file follow-up. The revised implementation passes 26 Windows Rust tests, package Clippy with warnings denied, formatting and diff checks. Tests cover injected reader/writer failures after partial staging, cleanup/retry, concurrent/existing destinations and imported read-only permission preservation. Unix executable-mode and symlink tests are present but were not executed on Windows. Final native D repeat passes on the staging backend: duplicate reports already exists, disk content remains 53 bytes with its Archive attribute preserved, named Open/Enter shows the actual text and Escape returns Open focus. `skill-duplicate-final-D.png` was root inspected; M was captured but its image remains uninspected. Native injected I/O failure and executable/read-only imports remain unverified.

## UX-039 — Long decimal averages overflow Analytics metric panels

- Severity: P2 readability. In the isolated populated Analytics view, fractional token averages render long decimal strings that overflow their metric cells and crowd adjacent labels. Native D before was inspected; M geometry also reproduced overflow.
- Before: `core-analytics-D.png` inspected; `analytics-metric-overflow-before-M.png` accompanies the M geometry record. Expected concise, consistent averages inside readable metric columns at supported desktop sizes.
- Root cause: the general number formatter preserves small fractional values, while a fixed three-column grid and intrinsic minimum widths prevent the metric panels from shrinking coherently.
- Solution: local average formatting rounds to one decimal, keeps large values compact and handles non-finite input. Available width determines the metric columns; panels/items can shrink and long values/labels wrap. Raw analytics data and exact session counts remain unchanged.
- Checks: 32 focused tests and three Chromium component layout tests pass. Native D/M/L metric grids measure 520/280/755px respectively, with scrollWidth equal to clientWidth at each size and no document overflow. Values read 3.9, 1.0, 896.2, 150.6 and 0.0. `core-analytics-after-D.png` and `analytics-metrics-after-M.png` were root inspected; the remaining D/L metric images were subsequently inspected and passed. Remaining dashboard charts, filter combinations, themes and scale settings retain separate coverage.

- Public matching pair: [Before at D](evidence/core-analytics-D.png) / [After at D](evidence/core-analytics-after-D.png), inspected fixture-only copies with the same 73-session corpus, dark theme, 100% scale and sidebar state.

## UX-040 — Code Impact labels confuse unique paths with repeated modifications

- Severity: P2 misleading analysis. Native Code Impact with the isolated all-time corpus shows Files Modified = 1, a type row labeled ts = 70 files and a most-modified path appearing in 70 sessions. The inconsistent units make the same dataset appear contradictory.
- Before: `core-code-D.png` root inspected; the route was also captured at M/L, with those before images awaiting inspection. Expected each aggregate to explain whether it counts unique paths or repeated session modifications.
- Root cause: the backend intentionally counts distinct paths for the headline and occurrences across session file lists for the type breakdown, while the view calls both files. Matching paths across repositories also share the distinct-path count.
- Solution: headline Unique File Paths, section File Modifications by Type and per-row modification units; Most Modified File Paths preserves the sessions unit. A nearby explanation states that matching paths count once and a file is counted again in each session reporting it. Backend calculations and API remain unchanged; per-session file labels elsewhere retain their existing meaning.
- Checks: two new regressions failed before and pass after, including one path shared by 70 sessions and singular modification wording; 13 targeted Code Impact tests, desktop typecheck, Biome and diff checks pass. Native D/M/L now show Unique File Paths 1, 70 modifications and 70 sessions with no overflow. `core-code-after-M.png` was root inspected; D/L after images were subsequently inspected and passed. Remaining timeline/churn/tooltips, filters, empty/error states and cross-page context remain partial.

- Public matching pair: [Before at D](evidence/core-code-D.png) / [After at D](evidence/core-code-after-D.png), inspected fixture-only copies with the same 73-session corpus, dark theme, 100% scale and sidebar state.

## UX-041 — Import rejects a freshly exported synthetic JSON archive

- Severity: P1 for the data portability workflow. Native D Export produces a synthetic JSON archive, but loading that same archive into Import fails with a hash-mismatch error. This blocks a round trip before the import review can proceed; no existing session was replaced or deleted.
- Before: `import-hash-mismatch-before-D.png` root inspected, plus native export/load/error interaction evidence. Expected an unchanged archive produced by the app to pass its own integrity validation.
- Root cause: the importer hashes a freshly deserialized/re-serialized sessions value. Randomized map iteration can change property order from the original exported payload, rejecting unchanged archives. Solution: retain the original sessions JSON and normalize insignificant whitespace into the existing pretty hash layout while preserving key order, escaped strings and number spelling. The original hash scheme and tamper check remain in place.
- Verification: 165 export Rust tests, Clippy and independent review pass. Native D loads the original 49,823-byte artifact and now shows Archive is valid with the Rust preview; `import-hash-after-D.png` was root inspected. The picker gateway substituted one result, forwarded six native calls and restored itself; this verifies the backend validation journey, not an actual OS dialog. Import was canceled without changes. Deeper conflict/progress/cancellation/partial-error/persisted-import journeys remain user-deferred. The existing import writer does not reconstruct custom tables; that known limitation is explicitly deferred and is not claimed fixed by the integrity correction.

## UX-042 — Reversed custom dates replace analysis with a backend error

- Severity: P2 recovery and clarity. In native Code at M, choose Custom, set From to 2026-09-12 and To to 2026-08-01. The reversed interval is submitted and the view shows a full backend error instead of an explanation beside the date controls.
- Before: `date-reversed-before-M.png` root inspected. Expected clear date-order validation that preserves the current useful view and lets the user correct the fields.
- Root cause: blur commits independently valid date values without checking the pair's order or the native min/max constraint; incomplete native date input can also appear empty and be mistaken for clearing. Nine of eleven regression cases fail before, including the actual analytics-page watcher.
- Solution: uncontrolled native date drafts remain local until both dates satisfy calendar validity, 2000–2099 bounds and ordering. Incomplete native input is distinct from clearing. Linked inline alert/aria-invalid explains correction and preserves the last valid chart range; either bound, open ends, presets and store/remount context recover without invalid or duplicate fetches. Analytics, Tools, Code and Models share this control; native before is Code only.
- Checks: 12 component regressions pass, including the real analytics-page fetch watcher; 45 tests pass with neighboring analytics/page tests. Desktop typecheck, Biome, diff check and independent read-only review pass. The neighboring render-budget warning under concurrent typecheck is informational. Native M same reversed pair now shows an inline alert/two aria-invalid fields and retains the prior zero-value cards; matching `date-reversed-after-M.png` is root inspected. Correcting From to 2026-08-01 then To to 2026-09-12 yields Analytics 73 sessions. Selecting audit/demo and opening Tools preserves both dates/repository and shows 52 calls/4 tools/100%/1.3s. All repositories/All Time were restored. Independent subsequent Code/filter review also passed 31 focused tests. Physical segmented badInput remains untested.

## UX-043 — Replay handles navigation keys twice and starts from other controls

- Severity: P2 keyboard control. In native Replay at D, focusing the progress slider and pressing ArrowRight moves the position from 0 to 2. Focusing speed 2× and pressing Space leaves its pressed state false and starts playback instead.
- Before: `replay-keyboard-before-D.png` root inspected; the minimum-size Replay image was also inspected. Expected one slider step per key and standard Space activation of the focused speed button without changing playback.
- Root cause: the slider handler and window shortcut handler both consume the same bubbled key; the window handler also intercepts native button Space activation. Home/End previously fabricated mouse coordinates for seek.
- Solution: the slider owns and consumes its navigation keys and emits explicit step targets; window shortcuts respect handled/composing/modified/repeated keys, interactive controls and open modals. Native speed and Play/Pause buttons retain their activation behavior.
- Checks: 52 tests pass, including 13 new cases (9 fail before). Native after: Right 0→1, End→4 and Home→0; 2× Space sets pressed true while paused; Play Enter advances 1→2 and Pause Space stops. D/M/L have no document overflow. `replay-keyboard-after-M.png` and `replay-keyboard-after-L.png` are inspected; the D image captured a rapid-seek scroll transition, so only its transport assertions are accepted pending settled recapture. Deeper Replay exploration is user-deferred, including picker/content modes, persistence, stop-on-navigation and error states.

## UX-044 — New Skill hides creation failures behind its dialog

- Severity: P2 recovery and accessibility. Native M New Skill → duplicate audit-imported → Create leaves the dialog open without an inline alert; the store error appears behind the modal. Name and Description labels are also not programmatically associated with their inputs.
- Before: `skill-create-error-before-M.png` and settled `skill-create-labels-before-M.png`, root inspected. Expected an announced error in the active form, retained drafts and named fields so the user can correct and retry.
- Root cause: the create action only updates the shared page error; the modal has no local failure state. Labels lack for/id associations.
- Solution: transfer a failed create result to a dialog-local alert and clear the covered page error, retain both drafts, reset stale errors when reopening/retrying, and associate Name/Description labels plus the close button name. Successful creation retains the existing editor navigation.
- Checks: three meaningful component tests and independent read-only review pass. Native M duplicate creation now displays the inline alert; `skill-create-error-after-M.png` is inspected. Correcting the name to audit-create-recovery and keeping the description creates a 100-byte SKILL.md; native editor fields and disk persistence match. Other validation, cancellation/busy races and D/L remain separate.

## Execution limitations (not product defects)

- Sandboxed Vite/esbuild child process spawn failed (`EPERM`); documented launcher succeeds with process permissions.
- Disposable USERPROFILE alone failed Tauri log initialization (“unknown path”). Task-local existing AppData/Local and AppData/Roaming plus child-process APPDATA/LOCALAPPDATA resolve this. Real Rust IPC and all saved config paths then confirmed isolation.
- Native OS dialogs and physical monitor DPI controls are not exposed by WebView2 CDP. Record invocation/available outcomes separately from successful OS interaction.
- Automatic approval review initially rejected bulk optional-feature enabling because of possible existing-profile effects. The live owner verified the complete task-owner manifest and isolated configuration paths; an exact live-home guard and explicit scoped justification were then approved. Exact Capture, Replay, Config Injector, MCP and alerts were enabled only in that disposable profile. No SDK connection/provider request occurred; OS notifications/taskbar flash were disabled before the in-app alert test.
- The native dialog gateway helper has 14 passing Node tests, but substitutes picker results only. A later native synthetic export/load attempt first failed UX-041, then passed native original-archive validation/preview after correction; no successful import round trip or actual OS-dialog operation is claimed. Check Now's clicked result also awaits resnapshot after a Rust watcher restart; no successful update result is inferred.
- A development HMR injection mismatch interrupted the first Launcher after revisit. Stop/start resolved it; the live owner verified Rust connectivity and reported zero errors since restarting. Later settled Launcher checks are recorded in UX-025; the failed/loading captures remain excluded.
