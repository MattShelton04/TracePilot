## 2026-04-16 - Cargo fmt overrides unrelated files
**Learning:** Running `cargo fmt --all` locally or formatting the whole workspace can lead to giant diffs across unrelated files and even accidentally committing temporary artifacts if not careful.
**Action:** Use targeted formatter paths, such as `cargo fmt -p <crate_name>` or only selectively format the files touched and stage the right paths.
