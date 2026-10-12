"""Render aggregate evidence and a strict schema/semantic coverage manifest."""
import argparse
import json
from pathlib import Path

from schema import ROOT, inventory, source_schema, write_json

DOCS = ROOT / 'docs/database'


def number(value):
    if value is None:
        return 'N/A'
    if isinstance(value, float):
        return f'{value:,.3f}'.rstrip('0').rstrip('.')
    return f'{value:,}'


def cell(value):
    return str(value).replace('|', '\\|').replace('\n', ' ')


def render_schema(schema, current, semantics):
    lines = ['# Complete schema inventory', '',
             'Snapshot definitions below come from `sqlite_schema`, `table_list`, `table_xinfo`, '
             '`index_list`, `index_xinfo` and `foreign_key_list`. The coverage manifest compares them '
             'with all current migration SQL and the search-column pre/post hooks. '
             'Declared NOT NULL is separate from primary-key behavior: a rowid-table TEXT primary key '
             'can admit NULL; INTEGER PRIMARY KEY aliases the engine rowid. No inferred NOT NULL flag is substituted.', '',
             'Column meanings/dispositions: [catalogue](catalogue.md), [analytics](analytics.md), '
             '[search](search.md). Measurements: [statistics](statistics.md). '
             'Complete searchable semantic records live in the linked `semantics-*.json` files.', '']
    for name in sorted(set(schema['tables']) | set(current['tables'])):
        table = schema['tables'].get(name) or current['tables'][name]
        meaning = semantics[name]
        lines.extend([f'## `{name}`', '',
                      f"Kind: **{table['kind']}**; WITHOUT ROWID: {bool(table['without_rowid'])}; STRICT: {bool(table['strict'])}. "
                      f"Disposition: **{meaning['disposition']}** — {meaning['rationale']}", '',
                      '| Column | Declared type | NOT NULL | Default | PK ordinal | Hidden/generated code | Disposition |',
                      '| --- | --- | --- | --- | --- | --- | --- |'])
        for col in table['columns']:
            disposition = meaning['columns'][col['name']]['disposition']
            lines.append(f"| `{col['name']}` | {cell(col['type']) or '(none)'} | {bool(col['notnull'])} | {cell(col['default']) if col['default'] is not None else 'none'} | {col['pk']} | {col['hidden']} | {disposition} |")
        lines.extend(['', 'Hidden code: 0 ordinary; 1 virtual hidden; 2 virtual generated; 3 stored generated.'])
        if table['implicit_rowid']:
            alias = table['implicit_rowid']['alias']
            lines.extend(['', f"Implicit `rowid` / `_rowid_` / `oid`: **KEEP**, {'alias of `'+alias+'` (same value/storage)' if alias else 'engine integer identity; separate from declared primary key'}. "
                          'Used by SQLite B-trees; FTS content row identities are additionally part of synchronization. No extra allocated column is claimed.'])
        else:
            lines.extend(['', 'No implicit rowid (WITHOUT ROWID).'])
        lines.extend(['', '### Keys, relationships and DDL', ''])
        for index in table['indexes']:
            lines.append(f"- `{index['name']}`: unique={bool(index['unique'])}, origin={index['origin']}, partial={bool(index['partial'])}; index_xinfo `{json.dumps(index['columns'])}`.")
        for fk in table['foreign_keys']:
            lines.append(f'- Foreign key `{json.dumps(fk)}` (id, seq, target table, from, to, update, delete, match).')
        if not table['indexes'] and not table['foreign_keys']:
            lines.append('No separately listed index or foreign key.')
        lines.extend(['', 'Index tuples are `(sequence, cid, name, descending, collation, key)`; cid -1 denotes rowid, -2 an expression. Origin `pk`/`u` identifies constraint-owned autoindexes.', ''])
        for obj in schema['objects']:
            if obj['table'] == name and obj['sql']:
                lines.extend([f"`{obj['type']} {obj['name']}`:", '', '```sql', obj['sql'], '```', ''])
        if name == 'sqlite_schema':
            lines.extend(['`sqlite_schema` is SQLite-managed and does not list itself in its own rows. Its five declared columns are still covered.', ''])
    return '\n'.join(lines)


