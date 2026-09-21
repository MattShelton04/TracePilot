//! Reading `session_refs` into normalised [`WorkRef`]s.

use crate::session_store::capability::{REFS_COLUMNS, SESSION_COLUMNS, TABLE_REFS, TABLE_SESSIONS};
use crate::session_store::error::{Result, SessionStoreError};
use crate::session_store::model::StoreSessionMeta;
use crate::session_store::open::SourceReader;
use crate::session_store::values;
use crate::session_store::work_ref::{RefResolution, WorkRef};

use super::coverage::CoverageBuilder;

/// Most reference rows read for one session in one pass.
pub const MAX_REFS_PER_SESSION: usize = 5_000;

const REF_COL_ID: usize = 0;
const REF_COL_SESSION_ID: usize = 1;
const REF_COL_TYPE: usize = 2;
const REF_COL_VALUE: usize = 3;
const REF_COL_TURN_INDEX: usize = 4;
const REF_COL_CREATED_AT: usize = 5;

const SESSION_COL_ID: usize = 0;
const SESSION_COL_CWD: usize = 1;
const SESSION_COL_REPOSITORY: usize = 2;
const SESSION_COL_HOST_TYPE: usize = 3;
const SESSION_COL_BRANCH: usize = 4;
const SESSION_COL_SUMMARY: usize = 5;
const SESSION_COL_CREATED_AT: usize = 6;
const SESSION_COL_UPDATED_AT: usize = 7;

/// Read one session's references, deduplicated by normalised identity.
///
/// The session's own repository is passed in as *candidate* context only. It
/// is what makes a bare `#123` showable, and also what makes it unverified:
/// a session that reviews another repository's pull request records the same
/// bare number.
pub fn read_session_refs(
    reader: &SourceReader,
    session_id: &str,
    session_repository: Option<&str>,
    coverage: &mut CoverageBuilder,
) -> Result<Vec<WorkRef>> {
    if !reader.capabilities().supports_work_refs() {
        return Ok(Vec::new());
    }
    reader.check_budget()?;
    let projection = reader.capabilities().projection(TABLE_REFS, REFS_COLUMNS);
    let sql = format!(
        "SELECT {projection} FROM \"{TABLE_REFS}\" WHERE \"session_id\" = ?1 \
         ORDER BY \"ref_type\" ASC, \"ref_value\" ASC LIMIT ?2"
    );
    let mut stmt = reader
        .connection()
        .prepare(&sql)
        .map_err(|error| SessionStoreError::from_sqlite(&error))?;
    let limit = i64::try_from(MAX_REFS_PER_SESSION).unwrap_or(i64::MAX);
    let mut rows = stmt
        .query(rusqlite::params![session_id, limit])
        .map_err(|error| SessionStoreError::from_sqlite(&error))?;

    let mut refs: Vec<WorkRef> = Vec::new();
    let mut seen: Vec<String> = Vec::new();
    while let Some(row) = rows
        .next()
        .map_err(|error| SessionStoreError::from_sqlite(&error))?
    {
        let Some(row_session_id) = values::text(row, REF_COL_SESSION_ID).into_option() else {
            coverage.reject_work_ref_row();
            continue;
        };
        let (Some(ref_type), Some(ref_value)) = (
            values::text(row, REF_COL_TYPE).into_option(),
            values::text(row, REF_COL_VALUE).into_option(),
        ) else {
            coverage.reject_work_ref_row();
            continue;
        };
        let work_ref = WorkRef::normalize(
            row_session_id,
            values::integer(row, REF_COL_ID).into_option(),
            &ref_type,
            &ref_value,
            session_repository,
            values::integer(row, REF_COL_TURN_INDEX).into_option(),
            values::text(row, REF_COL_CREATED_AT).into_option(),
        );
        if work_ref.resolution == RefResolution::Rejected {
            coverage.reject_work_ref_row();
            continue;
        }
        let identity = work_ref.identity();
        if seen.contains(&identity) {
            continue;
        }
        seen.push(identity);
        refs.push(work_ref);
    }
    Ok(refs)
}

/// Read one session's store metadata.
///
/// Used for reference context and source binding. It never overwrites
/// TracePilot's own richer session metadata, and an absent `host_type` stays
/// absent rather than becoming "local".
pub fn read_session_meta(
    reader: &SourceReader,
    session_id: &str,
) -> Result<Option<StoreSessionMeta>> {
    if !reader.capabilities().supports_sessions() {
        return Ok(None);
    }
    reader.check_budget()?;
    let projection = reader
        .capabilities()
        .projection(TABLE_SESSIONS, SESSION_COLUMNS);
    let sql = format!("SELECT {projection} FROM \"{TABLE_SESSIONS}\" WHERE \"id\" = ?1 LIMIT 1");
    let mut stmt = reader
        .connection()
        .prepare(&sql)
        .map_err(|error| SessionStoreError::from_sqlite(&error))?;
    let mut rows = stmt
        .query(rusqlite::params![session_id])
        .map_err(|error| SessionStoreError::from_sqlite(&error))?;
    let Some(row) = rows
        .next()
        .map_err(|error| SessionStoreError::from_sqlite(&error))?
    else {
        return Ok(None);
    };
    let Some(id) = values::text(row, SESSION_COL_ID).into_option() else {
        return Ok(None);
    };
    Ok(Some(StoreSessionMeta {
        session_id: id,
        cwd: values::text(row, SESSION_COL_CWD).into_option(),
        repository: values::text(row, SESSION_COL_REPOSITORY).into_option(),
        host_type: values::text(row, SESSION_COL_HOST_TYPE).into_option(),
        branch: values::text(row, SESSION_COL_BRANCH).into_option(),
        summary: values::text(row, SESSION_COL_SUMMARY).into_option(),
        created_at: values::text(row, SESSION_COL_CREATED_AT).into_option(),
        updated_at: values::text(row, SESSION_COL_UPDATED_AT).into_option(),
    }))
}

/// Session IDs the store knows about, for deciding which local sessions are
/// worth refreshing. Bounded, ordered, and metadata-free.
pub fn list_session_ids(reader: &SourceReader, limit: usize) -> Result<Vec<String>> {
    if !reader.capabilities().supports_sessions() {
        return Ok(Vec::new());
    }
    reader.check_budget()?;
    let sql = format!("SELECT \"id\" FROM \"{TABLE_SESSIONS}\" ORDER BY \"id\" ASC LIMIT ?1");
    let mut stmt = reader
        .connection()
        .prepare(&sql)
        .map_err(|error| SessionStoreError::from_sqlite(&error))?;
    let limit = i64::try_from(limit).unwrap_or(i64::MAX);
    let rows = stmt
        .query_map(rusqlite::params![limit], |row| row.get::<_, String>(0))
        .map_err(|error| SessionStoreError::from_sqlite(&error))?;
    let mut ids = Vec::new();
    for id in rows {
        ids.push(id.map_err(|error| SessionStoreError::from_sqlite(&error))?);
    }
    Ok(ids)
}
