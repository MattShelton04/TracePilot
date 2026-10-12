"""Offline public manifest/schema/semantic/document coverage verification."""
import json
from pathlib import Path

from report import DOCS
from schema import ROOT, inventory, source_schema


def signature(schema):
    return {name: {k: value for k, value in table.items() if k != 'indexes'} |
            {'indexes': sorted(table['indexes'], key=lambda i: i['name'])}
            for name, table in schema['tables'].items()}


def object_definitions(schema):
    # Root pages describe allocation, not definitions; a rebuild may move them.
    return {(obj['type'], obj['name']): (obj['table'], obj['sql'])
            for obj in schema['objects']}


def verify():
    manifest = json.loads((DOCS / 'coverage.json').read_text(encoding='utf-8'))
    conn, versions = source_schema()
    source = inventory(conn)
    conn.close()
    if signature(source) != signature(manifest['current']) or versions != manifest['migration_versions_current']:
        raise ValueError('Current migration schema drifted; regenerate and review audit')
    if object_definitions(source) != object_definitions(manifest['current']):
        raise ValueError('Current object DDL drifted; regenerate and review audit')
    expected = {}
    objects = set()
    for schema in (manifest['snapshot'], manifest['current']):
        objects.update(o['type'] + ':' + o['name'] for o in schema['objects'])
        for name, table in schema['tables'].items():
            expected.setdefault(name, set()).update(c['name'] for c in table['columns'])
            objects.update('index:' + index['name'] for index in table['indexes'])
    if set(expected) != set(manifest['coverage']):
        raise ValueError('Table coverage incomplete')
    if objects != set(manifest['object_coverage']):
        raise ValueError('Object coverage incomplete')
    refs = 0
    for name, columns in expected.items():
        entry = manifest['coverage'][name]
        if columns != set(entry['columns']):
            raise ValueError(f'Column coverage incomplete: {name}')
        semantics = json.loads((DOCS / entry['semantics']).read_text(encoding='utf-8'))['tables'][name]
        for field in ('schema_report', 'measurement_report', 'storage_report'):
            if not (DOCS / entry[field]).is_file():
                raise ValueError(f'Missing report: {field}')
        for column in columns:
            record = semantics['columns'][column]
            for field in ('meaning', 'lifecycle', 'migration', 'references', 'disposition', 'rationale', 'confidence'):
                if not record.get(field):
                    raise ValueError(f'Missing semantic {field}: {name}.{column}')
            for ref in record['references']:
                path = (ROOT / ref['path']).resolve()
                path.relative_to(ROOT)
                if not path.is_file() or not 1 <= ref['line'] <= len(path.read_text(encoding='utf-8').splitlines()):
                    raise ValueError(f'Invalid reference: {name}.{column}')
                refs += 1
    statistics = (DOCS / 'statistics.md').read_text(encoding='utf-8')
    for name, table in manifest['snapshot']['tables'].items():
        heading = f'## `{name}`\n'
        if heading not in statistics:
            raise ValueError(f'Missing statistics section: {name}')
        block = statistics.split(heading, 1)[1].split('\n## ', 1)[0]
        for col in table['columns']:
            if block.count(f"| `{col['name']}` |") < 2:
                raise ValueError(f'Missing statistic row: {name}.{col["name"]}')
    print(json.dumps({'tables': len(expected), 'columns': sum(map(len, expected.values())),
                      'objects': len(objects), 'reference_locations_validated': refs, 'status': 'complete'}))


if __name__ == '__main__':
    verify()
