"""Serial, bounded, aggregate-only measurements of a validated frozen snapshot."""
import argparse
import json
import os
import shutil
import sqlite3
import subprocess
import time
from pathlib import Path

from schema import ROOT, inventory, quote, write_json
from snapshot import gate, ignored, readonly, sha256, utc
from budget import Budget

ACTIVE_BUDGET = None


def bounded(conn, sql, timeout=180):
    deadline = time.monotonic() + timeout
    last_check = [0.0]

    def stop():
        if ACTIVE_BUDGET and ACTIVE_BUDGET():
            return 1
        now = time.monotonic()
        if now > deadline:
            return 1
        if now - last_check[0] > 2:
            last_check[0] = now
            if shutil.disk_usage(ROOT).free < 2 * 1024 ** 3:
                return 1
        return 0

    conn.set_progress_handler(stop, 10000)
    try:
        return conn.execute(sql).fetchall()
    finally:
        if ACTIVE_BUDGET:
            ACTIVE_BUDGET.attach(conn)
        else:
            conn.set_progress_handler(None, 0)


def column_expressions(column):
    q = quote(column['name'])
    numeric = f"CASE WHEN typeof({q}) IN ('integer','real') THEN {q} END"
    sized = f"CASE WHEN typeof({q}) IN ('text','blob') THEN length({q}) END"
    # Identifiers/timestamps are never emitted as raw extrema (counts/lengths only).
    hide_range = (column['name'] in ('id', 'rowid', 'seq', 'segid', 'pgno', 'timestamp_unix')
                  or column['name'].endswith('_id'))
    exprs = {f'type_{t}': f"sum(typeof({q})='{t}')" for t in ['null', 'integer', 'real', 'text', 'blob']}
    exprs.update({'empty_text': f"sum(typeof({q})='text' AND length({q})=0)",
                  'zero_numeric': f"sum(typeof({q}) IN ('integer','real') AND {q}=0)",
                  'negative_numeric': f"sum(typeof({q}) IN ('integer','real') AND {q}<0)",
                  'positive_numeric': f"sum(typeof({q}) IN ('integer','real') AND {q}>0)",
                  'length_min': f'min({sized})', 'length_max': f'max({sized})',
                  'length_avg': f'avg({sized})',
                  'logical_value_bytes': f"sum(CASE WHEN typeof({q}) IN ('text','blob') THEN length(CAST({q} AS BLOB)) ELSE 0 END)"})
    if not hide_range:
        exprs.update({'numeric_min': f'min({numeric})', 'numeric_max': f'max({numeric})',
                      'numeric_avg': f'avg({numeric})'})
    return exprs


def table_stats(conn, name, meta):
    table = quote(name)
    count = conn.execute(f'SELECT count(*) FROM {table}').fetchone()[0]
    result = {'row_count': count, 'columns': {}, 'exact': True}
    columns = meta['columns']
    # One compatible aggregates scan per eight columns, under SQLite expression limits.
    for offset in range(0, len(columns), 8):
        group = columns[offset:offset + 8]
        specs = [(col, column_expressions(col)) for col in group]
        sql = f"SELECT {','.join(e for _, exprs in specs for e in exprs.values())} FROM {table}"
        values = iter(bounded(conn, sql, timeout=600)[0])
        for column, exprs in specs:
            stat = {key: next(values) for key in exprs}
            for key in stat:
                if key.startswith('type_') or key in ('empty_text', 'zero_numeric', 'logical_value_bytes', 'negative_numeric', 'positive_numeric'):
                    stat[key] = stat[key] or 0
            stat['null_count'] = stat['type_null']
            stat['nonnull_count'] = count - stat['null_count']
            stat['null_percent'] = 100 * stat['null_count'] / count if count else None
            stat['numeric_range_withheld'] = 'numeric_min' not in stat
            result['columns'][column['name']] = stat
    # GROUP BY exposes only cardinalities/frequencies; values never leave SQLite.
    for column in columns:
        col = quote(column['name'])
        stat = result['columns'][column['name']]
        if not stat['nonnull_count']:
            stat.update(distinct_nonnull=0, distinct_method='exact', most_common_nonnull_count=0)
            continue
        try:
            distinct, peak = bounded(conn, f'SELECT count(*), max(n) FROM (SELECT count(*) n FROM {table} WHERE {col} IS NOT NULL GROUP BY {col})')[0]
            stat.update(distinct_nonnull=distinct, distinct_method='exact', most_common_nonnull_count=peak)
        except sqlite3.OperationalError as exc:
            stat.update(distinct_nonnull=None, distinct_method='unavailable',
                        distinct_reason='180-second or 2 GiB free-disk bound' if 'interrupted' in str(exc) else 'SQLite resource error')
    if meta['implicit_rowid']:
        # Separate engine key coverage; INTEGER PRIMARY KEY aliases do not consume another value.
        row = conn.execute(f'SELECT count(rowid),count(DISTINCT rowid),sum(rowid=0),sum(rowid<0) FROM {table}').fetchone()
        result['implicit_rowid'] = {'alias': meta['implicit_rowid']['alias'], 'nonnull': row[0],
                                    'null': count-row[0], 'distinct': row[1], 'zero': row[2] or 0,
                                    'negative': row[3] or 0, 'type': 'integer', 'method': 'exact'}
    return result


