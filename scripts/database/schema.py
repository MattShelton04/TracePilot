"""Source-derived index schema and complete SQLite introspection (no live opener)."""
import json
import re
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def quote(name):
    return '"' + name.replace('"', '""') + '"'


def source_schema():
    base = ROOT / 'crates/tracepilot-indexer/src/index_db/migrations'
    definitions = (base / 'sql.rs').read_text(encoding='utf-8')
    constants = {int(n): sql for n, sql in re.findall(
        r'const MIGRATION_(\d+): &str = r#"(.*?)"#;', definitions, re.S)}
    for n, filename in re.findall(
        r'const MIGRATION_(\d+): &str = include_str!\("(.*?)"\)', definitions):
        constants[int(n)] = (base / filename).read_text(encoding='utf-8')
    plan = (base / 'plan.rs').read_text(encoding='utf-8').split('#[cfg(test)]')[0]
    migrations = []
    for match in re.finditer(r'version: (\d+),\s*name: "[^"]*",(.*?)pre_hook:', plan, re.S):
        version, body = int(match[1]), match[2]
        reference = re.search(r'sql: MIGRATION_(\d+)', body)
        if reference:
            sql = constants[int(reference[1])]
        else:
            literal = re.search(r'sql: "((?:[^"\\]|\\.)*)"', body, re.S)
            if not literal:
                raise ValueError(f'Unrecognized migration {version}; update extractor')
            sql = literal[1].replace('\\n', '\n').replace('\\"', '"')
        migrations.append((version, sql))
    expected = [int(x) for x in re.findall(r'version: (\d+),', plan)]
    assert [v for v, _ in migrations] == expected, 'Incomplete source migration extraction'
    conn = sqlite3.connect(':memory:')
    conn.execute("CREATE TABLE schema_version (version INTEGER NOT NULL, applied_at TEXT DEFAULT (datetime('now')))")
    for version, sql in migrations:
        if version == 9:
            conn.execute('ALTER TABLE sessions ADD COLUMN search_indexed_at TEXT')
            conn.execute('ALTER TABLE sessions ADD COLUMN search_extractor_version INTEGER DEFAULT 0')
        conn.executescript(sql)
        conn.execute('INSERT INTO schema_version(version) VALUES (?)', (version,))
    conn.commit()
    return conn, expected


def inventory(conn):
    objects = [dict(zip(('type', 'name', 'table', 'rootpage', 'sql'), row)) for row in
               conn.execute('SELECT type,name,tbl_name,rootpage,sql FROM sqlite_schema ORDER BY type,name')]
    table_list = {row[1]: row for row in conn.execute('PRAGMA table_list') if row[0] == 'main'}
    tables = {}
    for name, item in sorted(table_list.items()):
        columns = [dict(zip(('cid', 'name', 'type', 'notnull', 'default', 'pk', 'hidden'), row))
                   for row in conn.execute(f'PRAGMA table_xinfo({quote(name)})')]
        indexes = []
        for idx in conn.execute(f'PRAGMA index_list({quote(name)})'):
            indexes.append({'name': idx[1], 'unique': idx[2], 'origin': idx[3], 'partial': idx[4],
                            'columns': [list(x) for x in conn.execute(f'PRAGMA index_xinfo({quote(idx[1])})')]})
        alias = next((c['name'] for c in columns if c['pk'] and c['type'].upper() == 'INTEGER'
                      and sum(bool(c2['pk']) for c2 in columns) == 1), None)
        tables[name] = {'kind': item[2], 'without_rowid': item[4], 'strict': item[5],
                        'columns': columns, 'indexes': indexes,
                        'foreign_keys': [list(x) for x in conn.execute(f'PRAGMA foreign_key_list({quote(name)})')],
                        'implicit_rowid': None if item[4] else {'alias': alias, 'names': ['rowid', '_rowid_', 'oid']}}
    return {'objects': objects, 'tables': tables}


def write_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', required=True)
    args = parser.parse_args()
    db, versions = source_schema()
    write_json(args.out, {'versions': versions, **inventory(db)})
    db.close()
