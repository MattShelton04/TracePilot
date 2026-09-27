#!/usr/bin/env python3
"""Capture read-only dependency graph inputs for one audit phase.

Usage: python scripts/dependencies/capture_inputs.py final \
         --pnpm-cli .agent/dependency-audit/tools/pnpm/package/bin/pnpm.cjs

Requires Python 3.11+, Cargo, Node, the installed root `yaml` package, and an
already-installed pnpm CLI.
No installer, resolver update, or package-manager write command is invoked.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
import tomllib
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
AUDIT = ROOT / ".agent" / "dependency-audit"
PLATFORMS = {
    "cargo-metadata-windows.json": "x86_64-pc-windows-msvc",
    "cargo-metadata-linux.json": "x86_64-unknown-linux-gnu",
    "cargo-metadata-macos.json": "aarch64-apple-darwin",
}


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def json_text(value: Any) -> str:
    return json.dumps(value, indent=2, ensure_ascii=False) + "\n"


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8-sig"))


def write_json(path: Path, value: Any) -> None:
    path.write_text(json_text(value), encoding="utf-8")


def read_yaml(path: Path) -> Any:
    """Parse YAML with the root workspace's declared Node dependency."""
    script = (
        "const fs = require('node:fs'); "
        "const YAML = require('yaml'); "
        "process.stdout.write(JSON.stringify(YAML.parse(fs.readFileSync(process.argv[1], 'utf8'))));"
    )
    completed = subprocess.run(["node", "--input-type=commonjs", "-e", script, str(path)], cwd=ROOT, capture_output=True,
                               text=True, encoding="utf-8", errors="replace", check=False)
    if completed.returncode:
        raise RuntimeError(f"failed to parse {path.relative_to(ROOT)} with installed root yaml package: {completed.stderr.strip()}")
    return json.loads(completed.stdout)


def run_capture(command: list[str], output: Path, root: Path = ROOT) -> None:
    completed = subprocess.run(command, cwd=root, capture_output=True, text=True, encoding="utf-8", errors="replace", check=False)
    output.write_text(completed.stdout, encoding="utf-8")
    output.with_suffix(output.suffix + ".stderr").write_text(completed.stderr, encoding="utf-8")
    if completed.returncode:
        raise RuntimeError(f"read-only command failed ({completed.returncode}): {command[0]} {command[1:3]}; see {output.relative_to(ROOT)}.stderr")
    json.loads(completed.stdout)


def cargo_metadata(phase_dir: Path) -> None:
    base = ["cargo", "metadata", "--format-version", "1", "--locked", "--offline"]
    run_capture(base + ["--all-features"], phase_dir / "cargo-metadata-all-features.json")
    run_capture(base, phase_dir / "cargo-metadata.stdout")
    for filename, target in PLATFORMS.items():
        run_capture(base + ["--filter-platform", target], phase_dir / filename)


def installed_presence(list_report: list[dict]) -> list[dict]:
    by_key: dict[tuple[str, str], dict] = {}

    def visit(name: str, package: dict) -> None:
        version = package.get("version")
        if version is not None:
            path = package.get("path")
            internal = str(version).startswith("link:")
            item = {"name": name, "version": str(version), "exists": Path(path).exists() if path else False, "internal": internal}
            key = (name, str(version))
            if key in by_key:
                by_key[key]["exists"] = by_key[key]["exists"] or item["exists"]
            else:
                by_key[key] = item
        for section in ("dependencies", "devDependencies", "optionalDependencies"):
            for child_name, child in package.get(section, {}).items():
                visit(child_name, child)

    for importer in list_report:
        for section in ("dependencies", "devDependencies", "optionalDependencies"):
            for name, item in importer.get(section, {}).items():
                visit(name, item)
    return sorted(by_key.values(), key=lambda item: (item["name"], item["version"]))


