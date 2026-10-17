### Fixed

- **Search in long replies** — Search now finds words anywhere in an assistant reply or reasoning block, not only in its first 5 KB (4 KB for reasoning); each is indexed in full, up to 256 KB per reply. A long reply is still one result. Existing search indexes refresh on the next index pass.
- **Export page** — Export is on by default when the config file doesn't mention it, as Settings describes, instead of being hidden and redirecting `#/export`.
