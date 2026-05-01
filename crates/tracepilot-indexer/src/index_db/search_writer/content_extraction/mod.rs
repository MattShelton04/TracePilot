//! Pure content extraction from session events into searchable rows.
//!
//! `extract_search_content` converts a sequence of typed session events into
//! `SearchContentRow` entries suitable for FTS indexing. This is a pure function
//! with no database interaction — safe to call outside of a transaction.

mod builder;
mod extractor;
mod limits;
mod state;

#[cfg(test)]
mod tests;

pub use extractor::extract_search_content;
