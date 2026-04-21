//! Skill import operations — from local paths, GitHub repos, and files.
//!
//! All import functions use [`atomic::atomic_dir_install`] to stage files in a
//! temporary directory before atomically renaming to the final destination.
//! This prevents partial/corrupted skill directories when file operations fail
//! mid-import.
//!
//! Submodules:
//! - [`atomic`]: staging + atomic rename primitive
//! - [`local`]: import from a local directory / discover local skills
//! - [`file`]: import from a single SKILL.md file
//! - [`github`]: import / preview / discover via the `gh` CLI

mod atomic;
mod file;
mod github;
mod local;

#[cfg(test)]
mod tests;

pub use file::import_from_file;
pub use github::{
    discover_github_skills, import_from_github, import_github_skill, preview_github_import,
};
pub use local::{discover_local_skills, discover_repo_skills, import_from_local};
