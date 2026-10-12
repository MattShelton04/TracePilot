// Aggregate dbstat only; Python's Windows SQLite build may omit ENABLE_DBSTAT_VTAB.
import { DatabaseSync } from "node:sqlite";

const database = new DatabaseSync(process.argv[2], { readOnly: true });
try {
  database.exec(
    "PRAGMA query_only=ON; PRAGMA cache_size=-32768; PRAGMA threads=1; PRAGMA hard_heap_limit=268435456",
  );
  const objects = database
    .prepare(`SELECT name,count(*) pages,sum(pgsize) allocated_bytes,
      sum(payload) payload_bytes,sum(unused) unused_bytes,
      sum(pagetype='overflow') overflow_pages,
      sum(CASE WHEN pagetype='overflow' THEN pgsize ELSE 0 END) overflow_bytes,
      max(mx_payload) max_cell_payload_bytes FROM dbstat GROUP BY name ORDER BY name`)
    .all();
  const pragmas = Object.fromEntries(
    ["page_count", "page_size", "freelist_count", "auto_vacuum"].map((name) => [
      name,
      Object.values(database.prepare(`PRAGMA ${name}`).get())[0],
    ]),
  );
  const accounted =
    objects.reduce((sum, object) => sum + object.allocated_bytes, 0) +
    pragmas.freelist_count * pragmas.page_size;
  console.log(
    JSON.stringify({
      objects,
      ...pragmas,
      sqlite_version: database.prepare("SELECT sqlite_version() v").get().v,
      non_btree_non_freelist_bytes: pragmas.page_count * pragmas.page_size - accounted,
    }),
  );
} finally {
  database.close();
}
