// ─── Generated ↔ hand-written DTO drift detection ────────────────────
//
// This suite is a *compile-time* contract between the Rust-generated
// `bindings.ts` and the hand-maintained mirrors in `@tracepilot/types`.
// It contains no runtime assertions — the point is that if either side
// drifts from the shared wire format, `tsc` will fail to type-check the
// assignability assertions below and the test run will fail at build
// time.
//
// Extended in wave 21 to cover the session-listing batch:
//   - `SessionListItem`
//   - `FreshnessResponse`
//
// Add to this file whenever a new DTO graduates to specta-derived
// generation. See `docs/specta-migration-guide.md`.

import type {
  FreshnessResponse as HandFreshnessResponse,
  SessionListItem as HandSessionListItem,
} from "@tracepilot/types";
import { describe, it } from "vitest";

import type {
  FreshnessResponse as GenFreshnessResponse,
  SessionListItem as GenSessionListItem,
} from "../generated/bindings.js";

describe("generated bindings match hand-written mirrors (wave 21)", () => {
  it("has structurally compatible shapes (compile-time only)", () => {
    // 1. A value produced by a generated command satisfies the
    //    hand-written interface (the hand-written type is the current
    //    consumer contract, so this is the direction that matters at
    //    runtime today).
    const _freshness: HandFreshnessResponse = {} as GenFreshnessResponse;

    // 2. Same shape for the session-list payload.
    const _session: HandSessionListItem = {} as GenSessionListItem;

    // 3. Array form — `list_sessions` returns `SessionListItem[]`, so
    //    verify the element-wise assignability holds when wrapped in an
    //    array.
    const _sessionArray: HandSessionListItem[] = [] as GenSessionListItem[];

    void _freshness;
    void _session;
    void _sessionArray;
  });
});
