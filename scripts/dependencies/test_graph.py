#!/usr/bin/env python3
"""Synthetic resolver tests and opt-in invariants for locally generated graphs."""

from __future__ import annotations

import argparse
import importlib.util
import json
import re
import sys
import unittest
from pathlib import Path


HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
spec = importlib.util.spec_from_file_location("generate_graph", HERE / "generate_graph.py")
graph_module = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(graph_module)
capture_spec = importlib.util.spec_from_file_location("capture_inputs", HERE / "capture_inputs.py")
capture_module = importlib.util.module_from_spec(capture_spec)
assert capture_spec.loader is not None
capture_spec.loader.exec_module(capture_module)


class GraphInvariants(unittest.TestCase):
    paths: list[Path] = []

    @classmethod
    def setUpClass(cls) -> None:
        if not cls.paths:
            raise unittest.SkipTest("Pass --graph PATH to validate a local capture")
        cls.graphs = {
            str(path): json.loads(path.read_text(encoding="utf-8"))
            for path in cls.paths
        }

    def test_locked_populations_and_direct_edges_reconcile(self) -> None:
        for phase, graph in self.graphs.items():
            with self.subTest(phase=phase):
                self.assertEqual(graph["schema_version"], 3)
                counts = graph["counts"]
                self.assertEqual(counts["npm_island_locked_nodes"], 1)
                self.assertEqual(counts["direct_census"], len(graph["direct_declarations"]))
                self.assertEqual(counts["unresolved_edges"], 0)
                self.assertEqual(counts["unresolved_direct_declarations"], 0)
                self.assertTrue(all(decl["resolved_nodes"] for decl in graph["direct_declarations"]))
                self.assertGreaterEqual(counts["pnpm_lock_snapshots"], counts["pnpm_lock_packages"])

    def test_locked_nodes_preserve_source_and_integrity(self) -> None:
        for phase, graph in self.graphs.items():
            for node in graph["nodes"]:
                with self.subTest(phase=phase, node=node["id"]):
                    if node["ecosystem"] == "cargo" and node["scope"] == "workspace":
                        self.assertEqual(node["source"], node["workspace_manifest"])
                        self.assertFalse(Path(node["source"]).is_absolute())
                        self.assertIsNone(node["lock_checksum"])
                    elif node["ecosystem"] == "cargo" and node["scope"] == "registry":
                        self.assertTrue(node["source"].startswith("registry+"))
                        self.assertRegex(node["lock_checksum"], r"^[0-9a-f]{64}$")
                    elif node["ecosystem"] == "pnpm" and node["scope"] == "locked_snapshot":
                        self.assertTrue(node["source"]["lock_resolution"]["integrity"])
                        self.assertTrue(node["source"]["registry_metadata_url"])
                    elif node["ecosystem"] == "npm-island" and node["scope"] == "locked_island_package":
                        self.assertTrue(node["source"]["package_lock_resolved"])
                        self.assertTrue(node["source"]["package_lock_integrity"])

    def test_every_node_has_bounded_update_and_security_disposition(self) -> None:
        for phase, graph in self.graphs.items():
            direct_ids = {decl["id"] for decl in graph["direct_declarations"]}
            for node in graph["nodes"]:
                with self.subTest(phase=phase, node=node["id"]):
                    self.assertIn("update_disposition", node)
                    disposition = node["update_disposition"]
                    self.assertIn(disposition["scope"], ("first_party_root", "direct", "transitive"))
                    self.assertTrue(disposition["decision"])
                    self.assertTrue(disposition["basis"])
                    self.assertTrue(disposition["source_reference"])
                    self.assertTrue(disposition["security_status"])
                    self.assertTrue(set(disposition["introducing_direct_ids"]) <= direct_ids)
                    if node["scope"] in ("registry", "locked_snapshot", "locked_island_package"):
                        self.assertTrue(disposition["introducing_direct_ids"])
                    if disposition["scope"] == "transitive":
                        self.assertEqual(disposition["latest_research"], "not_individually_verified")
                        self.assertEqual(disposition["direct_ids"], [])
                    if disposition["scanner_finding_ids"]:
                        self.assertEqual(disposition["security_status"], "recorded_scanner_finding")
                        self.assertIn("docs/dependencies/security.md", disposition["source_reference"])

    def test_every_edge_is_bidirectional_and_resolved(self) -> None:
        for phase, graph in self.graphs.items():
            nodes = {node["id"]: node for node in graph["nodes"]}
            for edge in graph["edges"]:
                with self.subTest(phase=phase, edge=edge["id"]):
                    self.assertIn(edge["from"], nodes)
                    self.assertIn(edge["to"], nodes)
                    self.assertIn(edge["id"], nodes[edge["from"]]["children"])
                    self.assertIn(edge["id"], nodes[edge["to"]]["parents"])

    def test_resolver_aliases_and_optional_paths_are_retained(self) -> None:
        for phase, graph in self.graphs.items():
            edges = graph["edges"]
            with self.subTest(phase=phase):
                self.assertTrue(any(edge["ecosystem"] == "cargo" and edge["dependency_alias"] == "tauri_plugin_updater"
                                    and edge["to"].startswith("cargo:registry:tauri-plugin-updater@") for edge in edges))
                self.assertTrue(any(edge["ecosystem"] == "pnpm" and edge["dependency_alias"] == "string-width-cjs"
                                    and edge["to"] == "pnpm:string-width@4.2.3" for edge in edges))
                self.assertTrue(any(edge["ecosystem"] == "cargo" and edge["optional"] is True for edge in edges))
                self.assertGreater(graph["counts"]["desktop_windows_optional_nodes"], 0)
                peer_edges = [edge for edge in edges if edge["kind"] == "peer_context"]
                self.assertTrue(peer_edges)
                for edge in peer_edges:
                    self.assertEqual(edge["to"], "pnpm:" + edge["peer_context"])
                    self.assertIn(edge["peer_context"], graph_module.peer_providers(edge["from"].removeprefix("pnpm:")))

    def test_direct_pnpm_declarations_map_to_correct_importer_section(self) -> None:
        for phase, graph in self.graphs.items():
            by_root = {}
            for edge in graph["edges"]:
                if edge["ecosystem"] == "pnpm" and edge["from"].startswith("root:pnpm:"):
                    by_root.setdefault(edge["from"], []).append(edge)
            for declaration in graph["direct_declarations"]:
                if declaration["ecosystem"] != "pnpm":
                    continue
                matching = [edge for edge in by_root.get(declaration["root"], [])
                            if edge["dependency_alias"] == declaration["name"]
                            and edge["to"] in declaration["resolved_nodes"]]
                with self.subTest(phase=phase, declaration=declaration["id"]):
                    self.assertTrue(matching)
                    if declaration["section"] != "peerDependencies":
                        self.assertTrue(all(edge["kind"] == declaration["section"] for edge in matching))

    def test_roots_reachability_and_private_paths(self) -> None:
        for phase, graph in self.graphs.items():
            with self.subTest(phase=phase):
                nodes = {node["id"]: node for node in graph["nodes"]}
                self.assertEqual(len(graph["roots"]), 17)
                for root in graph["roots"]:
                    self.assertIn(root, nodes[root]["root_scopes"])
                desktop = next(node for node in nodes.values()
                               if node["scope"] == "workspace" and node["name"] == "tracepilot-desktop")
                self.assertIn("normal", desktop["desktop_reachability"]["windows_default_classes"])
                self.assertFalse(re.search(r"[A-Za-z]:\\\\", json.dumps(graph)))

    def test_transitive_review_depth_and_curated_purpose_are_explicit(self) -> None:
        for phase, graph in self.graphs.items():
            transitive = [node for node in graph["nodes"]
                          if node["scope"] in ("registry", "locked_snapshot", "locked_island_package")]
            self.assertTrue(transitive)
            for node in transitive:
                with self.subTest(phase=phase, node=node["id"]):
                    self.assertTrue(node["review_primary_packet"])
                    self.assertIn("no exhaustive upstream source audit", node["review_depth"])
                    self.assertTrue(node["review_status"])
                    if node["ecosystem"] == "pnpm" and node["purpose_basis"].startswith("curated"):
                        self.assertTrue(node["upstream"].startswith(("https://", "git+https://")))