def provider_stats(conn, name, meta):
    if name == 'sessions':
        clause = 'sessions t'
        provider = 't.source'
    elif any(c['name'] == 'session_id' for c in meta['columns']) and meta['kind'] == 'table':
        clause = f'{quote(name)} t LEFT JOIN sessions s ON s.id=t.session_id'
        provider = 's.source'
    else:
        return []
    columns = [c['name'] for c in meta['columns']]
    expressions = ','.join(f'sum(t.{quote(c)} IS NULL)' for c in columns)
    rows = conn.execute(f"SELECT CASE WHEN {provider} IN ('copilot','claudeCode') THEN {provider} ELSE 'other-or-orphan' END,count(*),{expressions} FROM {clause} GROUP BY 1").fetchall()
    return [{'provider': row[0], 'rows': row[1], 'null_counts': dict(zip(columns, row[2:]))} for row in rows]


def storage(conn):
    rows = conn.execute("SELECT name,count(*),sum(pgsize),sum(payload),sum(unused),sum(pagetype='overflow'),sum(CASE WHEN pagetype='overflow' THEN pgsize ELSE 0 END),max(mx_payload) FROM dbstat GROUP BY name ORDER BY name").fetchall()
    keys = ['name', 'pages', 'allocated_bytes', 'payload_bytes', 'unused_bytes', 'overflow_pages', 'overflow_bytes', 'max_cell_payload_bytes']
    objects = [dict(zip(keys, row)) for row in rows]
    pragmas = {name: conn.execute(f'PRAGMA {name}').fetchone()[0] for name in ['page_count', 'page_size', 'freelist_count', 'auto_vacuum']}
    accounted = sum(o['allocated_bytes'] for o in objects) + pragmas['freelist_count'] * pragmas['page_size']
    return {'objects': objects, **pragmas, 'non_btree_non_freelist_bytes': pragmas['page_count'] * pragmas['page_size'] - accounted}


def correctness(conn, schema):
    result = {'foreign_key_violations': sum(1 for _ in conn.execute('PRAGMA foreign_key_check'))}
    checks = {
        'null_session_ids': 'SELECT count(*) FROM sessions WHERE id IS NULL',
        'unknown_sources': "SELECT count(*) FROM sessions WHERE source NOT IN ('copilot','claudeCode')",
        'parent_session_missing': 'SELECT count(*) FROM sessions c LEFT JOIN sessions p ON p.id=c.parent_session_id WHERE c.parent_session_id IS NOT NULL AND p.id IS NULL',
        'search_empty_content': 'SELECT count(*) FROM search_content WHERE length(trim(content))=0',
        'search_without_success_marker': 'SELECT count(*) FROM search_content c JOIN sessions s ON s.id=c.session_id WHERE s.search_indexed_at IS NULL',
        'search_marked_without_rows': 'SELECT count(*) FROM sessions s WHERE search_indexed_at IS NOT NULL AND NOT EXISTS(SELECT 1 FROM search_content c WHERE c.session_id=s.id)',
        'activity_out_of_range': 'SELECT count(*) FROM session_activity WHERE day_of_week NOT BETWEEN 0 AND 6 OR hour NOT BETWEEN 0 AND 23',
        'tool_outcomes_exceed_calls': 'SELECT count(*) FROM session_tool_calls WHERE success_count+failure_count>call_count',
        'tool_duration_samples_exceed_calls': 'SELECT count(*) FROM session_tool_calls WHERE calls_with_duration>call_count',
        'native_tool_duration_samples_exceed_calls': 'SELECT count(*) FROM session_native_tool_calls WHERE calls_with_duration>call_count',
        'segments_start_after_end': 'SELECT count(*) FROM session_segments WHERE julianday(start_timestamp)>julianday(end_timestamp)',
        'sessions_created_after_updated': 'SELECT count(*) FROM sessions WHERE julianday(created_at)>julianday(updated_at)',
        'bad_segment_model_json': 'SELECT count(*) FROM session_segments WHERE model_metrics_json IS NOT NULL AND NOT json_valid(model_metrics_json)',
        'bad_search_metadata_json': 'SELECT count(*) FROM search_content WHERE metadata_json IS NOT NULL AND NOT json_valid(metadata_json)',
        'bad_source_fingerprint_json': 'SELECT count(*) FROM sessions WHERE source_fingerprint IS NOT NULL AND NOT json_valid(source_fingerprint)',
    }
    for label, sql in checks.items():
        result[label] = {'count': conn.execute(sql).fetchone()[0], 'sql': sql}
    timestamps = {}
    for name, meta in schema['tables'].items():
        if meta['kind'] != 'table' or name.startswith('sqlite_'):
            continue
        for column in meta['columns']:
            field = column['name']
            if column['type'] == 'TEXT' and (field.endswith(('_at', '_timestamp')) or field in ('timestamp', 'idle_start')):
                q = quote(field)
                invalid = conn.execute(f'SELECT count(*) FROM {quote(name)} WHERE {q} IS NOT NULL AND julianday({q}) IS NULL').fetchone()[0]
                timestamps[f'{name}.{field}'] = invalid
    result['unparseable_timestamp_counts'] = timestamps
    return result