def render_statistics(data):
    lines = ['# Every-table and every-column measurements', '',
             'All counts are exact unless a cell explicitly says unavailable. N/A percentages mean a zero denominator, '
             'not zero percent. `D` excludes NULL; peak is the largest non-NULL value frequency without disclosing the value. '
             'Types list NULL/integer/real/text/BLOB counts. Text lengths use SQLite characters; BLOB lengths use bytes. '
             'The byte total counts only text/BLOB values and excludes record headers, numeric serial encodings, indexes and page overhead. '
             'Numeric min/max/mean are withheld for identifiers and absolute epoch timestamps. '
             'These are contents of one installation, not product-wide feature usage.', '',
             '[Schema/constraints](schema.md) · [Physical storage](storage.md) · [Meaning and lifecycle](README.md)', '']
    for name, table in data['tables'].items():
        lines.extend([f'## `{name}`', '', f"Exact rows: **{number(table['row_count'])}**.", '',
                      '| Column | NULL (% rows) | Non-NULL | D / method | Peak frequency | Empty text / numeric zero | Types N/I/R/T/B |',
                      '| --- | --- | --- | --- | --- | --- | --- |'])
        for col, stat in table['columns'].items():
            types = '/'.join(number(stat[f'type_{t}']) for t in ('null', 'integer', 'real', 'text', 'blob'))
            lines.append(f"| `{col}` | {number(stat['null_count'])} ({number(stat['null_percent'])}%) | {number(stat['nonnull_count'])} | {number(stat['distinct_nonnull'])} / {stat['distinct_method']} | {number(stat.get('most_common_nonnull_count'))} | {number(stat['empty_text'])} / {number(stat['zero_numeric'])} | {types} |")
            if stat.get('distinct_reason'):
                lines.append(f"<!-- {col}: {stat['distinct_reason']} -->")
        lines.extend(['', '| Column | Numeric min / max / mean | Negative / positive counts | Text/BLOB length min / max / mean | Text/BLOB bytes |',
                      '| --- | --- | --- | --- | --- |'])
        for col, stat in table['columns'].items():
            numeric = 'withheld (identity/epoch)' if stat['numeric_range_withheld'] else ' / '.join(number(stat.get('numeric_' + op)) for op in ('min', 'max', 'avg'))
            length = ' / '.join(number(stat['length_' + op]) for op in ('min', 'max', 'avg'))
            lines.append(f"| `{col}` | {numeric} | {number(stat['negative_numeric'])} / {number(stat['positive_numeric'])} | {length} | {number(stat['logical_value_bytes'])} |")
        if 'implicit_rowid' in table:
            row = table['implicit_rowid']
            lines.extend(['', f"Implicit rowid: {number(row['nonnull'])} non-NULL integers, {number(row['null'])} NULL, {number(row['distinct'])} distinct, {number(row['zero'])} zero, {number(row['negative'])} negative (exact). "
                          f"Alias: {row['alias'] or 'none'}. Range withheld; text/BLOB lengths and empty strings are inapplicable."])
        if table['providers']:
            lines.extend(['', '### Provider populations', '',
                          'Counts include SQL NULLs, not JSON null strings. Non-NULL for any cell is provider rows minus its NULL count. '
                          'Columns with no NULLs in any provider are omitted here only; their complete overall statistics remain above.', '',
                          '| Provider | Rows |', '| --- | --- |'])
            for provider in table['providers']:
                lines.append(f"| {provider['provider']} | {number(provider['rows'])} |")
            lines.extend(['', '| Nullable column | ' + ' | '.join(p['provider'] + ' NULL' for p in table['providers']) + ' |',
                          '| --- | ' + ' | '.join('---' for _ in table['providers']) + ' |'])
            for col in table['columns']:
                if any(p['null_counts'][col] for p in table['providers']):
                    lines.append(f"| `{col}` | " + ' | '.join(number(p['null_counts'][col]) for p in table['providers']) + ' |')
        lines.append('')
    return '\n'.join(lines)