class SyntheticResolverTests(unittest.TestCase):
    def test_cargo_same_name_version_from_distinct_sources_is_rejected(self) -> None:
        def package(source: str) -> dict:
            return {"id": f"{source}#same@1.0.0", "name": "same", "version": "1.0.0",
                    "source": source, "targets": []}

        sources = ["registry+https://example.test/first", "registry+https://example.test/second"]
        profiles = {"all_features": {"workspace_members": [], "packages": [package(source) for source in sources],
                                    "resolve": {"nodes": []}}}
        lock = {"package": [{"name": "same", "version": "1.0.0", "source": source,
                             "checksum": "a" * 64} for source in sources]}
        with self.assertRaisesRegex(ValueError, "Cargo graph ID collision"):
            graph_module.cargo_graph(profiles, lock, {}, [], {}, {}, {"rustsec": False, "cargo_deny": False})

    def test_pnpm_lock_and_registry_integrity_mismatch_is_rejected(self) -> None:
        lock = {"importers": {}, "packages": {"example@1.0.0": {"resolution": {"integrity": "sha512-lock"}}},
                "snapshots": {"example@1.0.0": {}}}
        registry = {"example@1.0.0": {"distIntegrity": "sha512-published"}}
        with self.assertRaisesRegex(ValueError, "pnpm lock/registry integrity mismatch"):
            graph_module.pnpm_graph(lock, {}, [], registry, [], {}, {"pnpm_full": False, "pnpm_prod": False})

    def test_nested_peer_contexts_and_multiple_snapshots(self) -> None:
        key = "consumer@1.0.0(peer@1.0.0(nested@2.0.0))(other@3.0.0)"
        self.assertEqual(graph_module.peer_providers(key), ["peer@1.0.0(nested@2.0.0)", "other@3.0.0"])
        lock = {
            "importers": {".": {"dependencies": {"consumer": {"version": "1.0.0(peer@1.0.0)"}}}},
            "packages": {"consumer@1.0.0": {}, "peer@1.0.0": {}, "peer@2.0.0": {}},
            "snapshots": {"consumer@1.0.0(peer@1.0.0)": {}, "consumer@1.0.0(peer@2.0.0)": {},
                          "peer@1.0.0": {}, "peer@2.0.0": {}},
        }
        nodes: dict[str, dict] = {}
        edges: list[dict] = []
        graph_module.pnpm_graph(lock, nodes, edges, {}, [], {}, {"pnpm_full": False, "pnpm_prod": False})
        self.assertEqual(len(lock["packages"]), 3)
        self.assertEqual(len([node for node in nodes.values() if node["scope"] == "locked_snapshot"]), 4)
        providers = {(edge["from"], edge["to"]) for edge in edges if edge["kind"] == "peer_context"}
        self.assertEqual(providers, {
            ("pnpm:consumer@1.0.0(peer@1.0.0)", "pnpm:peer@1.0.0"),
            ("pnpm:consumer@1.0.0(peer@2.0.0)", "pnpm:peer@2.0.0"),
        })

    def test_alias_presence_reconciles_to_canonical_identity(self) -> None:
        nodes = {"pnpm:real@1.0.0": {"scope": "locked_snapshot", "name": "real", "version": "1.0.0"}}
        edges = [{"ecosystem": "pnpm", "kind": "normal", "dependency_alias": "alias",
                  "to": "pnpm:real@1.0.0"}]
        presence, aliases = graph_module.reconcile_presence_aliases(
            [{"name": "alias", "version": "1.0.0", "exists": True, "internal": False}], nodes, edges
        )
        self.assertEqual(presence, {("real", "1.0.0"): True})
        self.assertEqual(aliases[0]["canonical"], "real@1.0.0")

    def test_presence_checks_real_paths(self) -> None:
        sample = [{"dependencies": {
            "present": {"version": "1.0.0", "path": str(ROOT)},
            "absent": {"version": "1.0.0", "path": str(ROOT / ".agent" / "__missing_package__")},
        }}]
        result = {row["name"]: row for row in capture_module.installed_presence(sample)}
        self.assertTrue(result["present"]["exists"])
        self.assertFalse(result["absent"]["exists"])

    def test_capture_source_hashes_include_every_pnpm_importer_manifest(self) -> None:
        lock = {"importers": {".": {}, "apps/cli": {}, "packages/ui": {}}}
        workspace = {"workspace": {"members": ["crates/tracepilot-core"]}}
        files = {path.relative_to(ROOT).as_posix() for path in capture_module.source_input_files(lock, workspace)}
        self.assertIn("package.json", files)
        self.assertIn("apps/cli/package.json", files)
        self.assertIn("packages/ui/package.json", files)
        self.assertIn("pnpm-workspace.yaml", files)
        self.assertIn("crates/tracepilot-core/Cargo.toml", files)

    def test_yaml_parser_uses_declared_root_dependency(self) -> None:
        workspace = capture_module.read_yaml(ROOT / "pnpm-workspace.yaml")
        self.assertIn("apps/*", workspace["packages"])
        self.assertFalse(workspace["allowBuilds"]["lefthook"])
        self.assertIn("vite", workspace["catalog"])


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--graph", type=Path, action="append", default=[],
                        help="Generated graph to validate; repeat to compare captures")
    args, unittest_args = parser.parse_known_args()
    GraphInvariants.paths = args.graph
    unittest.main(argv=[sys.argv[0], *unittest_args])
