#!/bin/sh
# Runs a lefthook hook with the lefthook installed in *this* worktree.
#
# `pnpm hooks:install` sets `core.hooksPath=scripts/git-hooks`. Git resolves a
# relative hooksPath from the top of each worktree, so every checkout runs its
# own tracked shims against its own node_modules; nothing refers to another
# worktree's install. See CONTRIBUTING.md ("Git hooks").
#
# Usage (from the per-hook shims): run-lefthook.sh <hook-name> [git hook args]

hook="$1"
shift

if [ "$LEFTHOOK" = "0" ]; then
  exit 0
fi

root="$(git rev-parse --show-toplevel 2>/dev/null)" || root="$PWD"

if [ -n "$LEFTHOOK_BIN" ]; then
  exec "$LEFTHOOK_BIN" run "$hook" "$@"
fi

cli="$root/node_modules/lefthook/bin/index.js"
if [ -f "$cli" ] && command -v node >/dev/null 2>&1; then
  exec node "$cli" run "$hook" "$@"
fi

# Warn loudly but don't block: CI runs the same checks, and a missing install
# must not stop a commit. It must never pass silently either.
if [ -t 2 ]; then
  on="$(printf '\033[1;33m')"
  off="$(printf '\033[0m')"
fi
echo "${on}WARNING: git $hook checks SKIPPED - lefthook is not installed in $root. Run 'pnpm install' in this worktree.${off}" >&2
exit 0