def render_storage(data):
    store = data['storage']
    page_bytes = store['page_count'] * store['page_size']
    lines = ['# Physical storage accounting', '',
             f"Frozen database: **{number(page_bytes)} bytes**, {number(store['page_count'])} pages of {store['page_size']} bytes. "
             f"Freelist: {number(store['freelist_count'])} pages / {number(store['freelist_count']*store['page_size'])} bytes. "
             f"Other structural pages: {number(store['non_btree_non_freelist_bytes'])} bytes (principally incremental-auto-vacuum pointer maps).", '',
             f"`dbstat` runtime SQLite {store['sqlite_version']}. Each physical B-tree appears once below. "
             'FTS virtual rows expose external content already in sessions/search_content: adding their logical text bytes again would double-count it. '
             'Only their shadow B-trees consume separately attributed pages. Index payload duplicates indexed values by design. '
             'Payload and unused bytes are subdivisions of allocated bytes, not extra allocations; overflow is likewise included. '
             'Neither freed pages nor WAL/SHM are included in dbstat B-tree totals. '
             'Unused bytes measure page slack; they are not all reclaimable by dropping a column. '
             '[Snapshot provenance and live sidecar sizes](methodology.md).', '',
             '| B-tree | Pages | Allocated bytes | Payload bytes | Unused bytes | Overflow pages / bytes | Largest cell payload |',
             '| --- | --- | --- | --- | --- | --- | --- |']
    for obj in store['objects']:
        lines.append(f"| `{obj['name']}` | {number(obj['pages'])} | {number(obj['allocated_bytes'])} | {number(obj['payload_bytes'])} | {number(obj['unused_bytes'])} | {number(obj['overflow_pages'])} / {number(obj['overflow_bytes'])} | {number(obj['max_cell_payload_bytes'])} |")
    lines.extend(['', '## Table ownership totals', '',
                  'Includes each table and its own constraint/secondary indexes. Virtual FTS totals include their four shadows and shadow indexes, '
                  'not external content. Zero means no independent B-tree, not no useful data.', '',
                  '| Table owner | Exact rows | Own B-tree bytes | Owned index/shadow bytes | Total allocated |', '| --- | --- | --- | --- | --- |'])
    objects = {o['name']: o for o in store['objects']}
    for name, table in data['schema']['tables'].items():
        own = objects.get(name, {}).get('allocated_bytes', 0)
        indexes = sum(objects.get(i['name'], {}).get('allocated_bytes', 0) for i in table['indexes'])
        if table['kind'] == 'virtual':
            indexes += sum(o['allocated_bytes'] for n, o in objects.items() if n.startswith(name + '_'))
        lines.append(f"| `{name}` | {number(data['tables'][name]['row_count'])} | {number(own)} | {number(indexes)} | {number(own+indexes)} |")
    lines.extend(['', 'Do not sum virtual ownership totals together with the shadow rows: that view deliberately shows both parent ownership and child attribution. The first B-tree table plus freelist plus structural pages is the non-overlapping reconciliation.', ''])
    return '\n'.join(lines)


