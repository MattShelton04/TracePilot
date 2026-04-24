## 2024-04-24 - Optimizing SQLite batched inserts with rusqlite

**Learning:** When performing large batched inserts into SQLite via `rusqlite`, there are two significant sources of overhead in loop construction:
1. Re-preparing the `Statement` repeatedly for chunks of exactly the same size.
2. Generating the SQL placeholder string repeatedly.
3. Constructing parameters using indexed placeholders (e.g. `?1,?2`) and string formatting overhead instead of sequential placeholders (`?,?`).

**Action:**
- Cache the full-chunk `rusqlite::Statement` instance using `Option<rusqlite::Statement>` for identically-sized chunks. Only use `conn.prepare` on the loop if the chunk size differs from the `BATCH_CHUNK_SIZE`.
- Generate the placeholder SQL using sequential `?` parameters and avoid `write!` macros to save CPU cycles from integer formatting.
