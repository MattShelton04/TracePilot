"""WAL-aware online backup from a read-only source, with explicit quiet-window gate."""
import argparse
import hashlib
import json
import sqlite3
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

from schema import ROOT, inventory, write_json
from budget import Budget


def utc():
    return datetime.now(timezone.utc).isoformat()


def gate(path):
    state = json.loads(Path(path).read_text(encoding='utf-8-sig'))
    if state.get('allowHeavyAudit') is not True:
        raise RuntimeError('Coordinator has not granted a heavy-audit quiet window')
    return {k: state.get(k) for k in ('allowHeavyAudit', 'updatedUtc', 'reason')}


def ignored(path):
    path = Path(path).resolve()
    path.relative_to(ROOT)
    result = subprocess.run(['git', 'check-ignore', '-q', str(path)], cwd=ROOT)
    if result.returncode:
        raise ValueError('Private evidence destination must be Git-ignored inside this worktree')
    return path


def sha256(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def file_sizes(path):
    return {label: p.stat().st_size if p.exists() else None for label, p in
            [('database', path), ('wal', Path(str(path) + '-wal')), ('shm', Path(str(path) + '-shm'))]}


def readonly(path, immutable=False):
    uri = Path(path).resolve().as_uri() + '?mode=ro' + ('&immutable=1' if immutable else '')
    conn = sqlite3.connect(uri, uri=True, timeout=5)
    conn.execute('PRAGMA query_only=ON')
    conn.execute('PRAGMA cache_size=-32768')
    conn.execute('PRAGMA temp_store=FILE')
    conn.execute('PRAGMA threads=1')
    return conn


def snapshot(source, destination, coordinator):
    authorization = gate(coordinator)
    source = Path(source).resolve(strict=True)
    destination = ignored(destination)
    if destination.exists() or source == destination:
        raise ValueError('Snapshot destination must be fresh and different from source')
    destination.parent.mkdir(parents=True, exist_ok=True)
    budget = Budget(coordinator, destination.parent, seconds=600)
    budget.check()
    started = utc()
    before = file_sizes(source)
    db = readonly(source)  # Never immutable: SQLite must include committed WAL frames.
    budget.attach(db)
    try:
        # Pin a read transaction for an unambiguous snapshot boundary.
        db.execute('BEGIN')
        db.execute('SELECT count(*) FROM sqlite_schema').fetchone()
        pinned = utc()
        pragmas = {name: db.execute(f'PRAGMA {name}').fetchone()[0] for name in
                   ['page_size', 'page_count', 'freelist_count', 'auto_vacuum', 'journal_mode',
                    'user_version', 'schema_version', 'application_id', 'encoding', 'foreign_keys',
                    'synchronous', 'cache_size', 'temp_store', 'mmap_size', 'busy_timeout']}
        compile_options = [r[0] for r in db.execute('PRAGMA compile_options')]
        def progress(status, remaining, total):
            budget.check()

        target = sqlite3.connect(destination)
        try:
            db.backup(target, pages=256, progress=progress, sleep=0.05)
        finally:
            target.close()
        db.rollback()
    finally:
        db.close()
    after = file_sizes(source)
    frozen = readonly(destination, immutable=True)
    budget.attach(frozen)
    try:
        integrity = [r[0] for r in frozen.execute('PRAGMA integrity_check')]
        if integrity != ['ok']:
            raise RuntimeError('Snapshot integrity check failed; details withheld')
        fk_count = sum(1 for _ in frozen.execute('PRAGMA foreign_key_check'))
        schema = inventory(frozen)
        versions = [r[0] for r in frozen.execute('SELECT version FROM schema_version ORDER BY version')]
    finally:
        frozen.close()
    result = {'started_utc': started, 'read_transaction_pinned_utc': pinned, 'finished_utc': utc(),
              'source_revision': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
              'sqlite_version': sqlite3.sqlite_version, 'source_connection_pragmas': pragmas,
              'python_version': '.'.join(map(str, sys.version_info[:3])),
              'compile_options': compile_options,
              'source_file_bytes_before': before, 'source_file_bytes_after': after,
              'snapshot_bytes': destination.stat().st_size, 'snapshot_sha256': sha256(destination),
              'integrity_check': 'ok', 'foreign_key_violation_count': fk_count,
              'migration_versions': versions, 'quiet_window': authorization, 'schema': schema}
    write_json(destination.with_suffix('.provenance.json'), result)
    print(json.dumps({k: result[k] for k in ('snapshot_bytes', 'snapshot_sha256', 'integrity_check', 'sqlite_version')}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', required=True)
    parser.add_argument('--out', required=True)
    parser.add_argument('--coordinator', required=True)
    args = parser.parse_args()
    snapshot(args.source, args.out, args.coordinator)
