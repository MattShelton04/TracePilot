#!/usr/bin/env bash
# Profile-Guided Optimization (PGO) build for TracePilot.
#
# PGO uses runtime profiling data from benchmarks to guide compiler optimizations,
# typically yielding 5–15% additional runtime speedup on hot paths.
#
# Prerequisites:
#   - Rust nightly or stable 1.83+ (PGO is stable since 1.83)
#   - llvm-profdata (comes with rustup component llvm-tools)
#
# Usage:
#   ./scripts/pgo-build.sh              # Full PGO release build
#   ./scripts/pgo-build.sh --skip-bench # Reuse existing profiles

set -euo pipefail

PROFILE_DIR="target/pgo-profiles"
MERGED_PROFILE="$PROFILE_DIR/merged.profdata"

# Ensure llvm-profdata is available
if ! rustup component list --installed | grep -q llvm-tools; then
  echo "Installing llvm-tools component..."
  rustup component add llvm-tools
fi

LLVM_PROFDATA=$(sh -c 'ls "$(rustc --print sysroot)"/lib/rustlib/*/bin/llvm-profdata 2>/dev/null | head -1' || true)
if [ -z "$LLVM_PROFDATA" ]; then
  echo "ERROR: llvm-profdata not found. Install with: rustup component add llvm-tools"
  exit 1
fi

echo "=== PGO Step 1: Instrumented build ==="
if [ "${1:-}" != "--skip-bench" ]; then
  rm -rf "$PROFILE_DIR"
  mkdir -p "$PROFILE_DIR"
else
  if [ ! -d "$PROFILE_DIR" ] || [ -z "$(find "$PROFILE_DIR" -name '*.profraw' 2>/dev/null)" ]; then
    echo "ERROR: --skip-bench requires existing profiles in $PROFILE_DIR"
    exit 1
  fi
  echo "Reusing existing profiles in $PROFILE_DIR"
fi
RUSTFLAGS="-Cprofile-generate=$PROFILE_DIR" cargo build --release -p tracepilot-desktop

if [ "${1:-}" != "--skip-bench" ]; then
  echo "=== PGO Step 2: Collecting profiles via benchmarks ==="
  RUSTFLAGS="-Cprofile-generate=$PROFILE_DIR" cargo bench -p tracepilot-bench -- --quick
  echo "Profiles collected: $(find "$PROFILE_DIR" -name '*.profraw' | wc -l) files"
fi

echo "=== PGO Step 3: Merging profiles ==="
"$LLVM_PROFDATA" merge -o "$MERGED_PROFILE" "$PROFILE_DIR"/*.profraw
echo "Merged profile: $(du -h "$MERGED_PROFILE" | cut -f1)"

echo "=== PGO Step 4: Optimized build ==="
RUSTFLAGS="-Cprofile-use=$MERGED_PROFILE" cargo build --release -p tracepilot-desktop

echo ""
echo "=== PGO build complete ==="
echo "Binary: target/release/tracepilot-desktop"
ls -lh target/release/tracepilot-desktop 2>/dev/null || true
