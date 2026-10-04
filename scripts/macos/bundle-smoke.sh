#!/usr/bin/env bash
# Verify a built macOS bundle the way a user installs it: check the signature
# and identity, copy the app out of the disk image, then launch the copy
# against an isolated data root and confirm it starts and stays up.
#
# Usage: bash scripts/macos/bundle-smoke.sh [bundle-dir]
# Default bundle dir: target/release/bundle. Diagnostics: .tracepilot/macos-smoke/
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
bundle_dir="${1:-$repo/target/release/bundle}"
results="$repo/.tracepilot/macos-smoke"
version="$(node -p "require('$repo/package.json').version")"
identifier="dev.tracepilot.app"
mount="$results/mount"
app_pid=""

fail() {
  echo "::error::$*" >&2
  exit 1
}

cleanup() {
  if [ -n "$app_pid" ] && kill -0 "$app_pid" 2>/dev/null; then
    kill "$app_pid" 2>/dev/null || true
    wait "$app_pid" 2>/dev/null || true
  fi
  if mount | grep -q " on $mount "; then
    hdiutil detach "$mount" -quiet || hdiutil detach "$mount" -force -quiet || true
  fi
}
trap cleanup EXIT

rm -rf "$results"
mkdir -p "$results"

shopt -s nullglob
dmgs=("$bundle_dir"/dmg/*.dmg)
shopt -u nullglob
[ "${#dmgs[@]}" -eq 1 ] || fail "Expected one disk image in $bundle_dir/dmg, found ${#dmgs[@]}."
dmg="${dmgs[0]}"
built_app="$bundle_dir/macos/TracePilot.app"
[ -d "$built_app" ] || fail "Missing app bundle: $built_app"

# An unsigned or partially signed bundle is reported as "damaged" on Apple
# Silicon. The config ad-hoc signs it; a Developer ID signature also passes.
codesign --verify --deep --strict --verbose=2 "$built_app"
codesign --display --verbose=2 "$built_app" 2>"$results/codesign.txt"
grep -E '^(Signature|Identifier|Format)' "$results/codesign.txt" || true

plist="$built_app/Contents/Info.plist"
bundle_version="$(plutil -extract CFBundleShortVersionString raw "$plist")"
bundle_id="$(plutil -extract CFBundleIdentifier raw "$plist")"
executable="$(plutil -extract CFBundleExecutable raw "$plist")"
[ "$bundle_version" = "$version" ] || fail "Bundle version $bundle_version != package.json $version."
[ "$bundle_id" = "$identifier" ] || fail "Bundle identifier $bundle_id != $identifier."
archs="$(lipo -archs "$built_app/Contents/MacOS/$executable")"
echo "Bundle $bundle_id $bundle_version ($archs)"
[[ " $archs " == *" arm64 "* ]] || fail "Executable is not built for Apple Silicon: $archs"

# Install from the disk image the way a user drags it to Applications.
mkdir -p "$mount"
hdiutil attach "$dmg" -nobrowse -readonly -noautoopen -mountpoint "$mount" >/dev/null
[ -d "$mount/TracePilot.app" ] || fail "Disk image does not contain TracePilot.app."
[ -L "$mount/Applications" ] || fail "Disk image has no Applications shortcut."
install_root="$results/Applications"
mkdir -p "$install_root"
ditto "$mount/TracePilot.app" "$install_root/TracePilot.app"
hdiutil detach "$mount" -quiet
app="$install_root/TracePilot.app"
codesign --verify --deep --strict "$app"

# The path contains a space, like the Windows suite, to catch quoting bugs.
data_root="$results/data root"
mkdir -p "$data_root"
log_file="$data_root/logs/TracePilot.log"
# Start with launchd's minimal PATH, as a Finder launch would, so the app's
# login-shell PATH restore (and its re-exec) runs.
TRACEPILOT_DATA_ROOT="$data_root" PATH="/usr/bin:/bin:/usr/sbin:/sbin" \
  "$app/Contents/MacOS/$executable" >"$results/app.stdout.log" 2>&1 &
app_pid=$!

started=false
for _ in $(seq 1 60); do
  kill -0 "$app_pid" 2>/dev/null || break
  if grep -q "TracePilot v$version starting" "$log_file" 2>/dev/null; then
    started=true
    break
  fi
  sleep 1
done
if ! $started; then
  cat "$results/app.stdout.log" >&2 || true
  fail "TracePilot did not log startup within 60 seconds."
fi

# Startup crashes (webview, plugin or IPC setup) usually surface within seconds.
sleep 15
if ! kill -0 "$app_pid" 2>/dev/null; then
  cat "$results/app.stdout.log" >&2 || true
  fail "TracePilot exited after startup."
fi
# Advisory: `ps` may not show another process's environment on every host.
if ps eww -p "$app_pid" 2>/dev/null | grep -q "TRACEPILOT_LOGIN_PATH_RESTORED=1"; then
  echo "Login shell PATH restored after the minimal launch PATH."
else
  echo "::warning::Could not confirm the login shell PATH restore from the process environment."
fi
screencapture -x "$results/window.png" 2>/dev/null || true
echo "TracePilot $version launched from the disk image copy and stayed running."