def render(evidence):
    data = json.loads(Path(evidence).read_text(encoding='utf-8'))
    validate_measurements(data)
    conn, versions = source_schema()
    current = inventory(conn)
    conn.close()
    semantics, owners = {}, {}
    for path in DOCS.glob('semantics-*.json'):
        group = json.loads(path.read_text(encoding='utf-8'))['tables']
        for name, value in group.items():
            if name in semantics:
                raise ValueError(f'Duplicate table ownership: {name}')
            semantics[name], owners[name] = value, path.name
    snapshot = data['schema']
    allowed_names = {o['name'] for o in current['objects']} | {'sqlite_stat1', 'sqlite_stat4'}
    unknown = {o['name'] for o in snapshot['objects']} - allowed_names
    if unknown:
        raise ValueError('Unreviewed snapshot objects; do not publish their names or DDL automatically')
    expected = {name: {c['name'] for c in table['columns']} for name, table in current['tables'].items()}
    for name, table in snapshot['tables'].items():
        expected.setdefault(name, set()).update(c['name'] for c in table['columns'])
    for name, columns in expected.items():
        assert name in semantics, f'Missing table semantics: {name}'
        missing = columns - semantics[name]['columns'].keys()
        assert not missing, f'Missing column semantics: {name}: {missing}'
    manifest = {'audited_revision': 'd95f6d81d8a27f9ee3b18967f00b81d76c25e723',
                'snapshot_sha256': data['snapshot_sha256'], 'migration_versions_current': versions,
                'snapshot': snapshot, 'current': current, 'coverage': {}}
    manifest['object_coverage'] = {}
    for obj in snapshot['objects'] + current['objects']:
        key = obj['type'] + ':' + obj['name']
        manifest['object_coverage'][key] = {
            'kind': obj['type'], 'table': obj['table'], 'schema_report': 'schema.md',
            'analysis_report': 'queries.md' if obj['type'] == 'index' else owners.get(obj['table'], 'catalogue.md'),
            'disposition': semantics[obj['table']]['disposition'] if obj['type'] == 'table' else 'KEEP',
            'rationale': 'Constraint/query-role analysis in queries.md; no index removal before measured workload validation.' if obj['type'] == 'index' else
                         'Schema and table lifecycle analysis; FTS synchronization triggers are required by maintained content.'}
    for schema in (snapshot, current):
        for table_name, table in schema['tables'].items():
            for index in table['indexes']:
                key = 'index:' + index['name']
                if key not in manifest['object_coverage']:
                    manifest['object_coverage'][key] = {
                        'kind': 'implicit_index', 'table': table_name, 'schema_report': 'schema.md',
                        'analysis_report': 'queries.md', 'disposition': 'KEEP',
                        'rationale': 'WITHOUT ROWID primary-key access path reported by index_list; storage is the owner B-tree, not an extra sqlite_schema index allocation.'}
    for name, columns in expected.items():
        manifest['coverage'][name] = {'semantics': owners[name], 'columns': sorted(columns),
                                     'implicit_rowid': (snapshot['tables'].get(name) or current['tables'][name])['implicit_rowid'],
                                     'schema_report': 'schema.md', 'measurement_report': 'statistics.md',
                                     'storage_report': 'storage.md'}
    DOCS.mkdir(exist_ok=True)
    write_json(DOCS / 'coverage.json', manifest)
    (DOCS / 'schema.md').write_text(render_schema(snapshot, current, semantics), encoding='utf-8')
    (DOCS / 'statistics.md').write_text(render_statistics(data), encoding='utf-8')
    (DOCS / 'storage.md').write_text(render_storage(data), encoding='utf-8')
    print(json.dumps({'tables': len(expected), 'columns': sum(map(len, expected.values())), 'objects': len(snapshot['objects'])}))


def validate_storage(storage, schema):
    required = {'objects', 'page_count', 'page_size', 'freelist_count', 'auto_vacuum',
                'sqlite_version', 'non_btree_non_freelist_bytes'}
    if not required.issubset(storage) or not storage['sqlite_version'] or not storage['objects']:
        raise ValueError('Incomplete storage measurements')
    metrics = {'pages', 'allocated_bytes', 'payload_bytes', 'unused_bytes', 'overflow_pages',
               'overflow_bytes', 'max_cell_payload_bytes'}
    names = []
    for obj in storage['objects']:
        if not ({'name'} | metrics).issubset(obj):
            raise ValueError('Incomplete storage object measurements')
        if any(not isinstance(obj[key], int) or obj[key] < 0 for key in metrics):
            raise ValueError('Invalid storage object measurements')
        if obj['allocated_bytes'] != obj['pages'] * storage['page_size']:
            raise ValueError('Inconsistent storage object allocation')
        names.append(obj['name'])
    expected = {'sqlite_schema'} | {obj['name'] for obj in schema['objects'] if obj['rootpage'] > 0}
    if set(names) != expected or len(names) != len(set(names)):
        raise ValueError('Physical storage object coverage mismatch')
    if any(not isinstance(storage[key], int) or storage[key] < 0 for key in
           ('page_count', 'page_size', 'freelist_count', 'non_btree_non_freelist_bytes')) or not storage['page_size']:
        raise ValueError('Invalid storage page measurements')
    accounted = sum(obj['allocated_bytes'] for obj in storage['objects'])
    accounted += storage['freelist_count'] * storage['page_size'] + storage['non_btree_non_freelist_bytes']
    if accounted != storage['page_count'] * storage['page_size']:
        raise ValueError('Physical storage reconciliation mismatch')


