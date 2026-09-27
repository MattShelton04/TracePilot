#!/usr/bin/env python3
"""Build an exact lock-context dependency graph from captured audit inputs.

Usage: python scripts/dependencies/generate_graph.py baseline
       python scripts/dependencies/generate_graph.py final

Inputs are captured by the audit runner in .agent/dependency-audit/<phase>.
This script never runs a package manager or changes manifests/lockfiles.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import posixpath
from collections import Counter, defaultdict, deque
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[2]
AUDIT = ROOT / ".agent" / "dependency-audit"
PROFILES = {
    "all_features": "cargo-metadata-all-features.json",
    "default_all_targets": "cargo-metadata.stdout",
    "windows_default": "cargo-metadata-windows.json",
    "linux_default": "cargo-metadata-linux.json",
    "macos_default": "cargo-metadata-macos.json",
}


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def verify_capture_receipt(phase_dir: Path) -> bool:
    receipt_path = phase_dir / "capture-manifest.json"
    if not receipt_path.exists():
        return False  # The historical baseline predates this capture receipt.
    receipt = read_json(receipt_path)
    for name, expected in receipt.get("output_sha256", {}).items():
        path = phase_dir / name
        if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != expected:
            raise ValueError(f"captured graph input changed after capture: {path}")
    return True


def relative_manifest(path: str) -> str | None:
    try:
        candidate = Path(path)
        return (candidate if candidate.is_absolute() else ROOT / candidate).resolve().relative_to(ROOT).as_posix()
    except (ValueError, OSError):
        return None


def package_key(name: str, version: str) -> str:
    return f"{name}@{version}"


def split_snapshot_key(key: str) -> tuple[str, str, str]:
    base, _, peer = key.partition("(")
    name, version = base.rsplit("@", 1)
    return name, version, f"({peer}" if peer else ""


def peer_providers(snapshot_key: str) -> list[str]:
    """Return complete provider snapshot keys from top-level pnpm peer groups.

    Nested groups belong to the provider's own peer context, for example
    ``pkg@1(vue@3(typescript@5))`` has one provider, ``vue@3(typescript@5)``.
    """
    context = split_snapshot_key(snapshot_key)[2]
    providers: list[str] = []
    depth = 0
    start = -1
    for offset, char in enumerate(context):
        if char == "(":
            if depth == 0:
                start = offset + 1
            depth += 1
        elif char == ")":
            depth -= 1
            if depth < 0:
                raise ValueError(f"malformed pnpm peer context: {snapshot_key}")
            if depth == 0:
                providers.append(context[start:offset])
        elif depth == 0:
            raise ValueError(f"malformed pnpm peer context: {snapshot_key}")
    if depth:
        raise ValueError(f"malformed pnpm peer context: {snapshot_key}")
    return providers


def linked_importer(from_importer: str, version: str) -> str:
    return posixpath.normpath(posixpath.join(from_importer, version.removeprefix("link:")))


def registry_record(registry: dict[str, Any], name: str, version: str) -> dict[str, Any]:
    return registry.get(package_key(name, version), {})


def upstream_url(repository: Any, fallback: str) -> str:
    if isinstance(repository, str):
        return repository
    if isinstance(repository, dict) and isinstance(repository.get("url"), str):
        return repository["url"]
    return fallback


def curated_npm_purpose(name: str) -> str | None:
    """Bounded purpose inference where the published package has no description."""
    if name.startswith("@biomejs/cli-"):
        return "Platform-specific binary for the Biome formatter and linter."
    return {
        "@tailwindcss/oxide": "Native compilation engine used by Tailwind CSS.",
        "@volar/language-core": "Core virtual-code abstractions for Volar language tooling.",
        "@volar/source-map": "Source mapping for Volar virtual language files.",
        "@volar/typescript": "TypeScript integration for Volar language tooling.",
        "@vue/language-core": "Vue single-file-component language analysis core.",
        "vue-component-type-helpers": "Type helpers for Vue component analysis.",
        "vue-router": "Client-side routing for Vue applications.",
        "vue-tsc": "TypeScript checking command for Vue single-file components.",
    }.get(name)


def cargo_alias(name: str) -> str:
    return name.replace("-", "_")


def scanner_findings(phase_dir: Path) -> tuple[dict[tuple[str, str], list[dict]], dict[tuple[str, str], list[dict]], dict[tuple[str, str], list[dict]], dict]:
    rustsec: dict[tuple[str, str], list[dict]] = defaultdict(list)
    deny: dict[tuple[str, str], list[dict]] = defaultdict(list)
    pnpm: dict[tuple[str, str], list[dict]] = defaultdict(list)
    summary: dict[str, Any] = {"availability": {
        "rustsec": (phase_dir / "rustsec.stdout").exists(),
        "cargo_deny": (phase_dir / "cargo-deny.stderr").exists(),
        "pnpm_full": (phase_dir / "pnpm-audit-full.stdout").exists(),
        "pnpm_prod": (phase_dir / "pnpm-audit-prod.stdout").exists(),
        "npm_island": (phase_dir / "npm-audit.stdout").exists(),
    }}
    summary["receipts"] = {}
    for kind, stem in (("rustsec", "rustsec"), ("cargo_deny", "cargo-deny"),
                       ("pnpm_full", "pnpm-audit-full"), ("pnpm_prod", "pnpm-audit-prod"),
                       ("npm_island", "npm-audit")):
        receipt_path = phase_dir / f"{stem}.result.json"
        if receipt_path.exists():
            receipt = read_json(receipt_path)
            summary["receipts"][kind] = {"program": receipt.get("program"), "utc": receipt.get("utc"),
                                         "exit_code": receipt.get("exitCode"), "report_present": summary["availability"][kind]}
        elif summary["availability"][kind]:
            summary["receipts"][kind] = {"status": "report present without a command receipt; scan provenance unverified"}

    rp = phase_dir / "rustsec.stdout"
    if rp.exists():
        report = read_json(rp)
        summary["rustsec"] = {
            "vulnerability_count": report.get("vulnerabilities", {}).get("count"),
            "warning_counts": {k: len(v) for k, v in report.get("warnings", {}).items()},
        }
        items = [("vulnerability", v) for v in report.get("vulnerabilities", {}).get("list", [])]
        items += [(k, v) for k, group in report.get("warnings", {}).items() for v in group]
        for kind, item in items:
            pkg = item.get("package", {})
            advisory = item.get("advisory", {})
            if pkg.get("name") and pkg.get("version"):
                rustsec[(pkg["name"], pkg["version"])].append({"kind": kind, "id": advisory.get("id"), "title": advisory.get("title")})

    dp = phase_dir / "cargo-deny.stderr"
    if dp.exists():
        codes: Counter[str] = Counter()
        with dp.open(encoding="utf-8", errors="replace") as stream:
            for line in stream:
                try:
                    item = json.loads(line)
                except json.JSONDecodeError:
                    continue
                fields = item.get("fields", {})
                code = fields.get("code")
                if not code:
                    continue
                codes[code] += 1
                for graph in fields.get("graphs", []):
                    pkg = graph.get("Krate", {})
                    if pkg.get("name") and pkg.get("version"):
                        deny[(pkg["name"], pkg["version"])].append({"code": code, "severity": fields.get("severity"), "advisory": fields.get("advisory")})
        summary["cargo_deny"] = {"message_codes": dict(sorted(codes.items()))}

    pp = phase_dir / "pnpm-audit-full.stdout"
    if pp.exists():
        report = read_json(pp)
        summary["pnpm_full"] = {
            "advisory_count": len(report.get("advisories", {})),
            "metadata": report.get("metadata", {}).get("vulnerabilities", {}),
        }
        for item in report.get("advisories", {}).values():
            name = item.get("module_name")
            for finding in item.get("findings", []):
                if name and finding.get("version"):
                    pnpm[(name, finding["version"])].append({
                        "id": item.get("github_advisory_id"),
                        "severity": item.get("severity"),
                        "url": item.get("url"),
                        "paths": finding.get("paths", []),
                    })

    for kind, filename in (("pnpm_prod", "pnpm-audit-prod.stdout"), ("npm_island", "npm-audit.stdout")):
        path = phase_dir / filename
        if path.exists():
            report = read_json(path)
            summary[kind] = {"advisory_count": len(report.get("advisories", report.get("vulnerabilities", {})))}
    return rustsec, deny, pnpm, summary


def add_node(nodes: dict[str, dict], node: dict) -> None:
    if node["id"] in nodes:
        raise ValueError(f"duplicate graph node {node['id']}")
    node.update(parents=[], children=[], direct_declarations=[], introducing_direct_declarations=[], root_scopes=[])
    nodes[node["id"]] = node


def add_edge(edges: list[dict], edge: dict) -> None:
    edge["id"] = f"edge:{len(edges)+1:06d}"
    edges.append(edge)


def update_disposition(node: dict, declarations_by_id: dict[str, dict]) -> dict:
    """Bounded per-node action from direct ownership, resolver paths and saved scans.

    A transitive node's latest release is not independently verified here. The
    direct version matrices own researched candidates for its introducing roots.
    """
    ecosystem = node["ecosystem"]
    scanner = node.get("scanner_disposition") or {}
    findings = [*scanner.get("rustsec", []), *scanner.get("cargo_deny", []),
                *scanner.get("pnpm_full", []), *scanner.get("npm_audit", [])]
    finding_ids = sorted({str(item.get("id") or (item.get("advisory") or {}).get("id") or item.get("code"))
                          for item in findings if item.get("id") or item.get("code") or (item.get("advisory") or {}).get("id")})
    scan_statuses = [value for key, value in scanner.items() if key.endswith("_status")]
    if findings:
        security_status = "recorded_scanner_finding"
    elif scan_statuses and all(value == "scanned" for value in scan_statuses):
        security_status = "scanned_no_node_finding_recorded"
    elif scan_statuses:
        security_status = "partly_or_not_scanned"
    else:
        security_status = "not_a_third_party_scan_target"

    direct_ids = node["direct_declarations"]
    introducing_ids = node["introducing_direct_declarations"]
    manifests = sorted({declarations_by_id[item]["manifest"] for item in introducing_ids if item in declarations_by_id})
    if ecosystem == "cargo":
        matrix, inventory = "docs/dependencies/rust-versions.md", "docs/dependencies/rust.md"
        lock = "Cargo.lock"
    else:
        matrix, inventory = "docs/dependencies/javascript-versions.md", "docs/dependencies/javascript.md"
        lock = "scripts/visual/package-lock.json" if ecosystem == "npm-island" else "pnpm-lock.yaml"

    if node["scope"] in ("workspace", "workspace_importer", "island_root"):
        scope = "first_party_root"
        decision = "maintain_with_workspace_manifest"
        basis = "First-party version/dependency policy is owned by its manifest and workspace configuration; no independent third-party latest-version claim."
        source_reference = [node.get("workspace_manifest") or ("package.json" if node["name"] == "." else
                            "scripts/visual/package.json" if node["scope"] == "island_root" else
                            f"{node['name']}/package.json")]
        latest_research = "not_applicable_first_party"
    elif direct_ids:
        scope = "direct"
        decision = "review_recorded_scanner_finding_in_direct_matrix" if findings else "follow_direct_version_matrix"
        basis = "A manifest directly declares this locked package; its latest/compatible candidate and exact keep/change decision are recorded in the direct version matrix."
        source_reference = [matrix, inventory, lock, *manifests]
        latest_research = "direct_name_reviewed_in_version_matrix"
    else:
        scope = "transitive"
        decision = "review_scanner_finding_with_introducing_parent" if findings else "retain_under_introducing_parent"
        basis = ("The captured lock/resolver selects this package through its introducing direct parent declarations. "
                 "Any leaf change needs parent range, API, build/target and security validation; this leaf's latest stable release was not individually verified.")
        source_reference = [matrix, inventory, lock, *manifests]
        latest_research = "not_individually_verified"

    if findings:
        source_reference.append("docs/dependencies/security.md")
    return {
        "scope": scope, "decision": decision, "basis": basis,
        "source_reference": sorted(set(source_reference)),
        "introducing_direct_ids": introducing_ids,
        "direct_ids": direct_ids,
        "latest_research": latest_research,
        "security_status": security_status, "scanner_finding_ids": finding_ids,
        "security_interpretation": "Saved scanner findings are evidence of a notice, not proof of exploitability; an empty node record is not a source audit.",
    }


def cargo_graph(profiles: dict[str, dict], cargo_lock: dict, nodes: dict[str, dict], edges: list[dict], rustsec: dict, deny: dict, scanner_availability: dict) -> tuple[dict[str, str], dict[str, str]]:
    full = profiles["all_features"]
    members = set(full["workspace_members"])
    packages_by_id = {pkg["id"]: pkg for pkg in full["packages"]}
    presence_by_profile = {profile: {pkg["id"] for pkg in data["packages"]} for profile, data in profiles.items()}
    lock_by_identity: dict[tuple[str, str, str | None], dict] = {}
    for entry in cargo_lock["package"]:
        identity = (entry["name"], entry["version"], entry.get("source"))
        if identity in lock_by_identity:
            raise ValueError(f"duplicate Cargo.lock identity {identity}")
        lock_by_identity[identity] = entry
    idmap: dict[str, str] = {}
    member_name: dict[str, str] = {}
    for pkg in full["packages"]:
        local = pkg["id"] in members
        metadata_source = pkg.get("source")
        lock_entry = lock_by_identity.get((pkg["name"], pkg["version"], metadata_source))
        if lock_entry is None:
            raise ValueError(f"Cargo metadata package absent from lock: {pkg['name']}@{pkg['version']} source={metadata_source}")
        scope = "workspace" if local else "registry" if metadata_source and metadata_source.startswith("registry+") else "external"
        node_id = f"cargo:{scope}:{pkg['name']}@{pkg['version']}"
        if node_id in nodes:
            raise ValueError(f"Cargo graph ID collision for {node_id}: {nodes[node_id]['source']} versus {metadata_source}; distinct sources need distinct graph identities")
        idmap[pkg["id"]] = node_id
        if local:
            member_name[pkg["name"]] = node_id
        targets = pkg.get("targets", [])
        source_file = relative_manifest(pkg.get("manifest_path", "")) if local else None
        if local and source_file is None:
            raise ValueError(f"workspace manifest outside repository: {pkg['manifest_path']}")
        add_node(nodes, {
            "id": node_id, "ecosystem": "cargo", "name": pkg["name"], "version": pkg["version"],
            "scope": scope, "workspace_manifest": source_file,
            "source": source_file if local else metadata_source,
            "source_basis": "workspace manifest_path relative to repository" if local else "cargo metadata package.source",
            "lock_checksum": lock_entry.get("checksum"),
            "purpose": (pkg.get("description") or "No package description in Cargo metadata.").strip()[:500],
            "review_primary_packet": "P12",
            "review_status": "resolver-mapped; package metadata and scanner input reviewed where available",
            "review_depth": "resolver/published-metadata/scanner review; no exhaustive upstream source audit",
            "license": pkg.get("license"), "upstream": pkg.get("repository") or pkg.get("homepage") or pkg.get("documentation") or f"https://crates.io/crates/{pkg['name']}",
            "rust_version": pkg.get("rust_version"), "categories": pkg.get("categories", []),
            "targets": [{"name": t.get("name"), "kind": t.get("kind", [])} for t in targets],
            "build_scripts": [t.get("name") for t in targets if "custom-build" in t.get("kind", [])],
            "proc_macro": any("proc-macro" in t.get("kind", []) for t in targets),
            "profile_presence": {profile: pkg["id"] in population for profile, population in presence_by_profile.items()},
            "scanner_disposition": {
                "rustsec": rustsec.get((pkg["name"], pkg["version"]), []),
                "rustsec_status": "scanned" if scanner_availability["rustsec"] else "unscanned",
                "cargo_deny": deny.get((pkg["name"], pkg["version"]), []),
                "cargo_deny_status": "scanned" if scanner_availability["cargo_deny"] else "unscanned",
                "interpretation": "captured scanner findings only; missing scanner input means unscanned, and no finding is not manual source review",
            },
        })

    combined: dict[tuple, dict] = {}
    for profile, data in profiles.items():
        for parent in data["resolve"]["nodes"]:
            for dep in parent.get("deps", []):
                for dep_kind in dep.get("dep_kinds", []):
                    key = (parent["id"], dep["pkg"], dep["name"], dep_kind.get("kind") or "normal", dep_kind.get("target"))
                    combined.setdefault(key, {"profiles": []})["profiles"].append(profile)
    for (parent, child, alias, kind, target), record in sorted(combined.items(), key=lambda x: str(x[0])):
        if parent not in idmap or child not in idmap:
            raise ValueError("Cargo resolve edge absent from all-features package population")
        child_name = packages_by_id[child]["name"]
        declared = [d for d in packages_by_id[parent].get("dependencies", [])
                    if (cargo_alias(d.get("rename") or d["name"]) == alias or d["name"] == child_name)
                    and (d.get("kind") or "normal") == kind and d.get("target") == target]
        add_edge(edges, {
            "from": idmap[parent], "to": idmap[child], "ecosystem": "cargo", "kind": kind,
            "dependency_alias": alias, "target_cfg": target, "profiles": sorted(record["profiles"]),
            "optional": any(d.get("optional", False) for d in declared) if declared else None,
            "requested_features": sorted({feature for d in declared for feature in d.get("features", [])}),
            "uses_default_features": any(d.get("uses_default_features", True) for d in declared) if declared else None,
            "peer_context": None, "evidence": "cargo metadata resolve.nodes.deps[].dep_kinds[]; packages[].dependencies[]",
        })
    return idmap, member_name


def pnpm_graph(lock: dict, nodes: dict[str, dict], edges: list[dict], registry: dict, presence: list[dict], pnpm_findings: dict, scanner_availability: dict) -> dict[str, str]:
    importer_ids = {imp: f"root:pnpm:{imp}" for imp in lock["importers"]}
    for imp, node_id in importer_ids.items():
        add_node(nodes, {"id": node_id, "ecosystem": "pnpm", "scope": "workspace_importer", "name": imp, "version": None,
                         "purpose": "Workspace package importer", "license": None, "upstream": None,
                         "scanner_disposition": {"interpretation": "workspace root; direct declarations mapped separately"}})
    presence_map = {(p["name"], p["version"]): p["exists"] for p in presence if not p.get("internal")}
    snap_ids: dict[str, str] = {}
    for snapkey, snapshot in lock["snapshots"].items():
        name, version, peer = split_snapshot_key(snapkey)
        base = package_key(name, version)
        if base not in lock["packages"]:
            raise ValueError(f"snapshot {snapkey} has no package metadata")
        pkg = lock["packages"][base]
        rec = registry_record(registry, name, version)
        lock_integrity = (pkg.get("resolution") or {}).get("integrity")
        published_integrity = rec.get("distIntegrity")
        if lock_integrity and published_integrity and lock_integrity != published_integrity:
            raise ValueError(f"pnpm lock/registry integrity mismatch for {base}")
        node_id = f"pnpm:{snapkey}"
        snap_ids[snapkey] = node_id
        scripts = rec.get("scripts") or {}
        published_description = rec.get("description")
        curated_purpose = curated_npm_purpose(name) if not published_description else None
        add_node(nodes, {
            "id": node_id, "ecosystem": "pnpm", "name": name, "version": version,
            "scope": "locked_snapshot", "peer_context": peer, "lock_package_key": base,
            "source": {"lock_resolution": pkg.get("resolution"), "registry_metadata_url": rec.get("url"),
                       "registry_dist_integrity": rec.get("distIntegrity")},
            "purpose": published_description or curated_purpose or "Purpose not established from locked registry metadata.",
            "purpose_basis": "published registry description" if published_description else
                             "curated inference from package identity and upstream repository" if curated_purpose else
                             "unknown; inspect upstream repository",
            "review_primary_packet": "P07/P13",
            "review_status": "resolver-mapped; package metadata and scanner input reviewed where available",
            "review_depth": "resolver/published-metadata/scanner review; no exhaustive upstream source audit",
            "license": rec.get("license") or pkg.get("license"),
            "upstream": upstream_url(rec.get("repository"), rec.get("url") or f"https://www.npmjs.com/package/{name}"),
            "registry_metadata_url": rec.get("url"), "engines": rec.get("engines") or pkg.get("engines") or {},
            "deprecated": rec.get("deprecated") or pkg.get("deprecated"),
            "peer_dependencies": pkg.get("peerDependencies") or rec.get("peerDependencies") or {},
            "peer_dependencies_meta": pkg.get("peerDependenciesMeta") or {},
            "platform": {"os": rec.get("os") or pkg.get("os") or [], "cpu": rec.get("cpu") or pkg.get("cpu") or []},
            "build_scripts": {k: v for k, v in scripts.items() if k in ("preinstall", "install", "postinstall", "prepare", "build", "prepack")},
            "has_bin": pkg.get("hasBin", False),
            "installed_presence": presence_map.get((name, version)),
            "scanner_disposition": {
                "pnpm_full": pnpm_findings.get((name, version), []),
                "pnpm_full_status": "scanned" if scanner_availability["pnpm_full"] else "unscanned",
                "pnpm_prod_status": "scanned" if scanner_availability["pnpm_prod"] else "unscanned",
                "interpretation": "captured lock scanner findings only; local installation is separate from lock presence",
            },
        })

    for snapkey, snapshot in lock["snapshots"].items():
        for section, kind in (("dependencies", "normal"), ("optionalDependencies", "optional")):
            for name, version in snapshot.get(section, {}).items():
                if version.startswith("link:"):
                    # Snapshot links are rare, but preserve rather than infer an external package.
                    target = None
                else:
                    target = snap_ids.get(package_key(name, version))
                    if target is None and version.startswith(f"{name}@"):
                        target = snap_ids.get(version)
                    if target is None and "@" in version:
                        # pnpm alias resolution, e.g. string-width-cjs -> string-width@4.2.3.
                        target = snap_ids.get(version)
                add_edge(edges, {
                    "from": snap_ids[snapkey], "to": target, "ecosystem": "pnpm", "kind": kind,
                    "dependency_alias": name, "specifier": None, "resolved": version,
                    "optional": kind == "optional", "peer_context": split_snapshot_key(package_key(name, version))[2],
                    "target_cfg": None, "evidence": f"pnpm-lock snapshots.{section}",
                })

        for provider in peer_providers(snapkey):
            peer_name, peer_version, peer_context = split_snapshot_key(provider)
            peer_meta = nodes[snap_ids[snapkey]]["peer_dependencies_meta"].get(peer_name, {})
            add_edge(edges, {
                "from": snap_ids[snapkey], "to": snap_ids.get(provider), "ecosystem": "pnpm",
                "kind": "peer_context", "dependency_alias": peer_name, "specifier": None,
                "resolved": peer_version + peer_context,
                "optional": bool(peer_meta.get("optional")) if peer_name in nodes[snap_ids[snapkey]]["peer_dependencies"] else None,
                "peer_context": provider, "peer_declared": peer_name in nodes[snap_ids[snapkey]]["peer_dependencies"],
                "target_cfg": None, "evidence": "pnpm-lock snapshot key peer context (not a normal dependency edge)",
            })

    for imp, sections in lock["importers"].items():
        for section in ("dependencies", "devDependencies", "peerDependencies", "optionalDependencies"):
            for name, info in sections.get(section, {}).items():
                version = info["version"]
                if version.startswith("link:"):
                    to = importer_ids.get(linked_importer(imp, version))
                else:
                    to = snap_ids.get(package_key(name, version))
                add_edge(edges, {
                    "from": importer_ids[imp], "to": to, "ecosystem": "pnpm", "kind": section,
                    "dependency_alias": name, "specifier": info.get("specifier"), "resolved": version,
                    "optional": section == "optionalDependencies", "peer_context": None if version.startswith("link:") else split_snapshot_key(package_key(name, version))[2],
                    "target_cfg": None, "evidence": f"pnpm-lock importers.{section}",
                })
    return importer_ids


def closure(start: str, adjacency: dict[str, list[dict]], predicate=lambda _edge: True) -> set[str]:
    seen = {start}
    queue = deque([start])
    while queue:
        for edge in adjacency.get(queue.popleft(), []):
            if edge["to"] and predicate(edge) and edge["to"] not in seen:
                seen.add(edge["to"])
                queue.append(edge["to"])
    return seen


def reconcile_presence_aliases(presence: list[dict], nodes: dict[str, dict], edges: list[dict]) -> tuple[dict[tuple[str, str], bool], list[dict]]:
    """Map pnpm list alias names to their canonical locked package identity."""
    alias_targets: dict[tuple[str, str], tuple[str, str]] = {}
    for edge in edges:
        if edge["ecosystem"] != "pnpm" or not edge["to"] or edge["kind"] == "peer_context":
            continue
        target = nodes[edge["to"]]
        alias = edge["dependency_alias"]
        if target["scope"] != "locked_snapshot" or alias == target["name"]:
            continue
        key = (alias, target["version"])
        canonical = (target["name"], target["version"])
        if key in alias_targets and alias_targets[key] != canonical:
            raise ValueError(f"ambiguous pnpm alias identity: {key}")
        alias_targets[key] = canonical

    canonical_presence: dict[tuple[str, str], bool] = {}
    alias_records: list[dict] = []
    for item in presence:
        if item.get("internal"):
            continue
        original = (item["name"], item["version"])
        canonical = alias_targets.get(original, original)
        canonical_presence[canonical] = canonical_presence.get(canonical, False) or bool(item["exists"])
        if canonical != original:
            alias_records.append({"observed": package_key(*original), "canonical": package_key(*canonical), "exists": bool(item["exists"])})
    return canonical_presence, sorted(alias_records, key=lambda item: item["observed"])


def desktop_reachability(desktop: str, nodes: dict[str, dict], edges: list[dict]) -> dict[str, set[str]]:
    adjacency: dict[str, list[dict]] = defaultdict(list)
    for edge in edges:
        if edge["ecosystem"] == "cargo" and "windows_default" in edge["profiles"]:
            adjacency[edge["from"]].append(edge)
    classes: dict[str, set[str]] = defaultdict(set)
    queue = deque([(desktop, (False, False, False))])
    visited = {(desktop, (False, False, False))}
    while queue:
        parent, state = queue.popleft()
        test, build, optional = state
        if test:
            classes[parent].add("test")
        if build:
            classes[parent].add("build_or_proc_macro")
        if optional:
            classes[parent].add("optional")
        if not any(state):
            classes[parent].add("normal")
        for edge in adjacency.get(parent, []):
            child = edge["to"]
            next_state = (test or edge["kind"] == "dev",
                          build or edge["kind"] == "build" or nodes[child].get("proc_macro", False),
                          optional or edge.get("optional") is True)
            pair = (child, next_state)
            if pair not in visited:
                visited.add(pair)
                queue.append(pair)
    return classes


def generate(phase: str) -> dict:
    phase_dir = AUDIT / phase
    capture_receipt_verified = verify_capture_receipt(phase_dir)
    profiles = {name: read_json(phase_dir / filename) for name, filename in PROFILES.items()}
    pnpm_lock = read_json(phase_dir / "pnpm-lock.json")
    cargo_lock = read_json(phase_dir / "cargo-lock.json")
    direct = read_json(phase_dir / "direct-census.json")
    presence = read_json(phase_dir / "installed-presence.json")
    phase_registry = phase_dir / "npm-registry.json"
    registry_source = phase_registry if phase_registry.exists() else AUDIT / "npm-registry.json"
    registry = read_json(registry_source)
    rustsec, deny, pnpm_findings, scanner_summary = scanner_findings(phase_dir)
    nodes: dict[str, dict] = {}
    edges: list[dict] = []
    cargo_idmap, cargo_members = cargo_graph(profiles, cargo_lock, nodes, edges, rustsec, deny, scanner_summary["availability"])
    pnpm_importers = pnpm_graph(pnpm_lock, nodes, edges, registry, presence, pnpm_findings, scanner_summary["availability"])
    canonical_presence, alias_presence_records = reconcile_presence_aliases(presence, nodes, edges)
    for node in nodes.values():
        if node["ecosystem"] == "pnpm" and node["scope"] == "locked_snapshot":
            node["installed_presence"] = canonical_presence.get((node["name"], node["version"]))

    island_root = "root:npm-island:scripts/visual"
    island_decl = next((d for d in direct if d["ecosystem"] == "npm-island" and d["name"] == "pngjs"), None)
    if island_decl is None:
        raise ValueError("npm island pngjs direct census missing")
    island_version = island_decl["resolved"]["version"]
    island_node = f"npm-island:pngjs@{island_version}"
    add_node(nodes, {"id": island_root, "ecosystem": "npm-island", "name": "scripts/visual", "version": None, "scope": "island_root", "purpose": "Visual report script npm island", "license": None, "upstream": None,
                     "scanner_disposition": {"interpretation": "island package-lock root"}})
    island_rec = registry_record(registry, "pngjs", island_version)
    add_node(nodes, {"id": island_node, "ecosystem": "npm-island", "name": "pngjs", "version": island_version, "scope": "locked_island_package",
                      "source": {"package_lock_resolved": island_decl["resolved"].get("resolved"),
                                 "package_lock_integrity": island_decl["resolved"].get("integrity"),
                                 "registry_metadata_url": island_rec.get("url"),
                                 "registry_dist_integrity": island_rec.get("distIntegrity")},
                      "purpose": island_rec.get("description") or "PNG encoder/decoder for visual reports", "license": island_rec.get("license") or island_decl["resolved"].get("license"),
                      "purpose_basis": "published registry description" if island_rec.get("description") else "curated from source import and upstream package identity",
                      "review_primary_packet": "P10/P11",
                      "review_status": "resolver-mapped; package metadata and scanner input reviewed where available",
                      "review_depth": "resolver/published-metadata/scanner review; no exhaustive upstream source audit",
                     "upstream": upstream_url(island_rec.get("repository"), island_rec.get("url") or "https://www.npmjs.com/package/pngjs"),
                     "build_scripts": {k: v for k, v in (island_rec.get("scripts") or {}).items() if k in ("preinstall", "install", "postinstall", "prepare", "build", "prepack")},
                     "installed_presence": None, "scanner_disposition": {"npm_audit": [],
                     "npm_audit_status": "scanned" if scanner_summary["availability"]["npm_island"] else "unscanned",
                     "interpretation": "isolated npm audit findings are captured if supplied; installed path not established"}})
    add_edge(edges, {"from": island_root, "to": island_node, "ecosystem": "npm-island", "kind": "dependencies", "dependency_alias": "pngjs", "specifier": island_decl["declaration"], "resolved": island_version, "optional": False, "peer_context": None, "target_cfg": None, "evidence": "direct-census npm-island"})

    for edge in edges:
        if edge["to"] is None:
            continue
        nodes[edge["from"]]["children"].append(edge["id"])
        nodes[edge["to"]]["parents"].append(edge["id"])
    adjacency: dict[str, list[dict]] = defaultdict(list)
    for edge in edges:
        if edge["to"]:
            adjacency[edge["from"]].append(edge)

    declarations = []
    unresolved = []
    for n, item in enumerate(direct, 1):
        eco = item["ecosystem"]
        if eco == "cargo":
            root = cargo_members.get(item["consumer"])
            candidates = [e for e in adjacency.get(root, []) if e["ecosystem"] == "cargo" and "all_features" in e["profiles"] and e["dependency_alias"] == cargo_alias(item.get("metadata", {}).get("rename") or item["name"]) and e["kind"] == (item.get("metadata", {}).get("kind") or "normal") and e["target_cfg"] == item.get("target")]
            target_ids = sorted({e["to"] for e in candidates if e["to"]})
        elif eco == "pnpm":
            importer = posixpath.dirname(item["manifest"])
            importer = "." if importer in ("", ".") else importer
            root = pnpm_importers.get(importer)
            resolved_version = (item.get("resolved") or {}).get("version")
            found = [e for e in adjacency.get(root, [])
                     if e["dependency_alias"] == item["name"]
                     and (e["kind"] == item["section"] or
                          (item["section"] == "peerDependencies" and e["kind"] in ("dependencies", "devDependencies", "optionalDependencies")
                           and e["resolved"] == resolved_version))]
            target_ids = sorted({e["to"] for e in found if e["to"]})
        else:
            root, target_ids = island_root, [island_node]
        declaration_id = f"direct:{eco}:{n:03d}"
        metadata = dict(item.get("metadata") or {})
        if metadata.get("path"):
            metadata["path"] = relative_manifest(metadata["path"]) or "<outside-workspace>"
        decl = {"id": declaration_id, "ecosystem": eco, "root": root, "resolved_nodes": target_ids,
                "consumer": item["consumer"], "manifest": item["manifest"], "name": item["name"], "section": item["section"],
                "resolved_sections": item.get("resolved_sections"),
                "target_cfg": item.get("target"), "declared": item.get("declaration"), "effective": item.get("effective"),
                "resolved": item.get("resolved"), "metadata": metadata}
        declarations.append(decl)
        if not target_ids:
            unresolved.append(declaration_id)
        for target in target_ids:
            nodes[target]["direct_declarations"].append(declaration_id)

    for decl in declarations:
        for target in decl["resolved_nodes"]:
            if decl["ecosystem"] == "cargo":
                reachable = closure(target, adjacency, lambda e: e["ecosystem"] == "cargo" and "all_features" in e.get("profiles", []))
            else:
                reachable = closure(target, adjacency, lambda e: e["ecosystem"] == decl["ecosystem"] or (decl["ecosystem"] == "pnpm" and e["ecosystem"] == "pnpm"))
            for node_id in reachable:
                node = nodes[node_id]
                node["introducing_direct_declarations"].append(decl["id"])
                node["root_scopes"].append(decl["root"])

    for node in nodes.values():
        node["direct_declarations"] = sorted(set(node["direct_declarations"]))
        node["introducing_direct_declarations"] = sorted(set(node["introducing_direct_declarations"]))
        node["root_scopes"] = sorted(set(node["root_scopes"]))

    roots = sorted([n["id"] for n in nodes.values() if n["scope"] in ("workspace", "workspace_importer", "island_root")])
    for root in roots:
        nodes[root]["root_scopes"] = sorted(set(nodes[root]["root_scopes"] + [root]))
    declarations_by_id = {decl["id"]: decl for decl in declarations}
    for node in nodes.values():
        node["update_disposition"] = update_disposition(node, declarations_by_id)

    desktop = cargo_members["tracepilot-desktop"]
    desktop_windows = desktop_reachability(desktop, nodes, edges)
    cargo_default_adj: dict[str, list[dict]] = defaultdict(list)
    cargo_all_adj: dict[str, list[dict]] = defaultdict(list)
    for edge in edges:
        if edge["ecosystem"] == "cargo":
            if "all_features" in edge["profiles"]:
                cargo_all_adj[edge["from"]].append(edge)
            if "default_all_targets" in edge["profiles"]:
                cargo_default_adj[edge["from"]].append(edge)
    all_desktop = closure(desktop, cargo_all_adj)
    default_desktop = closure(desktop, cargo_default_adj)
    for node_id, node in nodes.items():
        if node["ecosystem"] == "cargo":
            node["desktop_reachability"] = {
                "windows_default_classes": sorted(desktop_windows.get(node_id, [])),
                "default_all_targets": node_id in default_desktop,
                "all_features_all_targets": node_id in all_desktop,
                "all_features_only_vs_default": node_id in all_desktop and node_id not in default_desktop,
            }

    cargo_nodes = [n for n in nodes.values() if n["ecosystem"] == "cargo"]
    pnpm_nodes = [n for n in nodes.values() if n["ecosystem"] == "pnpm" and n["scope"] == "locked_snapshot"]
    descriptions_unavailable = sorted(n["id"] for n in pnpm_nodes if not registry_record(registry, n["name"], n["version"]).get("description"))
    purposes_unknown = sorted(n["id"] for n in pnpm_nodes if n["purpose_basis"].startswith("unknown"))
    licenses_unavailable = sorted(n["id"] for n in cargo_nodes + pnpm_nodes if n.get("license") is None)
    registry_records_unavailable = sorted(n["id"] for n in pnpm_nodes if not registry_record(registry, n["name"], n["version"]) or registry_record(registry, n["name"], n["version"]).get("error"))
    presence_records = set(canonical_presence)
    locked_packages = {(n["name"], n["version"]) for n in pnpm_nodes}
    excess_presence = sorted(package_key(*pair) for pair in presence_records - locked_packages)
    missing_presence = sorted(package_key(*pair) for pair in locked_packages - presence_records)
    missing_edges = [e["id"] for e in edges if e["to"] is None]
    if missing_edges or unresolved:
        raise ValueError(f"incomplete graph: unresolved edges {missing_edges[:10]}, direct declarations {unresolved[:10]}")
    counts = {
        "cargo_lock_packages": len(cargo_lock["package"]), "cargo_all_features_nodes": len(cargo_nodes),
        "cargo_default_metadata_packages": len(profiles["default_all_targets"]["packages"]),
        "cargo_windows_metadata_packages": len(profiles["windows_default"]["packages"]),
        "cargo_linux_metadata_packages": len(profiles["linux_default"]["packages"]),
        "cargo_macos_metadata_packages": len(profiles["macos_default"]["packages"]),
        "pnpm_lock_packages": len(pnpm_lock["packages"]), "pnpm_lock_snapshots": len(pnpm_nodes),
        "pnpm_local_presence_true": sum(n["installed_presence"] is True for n in pnpm_nodes),
        "pnpm_local_presence_false": sum(n["installed_presence"] is False for n in pnpm_nodes),
        "pnpm_local_presence_unknown": sum(n["installed_presence"] is None for n in pnpm_nodes),
        "pnpm_presence_records_external": len(presence_records),
        "pnpm_presence_alias_records": len(alias_presence_records),
        "pnpm_presence_records_not_locked": len(excess_presence),
        "pnpm_locked_packages_without_presence_record": len(missing_presence),
        "pnpm_description_unavailable": len(descriptions_unavailable),
        "pnpm_purpose_unknown": len(purposes_unknown),
        "license_unavailable": len(licenses_unavailable),
        "pnpm_registry_records_unavailable": len(registry_records_unavailable),
        "npm_island_locked_nodes": 1, "direct_census": len(direct),
        "direct_census_by_ecosystem": dict(Counter(d["ecosystem"] for d in direct)),
        "edges": len(edges), "unresolved_edges": len(missing_edges), "unresolved_direct_declarations": len(unresolved),
        "desktop_windows_normal_nodes": sum("normal" in v for v in desktop_windows.values()),
        "desktop_windows_build_or_proc_macro_nodes": sum("build_or_proc_macro" in v for v in desktop_windows.values()),
        "desktop_windows_test_nodes": sum("test" in v for v in desktop_windows.values()),
        "desktop_windows_optional_nodes": sum("optional" in v for v in desktop_windows.values()),
        "desktop_all_features_only_nodes": len(all_desktop - default_desktop),
    }
    if counts["cargo_lock_packages"] != counts["cargo_all_features_nodes"]:
        raise ValueError("Cargo lock/all-features metadata populations diverge")
    snapshot_packages = {package_key(node["name"], node["version"]) for node in pnpm_nodes}
    uncovered_packages = sorted(set(pnpm_lock["packages"]) - snapshot_packages)
    if uncovered_packages:
        raise ValueError(f"pnpm packages without a snapshot context: {uncovered_packages[:10]}")
    return {
        "schema_version": 3, "phase": phase,
        "provenance": {"baseline_or_final_dir": f".agent/dependency-audit/{phase}", "captured_metadata": list(PROFILES.values()),
                       "census": "direct-census.json", "installed_presence": "installed-presence.json", "locked_npm_registry_metadata": registry_source.relative_to(ROOT).as_posix(),
                       "capture_receipt_verified": capture_receipt_verified,
                       "scanner_lock_binding": "scanner receipts record command/time/exit but do not cryptographically bind reports to lockfile bytes"},
        "counts": counts,
        "lock_reconciliation": {
            "cargo_lock_equals_all_features_metadata": counts["cargo_lock_packages"] == counts["cargo_all_features_nodes"],
            "pnpm_packages_equal_snapshot_contexts": counts["pnpm_lock_packages"] == counts["pnpm_lock_snapshots"],
            "pnpm_package_metadata_covered_by_snapshots": not uncovered_packages,
            "pnpm_extra_peer_context_snapshots": counts["pnpm_lock_snapshots"] - counts["pnpm_lock_packages"],
            "pnpm_presence_records_not_locked": excess_presence,
            "pnpm_locked_packages_without_presence_record": missing_presence,
            "pnpm_alias_presence_records": alias_presence_records,
            "presence_note": "Only exists=true in installed-presence.json is locally present. Alias names are reconciled to canonical locked package identities. Presence is per name/version, not proof that every peer-context snapshot is installed.",
        },
        "scanner_summary": scanner_summary,
        "roots": roots, "nodes": sorted(nodes.values(), key=lambda n: n["id"]), "edges": edges, "direct_declarations": declarations,
        "unknowns": [
            "Graph edges are resolver/lock edges, not a deep human source-use audit. Purpose comes from published metadata and must not be read as a source callsite finding.",
            "Cargo all-features metadata spans all targets; Windows/default metadata is a separate resolver view. all_features_only_vs_default is feature-union evidence, not proof of a Windows runtime dependency.",
            "Cargo desktop Windows classes follow default Windows resolver edges. A package can have multiple classes through different paths; build/proc macro and test edges do not imply shipment in the desktop binary.",
            "npm/pnpm audit findings are lock-scanner results, not proof a conditional code path is exploitable or a package is installed on this host.",
            "pnpm installed-presence captures path existence only. pnpm list output can enumerate absent platform artifacts; unknown existence is never treated as installed.",
            "Peer-context edges record provider selection encoded in pnpm snapshot keys; they are not normal dependency edges, and a peer context may reflect a transitive rather than directly declared peer.",
            "Scanner report presence is not cryptographic proof of lockfile correspondence; compare scan receipts and capture hashes before claiming a final finding count.",
            f"Npm locked metadata records unavailable: {registry_records_unavailable}" if registry_records_unavailable else "All pnpm locked package metadata records were fetched or supplied by cache.",
            f"Published npm descriptions unavailable for: {descriptions_unavailable}",
            f"Purpose still unknown for: {purposes_unknown}",
            f"License unavailable for: {licenses_unavailable}",
            f"Unresolved edge IDs: {missing_edges[:30]}" if missing_edges else "No unresolved resolver edges.",
            f"Unresolved direct IDs: {unresolved}" if unresolved else "All census declarations mapped to at least one graph node.",
        ],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("phase", choices=("baseline", "final"))
    args = parser.parse_args()
    graph = generate(args.phase)
    target = ROOT / ".agent" / "dependency-audit" / args.phase / "graph.json"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(graph, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"{target.relative_to(ROOT).as_posix()}: {graph['counts']}")


if __name__ == "__main__":
    main()
