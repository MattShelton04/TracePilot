//! Lossless request-capture domain types and forward-compatible protocol parsing.

mod model;
mod parse;

pub use model::*;
pub use parse::{detect_protocol, parse_context_request};