def capture_pnpm_list(phase_dir: Path, cli: Path | None, captured: Path | None) -> list[dict]:
    dest = phase_dir / "pnpm-list.stdout"
    if captured:
        report = read_json(captured)
        write_json(dest, report)
        return report
    if cli is None:
        raise ValueError("Specify --pnpm-cli for an already-installed CLI, or --pnpm-list-file for a captured list. No pnpm installer is invoked.")
    if not cli.is_file():
        raise FileNotFoundError(f"pnpm CLI file does not exist: {cli}")
    run_capture(["node", str(cli), "list", "-r", "--depth", "Infinity", "--json"], dest)
    return read_json(dest)


def direct_census(phase_dir: Path, cargo_metadata_report: dict, pnpm_lock: dict, workspace: dict, cargo_lock: dict) -> list[dict]:
    workspace_manifest = tomllib.loads((ROOT / "Cargo.toml").read_text(encoding="utf-8"))
    cargo_packages = {pkg["name"]: pkg for pkg in cargo_metadata_report["packages"] if pkg["id"] in cargo_metadata_report["workspace_members"]}
    rows: list[dict] = []

    for member in workspace_manifest["workspace"]["members"]:
        manifest = f"{member}/Cargo.toml"
        data = tomllib.loads((ROOT / manifest).read_text(encoding="utf-8"))
        consumer = data["package"]["name"]

        def emit(section: str, dependencies: dict, target: str | None = None) -> None:
            for alias, declaration in dependencies.items():
                declaration = {"version": declaration} if isinstance(declaration, str) else declaration
                inherited = workspace_manifest["workspace"].get("dependencies", {}).get(alias, {}) if declaration.get("workspace") else {}
                inherited = {"version": inherited} if isinstance(inherited, str) else inherited
                effective = {**inherited, **declaration}
                effective["features"] = sorted(set(inherited.get("features", []) + declaration.get("features", [])))
                kind = {"dependencies": "normal", "dev-dependencies": "dev", "build-dependencies": "build"}[section]
                candidates = [dep for dep in cargo_packages[consumer]["dependencies"]
                              if (dep.get("rename") or dep["name"]).replace("-", "_") == alias.replace("-", "_")
                              and (dep.get("kind") or "normal") == kind and dep.get("target") == target]
                metadata = dict(candidates[0]) if candidates else {}
                if metadata.get("path"):
                    try:
                        metadata["path"] = Path(metadata["path"]).resolve().relative_to(ROOT).as_posix()
                    except ValueError:
                        metadata["path"] = "<outside-workspace>"
                rows.append({"ecosystem": "cargo", "consumer": consumer, "manifest": manifest, "name": alias,
                             "section": section, "target": target, "declaration": declaration, "effective": effective, "metadata": metadata})

        for section in ("dependencies", "dev-dependencies", "build-dependencies"):
            emit(section, data.get(section, {}))
        for target, sections in data.get("target", {}).items():
            for section in ("dependencies", "dev-dependencies", "build-dependencies"):
                emit(section, sections.get(section, {}), target)

    for importer, sections in pnpm_lock["importers"].items():
        manifest = "package.json" if importer == "." else f"{importer}/package.json"
        data = read_json(ROOT / manifest)
        for section in ("dependencies", "devDependencies", "peerDependencies", "optionalDependencies"):
            for name, declaration in data.get(section, {}).items():
                matches = [(section, sections[section][name])] if name in sections.get(section, {}) else []
                # pnpm often records a manifest peer under the importer's normal
                # or dev section when that same package is installed locally.
                if section == "peerDependencies" and not matches:
                    matches = [(kind, sections[kind][name]) for kind in ("dependencies", "devDependencies", "optionalDependencies")
                               if name in sections.get(kind, {})]
                versions = {str(info.get("version")) for _, info in matches}
                if len(versions) > 1:
                    raise ValueError(f"ambiguous peer provider for {manifest} {name}: {sorted(versions)}")
                resolved = matches[0][1] if matches else None
                rows.append({"ecosystem": "pnpm", "consumer": data["name"], "manifest": manifest, "name": name,
                             "section": section, "resolved_sections": [kind for kind, _ in matches], "declaration": declaration,
                             "effective": workspace.get("catalog", {}).get(name) if declaration == "catalog:" else declaration,
                             "resolved": resolved})

    island = read_json(ROOT / "scripts/visual/package.json")
    island_lock = read_json(ROOT / "scripts/visual/package-lock.json")
    for section in ("dependencies", "devDependencies", "peerDependencies", "optionalDependencies"):
        for name, declaration in island.get(section, {}).items():
            rows.append({"ecosystem": "npm-island", "consumer": island["name"], "manifest": "scripts/visual/package.json",
                         "name": name, "section": section, "declaration": declaration,
                         "resolved": island_lock["packages"].get("node_modules/" + name)})
    return rows


