#!/usr/bin/env python3
"""Validate Copilot CLI session event files against version-specific schemas.

Scans session directories for events.jsonl files, detects the copilotVersion,
and checks that field presence matches version expectations. Produces a report
with sessions by version, field coverage matrix, and anomalies.

Usage:
    python scripts/validate-session-versions.py [--session-dir PATH]
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any

# ---------------------------------------------------------------------------
# Version expectations: field → minimum version that introduced it
# ---------------------------------------------------------------------------

VERSION_FIELD_MAP: dict[str, str] = {
    "shutdown.currentTokens": "1.0.8",
    "shutdown.systemTokens": "1.0.8",
    "shutdown.conversationTokens": "1.0.8",
    "shutdown.toolDefinitionsTokens": "1.0.8",
    "shutdown.modelMetrics.*.usage.reasoningTokens": "1.0.24",
    "subagent.completed.model": "1.0.11",
    "subagent.completed.totalTokens": "1.0.11",
    "subagent.completed.totalToolCalls": "1.0.11",
    "subagent.completed.durationMs": "1.0.11",
}

# Known event types — anything else is flagged as unknown.
KNOWN_EVENT_TYPES: set[str] = {
    "session.start",
    "session.shutdown",
    "session.compaction_start",
    "session.compaction_complete",
    "session.plan_changed",
    "session.model_change",
    "session.info",
    "session.context_changed",
    "session.error",
    "session.resume",
    "session.workspace_file_changed",
    "session.truncation",
    "session.warning",
    "session.mode_changed",
    "session.task_complete",
    "session.handoff",
    "session.import_legacy",
    "session.remote_steerable_changed",
    "user.message",
    "assistant.message",
    "assistant.turn_start",
    "assistant.turn_end",
    "assistant.reasoning",
    "tool.execution_start",
    "tool.execution_complete",
    "tool.user_requested",
    "subagent.started",
    "subagent.completed",
    "subagent.failed",
    "subagent.selected",
    "subagent.deselected",
    "system.notification",
    "system.message",
    "skill.invoked",
    "abort",
    "hook.start",
    "hook.end",
}


def parse_version(v: str) -> tuple[int, ...]:
    """Parse a semver-like string to a comparable tuple."""
    parts: list[int] = []
    for seg in v.split("."):
        # Strip any pre-release suffix (e.g. "2-beta" → 2)
        num = ""
        for ch in seg:
            if ch.isdigit():
                num += ch
            else:
                break
        parts.append(int(num) if num else 0)
    return tuple(parts)


def version_gte(version: str, minimum: str) -> bool:
    """Return True if version >= minimum."""
    return parse_version(version) >= parse_version(minimum)


def get_nested(data: dict[str, Any], path: str) -> Any | None:
    """Navigate a dot-separated path, with '*' matching any key at that level."""
    parts = path.split(".")
    return _get_nested_impl(data, parts)


def _get_nested_impl(obj: Any, parts: list[str]) -> Any | None:
    if not parts:
        return obj
    if not isinstance(obj, dict):
        return None
    key = parts[0]
    rest = parts[1:]
    if key == "*":
        # Wildcard: return first match across all keys
        for v in obj.values():
            result = _get_nested_impl(v, rest)
            if result is not None:
                return result
        return None
    return _get_nested_impl(obj.get(key), rest)


# ---------------------------------------------------------------------------
# Session analysis
# ---------------------------------------------------------------------------

class SessionReport:
    """Analysis results for a single session."""

    def __init__(self, path: Path):
        self.path = path
        self.copilot_version: str | None = None
        self.event_count = 0
        self.unknown_event_types: dict[str, int] = defaultdict(int)
        self.field_presence: dict[str, bool] = {}
        self.anomalies: list[str] = []
        self.parse_errors: list[str] = []

    @property
    def session_id(self) -> str:
        return self.path.parent.name


def analyze_session(events_path: Path) -> SessionReport:
    """Analyze a single events.jsonl file."""
    report = SessionReport(events_path)

    shutdown_data: dict[str, Any] | None = None
    subagent_completed_data: list[dict[str, Any]] = []

    try:
        with open(events_path, "r", encoding="utf-8") as f:
            for line_no, line in enumerate(f, 1):
                line = line.strip()
                if not line:
                    continue
                try:
                    event = json.loads(line)
                except json.JSONDecodeError as e:
                    report.parse_errors.append(f"line {line_no}: {e}")
                    continue

                report.event_count += 1
                event_type = event.get("type", "")
                data = event.get("data", {})

                # Extract copilot version from first session.start
                if event_type == "session.start" and report.copilot_version is None:
                    report.copilot_version = data.get("copilotVersion")

                # Track unknown event types
                if event_type not in KNOWN_EVENT_TYPES:
                    report.unknown_event_types[event_type] += 1

                # Collect shutdown data (use last one)
                if event_type == "session.shutdown":
                    shutdown_data = data

                # Collect subagent.completed events
                if event_type == "subagent.completed":
                    subagent_completed_data.append(data)

    except OSError as e:
        report.parse_errors.append(f"Cannot read file: {e}")
        return report

    # Check field presence against version expectations
    version = report.copilot_version
    if version and shutdown_data is not None:
        for field_path, min_ver in VERSION_FIELD_MAP.items():
            if field_path.startswith("shutdown."):
                json_path = field_path[len("shutdown."):]
                value = get_nested(shutdown_data, json_path)
                present = value is not None
                report.field_presence[field_path] = present

                expected = version_gte(version, min_ver)
                if expected and not present:
                    report.anomalies.append(
                        f"MISSING: {field_path} expected for v{version} (introduced in v{min_ver})"
                    )
                elif not expected and present:
                    report.anomalies.append(
                        f"UNEXPECTED: {field_path} present in v{version} (expected from v{min_ver}+)"
                    )

    if version and subagent_completed_data:
        for field_path, min_ver in VERSION_FIELD_MAP.items():
            if field_path.startswith("subagent.completed."):
                json_key = field_path.split(".")[-1]
                # Check if ANY subagent.completed has the field
                any_present = any(
                    d.get(json_key) is not None for d in subagent_completed_data
                )
                report.field_presence[field_path] = any_present

                expected = version_gte(version, min_ver)
                if expected and not any_present:
                    report.anomalies.append(
                        f"MISSING: {field_path} expected for v{version} (introduced in v{min_ver})"
                    )
                elif not expected and any_present:
                    report.anomalies.append(
                        f"UNEXPECTED: {field_path} present in v{version} (expected from v{min_ver}+)"
                    )

    return report


def find_sessions(session_dir: Path) -> list[Path]:
    """Find all events.jsonl files under a session directory.

    Supports two layouts:
      - Standard: ``<session-dir>/<session-id>/events.jsonl``
      - Flat:     ``<session-dir>/*.jsonl`` (for fixture directories)
    """
    results: list[Path] = []
    if not session_dir.is_dir():
        return results

    for child in sorted(session_dir.iterdir()):
        if child.is_dir():
            events_file = child / "events.jsonl"
            if events_file.is_file():
                results.append(events_file)
        elif child.is_file() and child.suffix == ".jsonl":
            results.append(child)
    return results


def print_report(reports: list[SessionReport]) -> None:
    """Print a formatted report."""
    if not reports:
        print("No sessions found.")
        return

    # Group by version
    by_version: dict[str, list[SessionReport]] = defaultdict(list)
    for r in reports:
        key = r.copilot_version or "unknown"
        by_version[key].append(r)

    print("=" * 72)
    print("COPILOT SESSION VERSION REPORT")
    print("=" * 72)

    # Summary by version
    print("\n--- Sessions by Version ---")
    for ver in sorted(by_version, key=lambda v: parse_version(v) if v != "unknown" else (0,)):
        count = len(by_version[ver])
        total_events = sum(r.event_count for r in by_version[ver])
        print(f"  v{ver:12s}  {count:4d} session(s)  {total_events:6d} total events")

    # Field coverage matrix
    all_fields = sorted(VERSION_FIELD_MAP.keys())
    print("\n--- Field Coverage Matrix ---")
    header = f"{'Version':>12s}"
    for f in all_fields:
        short = f.split(".")[-1][:12]
        header += f"  {short:>12s}"
    print(header)

    for ver in sorted(by_version, key=lambda v: parse_version(v) if v != "unknown" else (0,)):
        row = f"{'v' + ver:>12s}"
        for field in all_fields:
            present_count = sum(
                1 for r in by_version[ver] if r.field_presence.get(field, False)
            )
            total = len(by_version[ver])
            if total == 0:
                row += f"  {'N/A':>12s}"
            else:
                pct = present_count * 100 // total
                row += f"  {pct:>3d}% ({present_count}/{total})"
        print(row)

    # Anomalies
    anomalies = [(r, a) for r in reports for a in r.anomalies]
    if anomalies:
        print(f"\n--- Anomalies ({len(anomalies)}) ---")
        for r, a in anomalies:
            print(f"  [{r.session_id}] v{r.copilot_version or '?'}: {a}")
    else:
        print("\n--- No anomalies detected ---")

    # Unknown event types
    all_unknown: dict[str, int] = defaultdict(int)
    for r in reports:
        for et, cnt in r.unknown_event_types.items():
            all_unknown[et] += cnt
    if all_unknown:
        print(f"\n--- Unknown Event Types ({len(all_unknown)}) ---")
        for et in sorted(all_unknown, key=lambda k: -all_unknown[k]):
            print(f"  {et:40s}  {all_unknown[et]:6d} occurrences")
    else:
        print("\n--- No unknown event types ---")

    # Parse errors
    errors = [(r, e) for r in reports for e in r.parse_errors]
    if errors:
        print(f"\n--- Parse Errors ({len(errors)}) ---")
        for r, e in errors[:20]:
            print(f"  [{r.session_id}] {e}")
        if len(errors) > 20:
            print(f"  ... and {len(errors) - 20} more")

    print()


def default_session_dir() -> Path:
    """Return the default session state directory."""
    env_dir = os.environ.get("COPILOT_SESSION_DIR")
    if env_dir:
        return Path(env_dir)
    home = Path.home()
    return home / ".copilot" / "session-state"


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Validate Copilot CLI session events against version schemas."
    )
    parser.add_argument(
        "--session-dir",
        type=Path,
        default=None,
        help=(
            "Path to session state directory "
            f"(default: $COPILOT_SESSION_DIR or {default_session_dir()})"
        ),
    )
    args = parser.parse_args()

    session_dir: Path = args.session_dir or default_session_dir()
    if not session_dir.is_dir():
        print(f"Session directory not found: {session_dir}", file=sys.stderr)
        return 1

    print(f"Scanning: {session_dir}")
    event_files = find_sessions(session_dir)
    print(f"Found {len(event_files)} session(s)")

    reports = [analyze_session(p) for p in event_files]
    print_report(reports)
    return 0


if __name__ == "__main__":
    sys.exit(main())
