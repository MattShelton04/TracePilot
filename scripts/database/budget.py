"""Cooperative stop boundary for serial audit work, including unanticipated scans."""
import json
import shutil
import time
from pathlib import Path


class Budget:
    def __init__(self, coordinator, directory, seconds=1200):
        self.coordinator = Path(coordinator)
        self.directory = Path(directory)
        self.deadline = time.monotonic() + seconds
        self.next_check = 0
        self.reason = None

    def __call__(self):
        now = time.monotonic()
        if now > self.deadline:
            self.reason = 'operation time budget'
        if now >= self.next_check:
            self.next_check = now + 2
            try:
                state = json.loads(self.coordinator.read_text(encoding='utf-8-sig'))
                if state.get('allowHeavyAudit') is not True:
                    self.reason = 'coordinator revoked quiet window'
                if shutil.disk_usage(self.directory).free < 2 * 1024 ** 3:
                    self.reason = 'less than 2 GiB free disk'
            except (OSError, ValueError):
                self.reason = 'cannot verify coordinator or free disk'
        return int(self.reason is not None)

    def check(self):
        if self():
            raise RuntimeError(self.reason)

    def attach(self, conn):
        conn.set_progress_handler(self, 10000)