def registry_metadata(phase_dir: Path, pnpm_lock: dict, island_version: str, prior_cache: Path | None, offline: bool) -> dict:
    cache = read_json(prior_cache) if prior_cache and prior_cache.exists() else {}
    cache.update(read_json(phase_dir / "npm-registry.json") if (phase_dir / "npm-registry.json").exists() else {})
    keys = sorted(set(pnpm_lock["packages"]) | {f"pngjs@{island_version}"})

    def fetch(key: str) -> tuple[str, dict]:
        if key in cache and not cache[key].get("error"):
            return key, cache[key]
        name, version = key.rsplit("@", 1)
        url = f"https://registry.npmjs.org/{urllib.parse.quote(name, safe='')}/{version}"
        if offline:
            return key, {"name": name, "version": version, "url": url, "error": "not present in supplied offline cache"}
        try:
            request = urllib.request.Request(url, headers={"Accept": "application/json", "User-Agent": "TracePilot-dependency-audit/1"})
            with urllib.request.urlopen(request, timeout=20) as response:
                package = json.load(response)
            return key, {"name": name, "version": version, "url": url, "checked": datetime.now(timezone.utc).isoformat(),
                         "description": package.get("description"), "license": package.get("license"),
                         "repository": package.get("repository"), "engines": package.get("engines", {}),
                         "deprecated": package.get("deprecated"), "scripts": package.get("scripts", {}),
                         "peerDependencies": package.get("peerDependencies", {}),
                         "optionalDependencies": package.get("optionalDependencies", {}),
                         "os": package.get("os", []), "cpu": package.get("cpu", []),
                         "distIntegrity": package.get("dist", {}).get("integrity")}
        except (urllib.error.URLError, TimeoutError, ValueError) as error:
            return key, {"name": name, "version": version, "url": url, "error": str(error)}

    with ThreadPoolExecutor(max_workers=4) as pool:
        result = dict(pool.map(fetch, keys))
    write_json(phase_dir / "npm-registry.json", result)
    return result


def source_input_files(pnpm_lock: dict, workspace: dict) -> list[Path]:
    """All manifests and lockfiles whose bytes influence a graph capture."""
    importer_manifests = [ROOT / ("package.json" if importer == "." else f"{importer}/package.json")
                          for importer in pnpm_lock["importers"]]
    return sorted({ROOT / "Cargo.toml", ROOT / "Cargo.lock", ROOT / "pnpm-lock.yaml", ROOT / "pnpm-workspace.yaml",
                   ROOT / "scripts/visual/package.json", ROOT / "scripts/visual/package-lock.json", *importer_manifests,
                   *(ROOT / member / "Cargo.toml" for member in workspace["workspace"]["members"])})