def validate_correctness(result, schema):
    probes = {'null_session_ids', 'unknown_sources', 'parent_session_missing', 'search_empty_content',
              'search_without_success_marker', 'search_marked_without_rows', 'activity_out_of_range',
              'tool_outcomes_exceed_calls', 'tool_duration_samples_exceed_calls',
              'native_tool_duration_samples_exceed_calls', 'segments_start_after_end',
              'sessions_created_after_updated', 'bad_segment_model_json',
              'bad_search_metadata_json', 'bad_source_fingerprint_json'}
    if not (probes | {'foreign_key_violations', 'unparseable_timestamp_counts'}).issubset(result):
        raise ValueError('Incomplete correctness measurements')
    for probe in probes:
        value = result[probe]
        if not isinstance(value, dict) or not {'count', 'sql'}.issubset(value) or not value['sql']:
            raise ValueError('Incomplete correctness probe')
        if not isinstance(value['count'], int) or value['count'] < 0:
            raise ValueError('Invalid correctness count')
    if not isinstance(result['foreign_key_violations'], int) or result['foreign_key_violations'] < 0:
        raise ValueError('Invalid correctness foreign-key count')
    expected = {f'{name}.{column["name"]}' for name, table in schema['tables'].items()
                if table['kind'] == 'table' and not name.startswith('sqlite_')
                for column in table['columns'] if column['type'] == 'TEXT' and
                (column['name'].endswith(('_at', '_timestamp')) or column['name'] in ('timestamp', 'idle_start'))}
    timestamps = result['unparseable_timestamp_counts']
    if not isinstance(timestamps, dict) or set(timestamps) != expected:
        raise ValueError('Incomplete correctness timestamp coverage')
    if any(not isinstance(count, int) or count < 0 for count in timestamps.values()):
        raise ValueError('Invalid correctness timestamp count')


def validate_measurements(data):
    if not data.get('finished_utc') or 'correctness' not in data or 'storage' not in data:
        raise ValueError('Incomplete measurement run')
    if set(data['tables']) != set(data['schema']['tables']):
        raise ValueError('Measured table coverage differs from discovered schema')
    validate_storage(data['storage'], data['schema'])
    validate_correctness(data['correctness'], data['schema'])
    required = {'null_count', 'null_percent', 'nonnull_count', 'distinct_nonnull', 'distinct_method',
                'empty_text', 'zero_numeric', 'length_min', 'length_max', 'length_avg',
                'logical_value_bytes', 'negative_numeric', 'positive_numeric', 'numeric_range_withheld',
                'type_null', 'type_integer', 'type_real', 'type_text', 'type_blob'}
    for name, table in data['schema']['tables'].items():
        stats = data['tables'][name]
        if set(stats['columns']) != {c['name'] for c in table['columns']}:
            raise ValueError(f'Measured column coverage mismatch: {name}')
        if bool(table['implicit_rowid']) != ('implicit_rowid' in stats):
            raise ValueError(f'Implicit rowid coverage mismatch: {name}')
        for col, measurement in stats['columns'].items():
            if not required.issubset(measurement):
                raise ValueError(f'Missing statistic: {name}.{col}')
            if not measurement['numeric_range_withheld'] and not {'numeric_min', 'numeric_max', 'numeric_avg'}.issubset(measurement):
                raise ValueError(f'Missing numeric statistic: {name}.{col}')
            if measurement['distinct_method'] == 'exact' and (
                    'most_common_nonnull_count' not in measurement or measurement['distinct_nonnull'] is None or
                    measurement['most_common_nonnull_count'] is None):
                raise ValueError(f'Missing frequency statistic: {name}.{col}')
            if measurement['null_count'] + measurement['nonnull_count'] != stats['row_count']:
                raise ValueError(f'NULL denominator mismatch: {name}.{col}')
            if sum(measurement['type_' + t] for t in ('null', 'integer', 'real', 'text', 'blob')) != stats['row_count']:
                raise ValueError(f'Type denominator mismatch: {name}.{col}')
            if measurement['distinct_method'] == 'unavailable' and not measurement.get('distinct_reason'):
                raise ValueError(f'Unexplained missing cardinality: {name}.{col}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--evidence', required=True)
    render(parser.parse_args().evidence)
