"""Read-only SQL plans and bounded aggregate timings; never serialize result rows."""
import argparse
import hashlib
import json
import os
import statistics
import time
from pathlib import Path

from schema import write_json
from snapshot import gate, ignored, readonly, sha256, utc
from budget import Budget


def bindings_for(conn, case):
    params = list(case['synthetic_bindings'])
    selector = case.get('private_binding_selection_sql')
    if not selector:
        return params, 'synthetic'
    if isinstance(selector, str):
        sql, indices = selector, None
    else:
        sql, indices = selector['sql'], selector['parameter_indices']
    row = conn.execute(sql).fetchone()
    if row is None or any(v is None for v in row):
        return params, 'synthetic fallback; selector empty'
    indices = list(range(len(row))) if indices is None else indices
    for idx, value in zip(indices, row):
        params[idx] = value
    return params, 'corpus-selected; values withheld'


def digest_query(conn, sql, bindings, deadline_seconds=30, budget=None,
                 reviewed_numeric_aggregate_output=False):
    deadline = time.monotonic() + deadline_seconds
    conn.set_progress_handler(lambda: int(time.monotonic() > deadline or (budget and budget())), 10000)
    h = hashlib.sha256()
    count = 0
    scalar_counts = None
    start = time.perf_counter()
    try:
        for row in conn.execute(sql, bindings):
            count += 1
            # Opt-in is a review assertion about every projection, not SQL-prefix inference.
            if count == 1 and reviewed_numeric_aggregate_output is True and all(isinstance(v, (int, float)) for v in row):
                scalar_counts = list(row)
            h.update(repr(row).encode('utf-8'))
            h.update(b'\n')
    finally:
        if budget:
            budget.attach(conn)
        else:
            conn.set_progress_handler(None, 0)
    return {'rows': count, 'sha256': h.hexdigest(), 'scalar_counts': scalar_counts if count == 1 else None,
            'milliseconds': 1000 * (time.perf_counter() - start)}


def plans(snapshot, cases_path, output, coordinator):
    gate(coordinator)
    snapshot, output = ignored(snapshot), ignored(output)
    provenance = json.loads(snapshot.with_suffix('.provenance.json').read_text(encoding='utf-8'))
    assert sha256(snapshot) == provenance['snapshot_sha256']
    cases = json.loads(Path(cases_path).read_text(encoding='utf-8'))['cases']
    temporary = ignored(output.parent / 'sqlite-temp')
    temporary.mkdir(exist_ok=True)
    for key in ('TEMP', 'TMP', 'SQLITE_TMPDIR'):
        os.environ[key] = str(temporary)
    conn = readonly(snapshot, immutable=True)
    budget = Budget(coordinator, output.parent)
    budget.attach(conn)
    conn.execute('PRAGMA hard_heap_limit=268435456')
    results = {'started_utc': utc(), 'snapshot_sha256': provenance['snapshot_sha256'], 'cases': []}
    results['sqlite_version'] = conn.execute('SELECT sqlite_version()').fetchone()[0]
    try:
        for case in cases:
            gate(coordinator)
            budget.check()
            record = {k: case[k] for k in ('id', 'sql', 'synthetic_bindings', 'workflow', 'priority')}
            try:
                params, record['binding_method'] = bindings_for(conn, case)
                record['plan'] = [list(row) for row in conn.execute('EXPLAIN QUERY PLAN ' + case['sql'], params)]
                samples = [digest_query(conn, case['sql'], params, budget=budget,
                                        reviewed_numeric_aggregate_output=case.get('reviewed_numeric_aggregate_output') is True)
                           for _ in range(3)]
                record['result_rows'] = samples[0]['rows']
                record['scalar_counts'] = samples[0]['scalar_counts']
                record['stable_ordered_result'] = len({r['sha256'] for r in samples}) == 1
                record['milliseconds'] = [s['milliseconds'] for s in samples]
                record['median_ms'] = statistics.median(record['milliseconds'])
                # Hashes stay private: no identifier/content-derived hashes in published query report.
                record['private_result_sha256'] = samples[0]['sha256']
            except Exception as exc:
                # SQL error text can echo private binding strings. Never serialize it.
                record['unavailable'] = type(exc).__name__
            results['cases'].append(record)
            write_json(output, results)
            print(json.dumps({'case': record['id'], 'rows': record.get('result_rows'), 'unavailable': record.get('unavailable')}), flush=True)
    finally:
        conn.close()
    results['finished_utc'] = utc()
    write_json(output, results)
    assert sha256(snapshot) == provenance['snapshot_sha256']


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--snapshot', required=True)
    parser.add_argument('--cases', required=True)
    parser.add_argument('--out', required=True)
    parser.add_argument('--coordinator', required=True)
    args = parser.parse_args()
    plans(args.snapshot, args.cases, args.out, args.coordinator)