def measure(snapshot, output, coordinator):
    global ACTIVE_BUDGET
    gate(coordinator)
    snapshot, output = ignored(snapshot), ignored(output)
    provenance = json.loads(snapshot.with_suffix('.provenance.json').read_text(encoding='utf-8'))
    if sha256(snapshot) != provenance['snapshot_sha256']:
        raise ValueError('Snapshot no longer matches validated provenance')
    temporary = ignored(output.parent / 'sqlite-temp')
    temporary.mkdir(exist_ok=True)
    for key in ('TEMP', 'TMP', 'SQLITE_TMPDIR'):
        os.environ[key] = str(temporary)
    conn = readonly(snapshot, immutable=True)
    ACTIVE_BUDGET = Budget(coordinator, output.parent)
    ACTIVE_BUDGET.attach(conn)
    conn.execute('PRAGMA soft_heap_limit=134217728')
    conn.execute('PRAGMA hard_heap_limit=268435456')
    schema = inventory(conn)
    result = {'started_utc': utc(), 'sqlite_version': sqlite3.sqlite_version,
              'snapshot_sha256': provenance['snapshot_sha256'], 'schema': schema, 'tables': {}}
    try:
        try:
            result['storage'] = storage(conn)
            result['storage']['sqlite_version'] = sqlite3.sqlite_version
        except sqlite3.OperationalError as exc:
            if 'no such table: dbstat' not in str(exc):
                raise
            process = subprocess.Popen(
                ['node', '--experimental-sqlite', str(ROOT / 'scripts/database/storage.mjs'), str(snapshot)],
                stdout=subprocess.PIPE, text=True)
            try:
                while True:
                    ACTIVE_BUDGET.check()
                    try:
                        output_json, _ = process.communicate(timeout=2)
                        if process.returncode:
                            raise RuntimeError('dbstat helper failed')
                        break
                    except subprocess.TimeoutExpired:
                        continue
            finally:
                if process.poll() is None:
                    process.terminate()
                    process.wait()
            result['storage'] = json.loads(output_json)
        for name, meta in schema['tables'].items():
            gate(coordinator)
            ACTIVE_BUDGET.check()
            started = time.monotonic()
            result['tables'][name] = table_stats(conn, name, meta)
            result['tables'][name]['providers'] = provider_stats(conn, name, meta)
            result['tables'][name]['elapsed_seconds'] = time.monotonic() - started
            write_json(output, result)
            print(json.dumps({'table': name, 'rows': result['tables'][name]['row_count'], 'seconds': round(time.monotonic() - started, 2)}), flush=True)
        result['correctness'] = correctness(conn, schema)
        result['finished_utc'] = utc()
        write_json(output, result)
    finally:
        conn.close()
        ACTIVE_BUDGET = None
    assert sha256(snapshot) == provenance['snapshot_sha256'], 'Frozen snapshot modified'


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--snapshot', required=True)
    parser.add_argument('--out', required=True)
    parser.add_argument('--coordinator', required=True)
    args = parser.parse_args()
    measure(args.snapshot, args.out, args.coordinator)
