"""Small synthetic contracts; never opens the operator's database."""
import contextlib
import copy
import io
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

from measure import correctness, table_stats
from plans import digest_query
from report import resolve_source_revision, validate_measurements
from schema import ROOT, inventory, source_schema
from snapshot import gate, sha256, snapshot


class AuditTests(unittest.TestCase):
    def publication_fixture(self):
        conn, _ = source_schema()
        try:
            schema = inventory(conn)
            names = ['sqlite_schema'] + [o['name'] for o in schema['objects'] if o['rootpage'] > 0]
            objects = [{'name': name, 'pages': 1, 'allocated_bytes': 4096,
                        'payload_bytes': 0, 'unused_bytes': 4000, 'overflow_pages': 0,
                        'overflow_bytes': 0, 'max_cell_payload_bytes': 0} for name in names]
            return {'finished_utc': 'synthetic', 'correctness': correctness(conn, schema),
                    'storage': {'objects': objects, 'page_count': len(objects), 'page_size': 4096,
                                'freelist_count': 0, 'auto_vacuum': 0, 'sqlite_version': 'synthetic',
                                'non_btree_non_freelist_bytes': 0}, 'schema': schema,
                    'tables': {name: table_stats(conn, name, table) for name, table in schema['tables'].items()}}
        finally:
            conn.close()

    def test_source_schema_includes_hidden_and_constraint_indexes(self):
        conn, versions = source_schema()
        try:
            schema = inventory(conn)
            self.assertEqual(versions, [n for n in range(1, 26) if n != 12])
            self.assertEqual(len(schema['tables']['sessions']['columns']), 42)
            self.assertEqual(len(schema['tables']['session_agent_runs']['columns']), 40)
            self.assertEqual(sum(c['hidden'] == 1 for c in schema['tables']['search_fts']['columns']), 2)
            self.assertEqual(schema['tables']['search_fts_idx']['without_rowid'], 1)
            self.assertTrue(schema['tables']['session_segments']['foreign_keys'])
        finally:
            conn.close()

    def test_null_mixed_type_empty_and_sensitive_value_stats(self):
        conn = sqlite3.connect(':memory:')
        try:
            conn.execute('CREATE TABLE sample(value)')
            conn.executemany('INSERT INTO sample VALUES (?)', [(None,), ('',), (0,), (1.5,), ('private-secret',), ('private-secret',), (b'opaque',)])
            report = table_stats(conn, 'sample', inventory(conn)['tables']['sample'])
            value = report['columns']['value']
            self.assertEqual((value['null_count'], value['nonnull_count'], value['distinct_nonnull']), (1, 6, 5))
            self.assertEqual(value['most_common_nonnull_count'], 2)
            self.assertEqual(value['type_text'], 3)
            self.assertEqual(value['empty_text'], 1)
            self.assertEqual(value['zero_numeric'], 1)
            self.assertNotIn('private-secret', json.dumps(report))
            conn.execute('DELETE FROM sample')
            value = table_stats(conn, 'sample', inventory(conn)['tables']['sample'])['columns']['value']
            self.assertIsNone(value['null_percent'])
            self.assertEqual(value['distinct_nonnull'], 0)
        finally:
            conn.close()

    def test_online_backup_captures_committed_wal_and_source_is_unchanged(self):
        parent = ROOT / '.agent/sqlite-audit-tests'
        parent.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=parent) as folder:
            folder = Path(folder)
            source = folder / 'source.db'
            writer = sqlite3.connect(source)
            try:
                writer.execute('PRAGMA journal_mode=WAL')
                writer.execute('PRAGMA wal_autocheckpoint=0')
                writer.execute('CREATE TABLE schema_version(version INTEGER NOT NULL)')
                writer.execute('INSERT INTO schema_version VALUES (25)')
                writer.commit()
                hashes = [sha256(source), sha256(str(source) + '-wal')]
                coordinator = folder / 'gate.json'
                coordinator.write_text('{"allowHeavyAudit":true}', encoding='utf-8')
                with contextlib.redirect_stdout(io.StringIO()):
                    snapshot(source, folder / 'frozen.db', coordinator)
                with contextlib.closing(sqlite3.connect(folder / 'frozen.db')) as frozen:
                    self.assertEqual(frozen.execute('SELECT version FROM schema_version').fetchone()[0], 25)
                self.assertEqual(hashes, [sha256(source), sha256(str(source) + '-wal')])
            finally:
                writer.close()

    def test_false_gate_stops_before_source_access(self):
        parent = ROOT / '.agent/sqlite-audit-tests'
        parent.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=parent) as folder:
            path = Path(folder) / 'gate.json'
            path.write_text('{"allowHeavyAudit":false}', encoding='utf-8')
            with self.assertRaisesRegex(RuntimeError, 'quiet window'):
                gate(path)
            with self.assertRaisesRegex(RuntimeError, 'quiet window'):
                snapshot(Path(folder) / 'missing.db', Path(folder) / 'out.db', path)

    def test_publication_rejects_incomplete_measurements(self):
        data = self.publication_fixture()
        validate_measurements(data)
        del data['tables']['sessions']['columns']['path']
        with self.assertRaisesRegex(ValueError, 'column coverage'):
            validate_measurements(data)
        del data['finished_utc']
        with self.assertRaisesRegex(ValueError, 'Incomplete measurement'):
            validate_measurements(data)

    def test_publication_rejects_missing_results_and_required_statistics(self):
        fixture = self.publication_fixture()
        for section in ('storage', 'correctness'):
            with self.subTest(section=section):
                data = copy.deepcopy(fixture)
                data[section] = {}
                with self.assertRaisesRegex(ValueError, section):
                    validate_measurements(data)
        for field in ('most_common_nonnull_count', 'numeric_min', 'numeric_max', 'numeric_avg'):
            with self.subTest(field=field):
                data = copy.deepcopy(fixture)
                del data['tables']['sessions']['columns']['total_tokens'][field]
                with self.assertRaisesRegex(ValueError, 'statistic'):
                    validate_measurements(data)
        data = copy.deepcopy(fixture)
        del data['correctness']['bad_segment_model_json']
        with self.assertRaisesRegex(ValueError, 'correctness'):
            validate_measurements(data)
        data = copy.deepcopy(fixture)
        data['storage']['objects'][0].pop('payload_bytes')
        with self.assertRaisesRegex(ValueError, 'storage'):
            validate_measurements(data)
        data = copy.deepcopy(fixture)
        data['storage']['non_btree_non_freelist_bytes'] = 4096
        with self.assertRaisesRegex(ValueError, 'storage'):
            validate_measurements(data)

    def test_numeric_result_output_requires_reviewed_opt_in(self):
        with contextlib.closing(sqlite3.connect(':memory:')) as conn:
            conn.executescript('CREATE TABLE sample(id INTEGER); INSERT INTO sample VALUES (7319)')
            sql = 'SELECT COUNT(*), MIN(id) FROM sample'
            result = digest_query(conn, sql, [])
            self.assertIsNone(result['scalar_counts'])
            reviewed = digest_query(conn, 'SELECT COUNT(*) FROM sample', [],
                                    reviewed_numeric_aggregate_output=True)
            self.assertEqual(reviewed['scalar_counts'], [1])
            text = digest_query(conn, "SELECT COUNT(*), 'private-secret' FROM sample", [],
                                reviewed_numeric_aggregate_output=True)
            self.assertIsNone(text['scalar_counts'])

    def test_revision_provenance_requires_valid_unambiguous_source(self):
        revision = 'a1' * 20
        self.assertEqual(resolve_source_revision({'source_revision': revision}), revision)
        self.assertEqual(resolve_source_revision({}, revision), revision)
        self.assertEqual(resolve_source_revision({'source_revision': revision}, revision.upper()), revision)
        with self.assertRaisesRegex(ValueError, 'Missing source revision'):
            resolve_source_revision({})
        with self.assertRaisesRegex(ValueError, 'Conflicting source revisions'):
            resolve_source_revision({'source_revision': revision}, 'b2' * 20)
        for malformed in (None, '', 'a1', 'g' * 40, 19):
            with self.subTest(recorded=malformed):
                with self.assertRaisesRegex(ValueError, 'Malformed source revision'):
                    resolve_source_revision({'source_revision': malformed}, revision)
        for malformed in ('a1', 'g' * 40, 19):
            with self.subTest(fallback=malformed):
                with self.assertRaisesRegex(ValueError, 'Malformed source revision'):
                    resolve_source_revision({}, malformed)


if __name__ == '__main__':
    unittest.main()