def capture(phase: str, pnpm_cli: Path | None, pnpm_list_file: Path | None, registry_cache: Path | None, offline_registry: bool) -> dict:
    phase_dir = AUDIT / phase
    phase_dir.mkdir(parents=True, exist_ok=True)
    pnpm_lock_bytes = (ROOT / "pnpm-lock.yaml").read_bytes()
    pnpm_lock = read_yaml(ROOT / "pnpm-lock.yaml")
    workspace = tomllib.loads((ROOT / "Cargo.toml").read_text(encoding="utf-8"))
    source_files = source_input_files(pnpm_lock, workspace)
    before = {path.relative_to(ROOT).as_posix(): sha256(path) for path in source_files}
    if hashlib.sha256(pnpm_lock_bytes).hexdigest() != before["pnpm-lock.yaml"]:
        raise RuntimeError("pnpm lockfile changed while enumerating workspace importers; retry capture")
    cargo_metadata(phase_dir)
    cargo_lock = tomllib.loads((ROOT / "Cargo.lock").read_text(encoding="utf-8"))
    pnpm_workspace = read_yaml(ROOT / "pnpm-workspace.yaml")
    write_json(phase_dir / "cargo-lock.json", cargo_lock)
    write_json(phase_dir / "pnpm-lock.json", pnpm_lock)
    write_json(phase_dir / "pnpm-workspace.json", pnpm_workspace)
    list_report = capture_pnpm_list(phase_dir, pnpm_cli, pnpm_list_file)
    write_json(phase_dir / "installed-presence.json", installed_presence(list_report))
    census = direct_census(phase_dir, read_json(phase_dir / "cargo-metadata-all-features.json"), pnpm_lock, pnpm_workspace, cargo_lock)
    write_json(phase_dir / "direct-census.json", census)
    island = next(item for item in census if item["ecosystem"] == "npm-island" and item["name"] == "pngjs")
    registry = registry_metadata(phase_dir, pnpm_lock, island["resolved"]["version"], registry_cache, offline_registry)
    after = {path.relative_to(ROOT).as_posix(): sha256(path) for path in source_files}
    if before != after:
        raise RuntimeError("A source manifest or lockfile changed during capture; discard this mixed snapshot")
    outputs = ["cargo-metadata-all-features.json", "cargo-metadata.stdout", *PLATFORMS, "cargo-lock.json", "pnpm-lock.json",
               "pnpm-workspace.json", "pnpm-list.stdout", "installed-presence.json", "direct-census.json", "npm-registry.json"]
    receipt = {"phase": phase, "captured_utc": datetime.now(timezone.utc).isoformat(), "source_sha256": before,
               "output_sha256": {name: sha256(phase_dir / name) for name in outputs},
               "counts": {"cargo_lock": len(cargo_lock["package"]), "cargo_metadata_all_features": len(read_json(phase_dir / "cargo-metadata-all-features.json")["packages"]),
                          "pnpm_packages": len(pnpm_lock["packages"]), "pnpm_snapshots": len(pnpm_lock["snapshots"]),
                          "direct_declarations": len(census), "registry_records": len(registry),
                          "registry_failures": sum(bool(item.get("error")) for item in registry.values())},
               "commands": ["cargo metadata --locked --offline", "node <already-installed-pnpm-cli> list -r --depth Infinity --json" if not pnpm_list_file else "read supplied pnpm list JSON"],
               "scanner_note": "Security scanner files are separate optional inputs; absence is reported as unscanned by generate_graph.py."}
    write_json(phase_dir / "capture-manifest.json", receipt)
    return receipt


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("phase", choices=("baseline", "final"))
    parser.add_argument("--pnpm-cli", type=Path, help="Path to an already-installed pnpm.cjs; never auto-provisioned")
    parser.add_argument("--pnpm-list-file", type=Path, help="Use an existing pnpm list JSON capture and verify its package paths")
    parser.add_argument("--registry-cache", type=Path, default=AUDIT / "npm-registry.json", help="Reuse exact locked-version registry records")
    parser.add_argument("--offline-registry", action="store_true", help="Do not fetch missing registry records")
    args = parser.parse_args()
    if bool(args.pnpm_cli) == bool(args.pnpm_list_file):
        parser.error("Specify exactly one of --pnpm-cli or --pnpm-list-file")
    receipt = capture(args.phase, args.pnpm_cli, args.pnpm_list_file, args.registry_cache, args.offline_registry)
    print(json_text({"phase": args.phase, "counts": receipt["counts"], "capture_manifest": f".agent/dependency-audit/{args.phase}/capture-manifest.json"}))


if __name__ == "__main__":
    try:
        main()
    except (FileNotFoundError, RuntimeError, ValueError) as error:
        print(f"capture failed: {error}", file=sys.stderr)
        sys.exit(1)
