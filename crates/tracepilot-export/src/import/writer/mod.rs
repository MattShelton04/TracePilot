//! Write a [`SessionArchive`] back to session directories on disk.
//!
//! The writer reconstructs the standard session directory layout from the
//! portable archive format. It uses atomic staging: files are written to a
//! temporary directory first, then renamed into place so that a crash during
//! import never leaves a half-written session.

mod atomic;
mod database;
mod filesystem;
mod sections;
mod workspace;

pub(crate) use atomic::write_session_to_id;
pub use atomic::{session_exists, write_session};

#[cfg(test)]
mod tests;
