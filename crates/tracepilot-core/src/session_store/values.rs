//! Lenient, explicit extraction of SQLite cells.
//!
//! Two properties of the source force this layer to exist. First, the timing
//! columns are declared `INTEGER` but hold `REAL` values, so deserialising by
//! declared type loses them. Second, an unusable cell must not take the rest
//! of the row with it: a malformed latency is a missing latency, while a
//! malformed session ID is a rejected row.
//!
//! Every reader here answers with [`Cell`], which keeps "absent" and "present
//! but unusable" apart all the way to the coverage counters.

use rusqlite::Row;
use rusqlite::types::ValueRef;

use super::decimal::ExactDecimal;
use super::status::FieldCoverage;

/// Longest text this adapter will take from any single cell. Far above every
/// field it reads, and a guard against a pathological row.
pub const MAX_TEXT_BYTES: usize = 4096;

/// Longest `token_details_json` payload. The observed arrays are a few hundred
/// bytes; this leaves room for richer billing layouts without unbounded reads.
pub const MAX_JSON_BYTES: usize = 64 * 1024;

/// The outcome of reading one column.
#[derive(Debug, Clone, PartialEq)]
pub enum Cell<T> {
    /// A usable value.
    Value(T),
    /// SQL NULL, or a column this source does not have.
    Absent,
    /// Present but unusable: wrong type, out of range, non-finite, negative
    /// where a count is required, or over a size budget.
    Invalid,
}

impl<T> Cell<T> {
    pub fn into_option(self) -> Option<T> {
        match self {
            Self::Value(value) => Some(value),
            _ => None,
        }
    }

    pub fn is_invalid(&self) -> bool {
        matches!(self, Self::Invalid)
    }

    /// Fold the cell into a coverage tally and return the value, if any.
    pub fn tally(self, coverage: &mut FieldCoverage) -> Option<T> {
        match self {
            Self::Value(value) => {
                coverage.record_valid();
                Some(value)
            }
            Self::Absent => {
                coverage.record_missing();
                None
            }
            Self::Invalid => {
                coverage.record_invalid();
                None
            }
        }
    }
}

/// Read a column by index, treating a missing column as [`Cell::Absent`].
///
/// Optional columns are projected as `NULL` when the source lacks them, so an
/// out-of-range index means the projection itself is wrong — still absent from
/// the reader's point of view, never a panic.
fn value_ref<'a>(row: &'a Row<'a>, index: usize) -> Option<ValueRef<'a>> {
    row.get_ref(index).ok()
}

/// A non-negative integral count. Rejects negatives, non-integral reals and
/// anything above `u64::MAX`.
pub fn count(row: &Row<'_>, index: usize) -> Cell<u64> {
    match value_ref(row, index) {
        None | Some(ValueRef::Null) => Cell::Absent,
        Some(ValueRef::Integer(value)) => match u64::try_from(value) {
            Ok(value) => Cell::Value(value),
            Err(_) => Cell::Invalid,
        },
        Some(ValueRef::Real(value)) => {
            if !value.is_finite() || value < 0.0 || value.fract() != 0.0 || value > 9.007e15 {
                Cell::Invalid
            } else {
                Cell::Value(value as u64)
            }
        }
        Some(ValueRef::Text(bytes)) => match std::str::from_utf8(bytes).ok().map(str::trim) {
            Some(text) => text.parse::<u64>().map_or(Cell::Invalid, Cell::Value),
            None => Cell::Invalid,
        },
        Some(_) => Cell::Invalid,
    }
}

/// A millisecond duration. Accepts `INTEGER` and `REAL` alike, because the
/// source stores both in columns declared `INTEGER`.
pub fn millis(row: &Row<'_>, index: usize) -> Cell<f64> {
    match value_ref(row, index) {
        None | Some(ValueRef::Null) => Cell::Absent,
        Some(ValueRef::Integer(value)) if value >= 0 => Cell::Value(value as f64),
        Some(ValueRef::Integer(_)) => Cell::Invalid,
        Some(ValueRef::Real(value)) => {
            if value.is_finite() && value >= 0.0 {
                Cell::Value(value)
            } else {
                Cell::Invalid
            }
        }
        Some(ValueRef::Text(bytes)) => match std::str::from_utf8(bytes).ok().map(str::trim) {
            Some(text) => match text.parse::<f64>() {
                Ok(value) if value.is_finite() && value >= 0.0 => Cell::Value(value),
                _ => Cell::Invalid,
            },
            None => Cell::Invalid,
        },
        Some(_) => Cell::Invalid,
    }
}

/// A signed integer, for the source's own row and turn indices.
pub fn integer(row: &Row<'_>, index: usize) -> Cell<i64> {
    match value_ref(row, index) {
        None | Some(ValueRef::Null) => Cell::Absent,
        Some(ValueRef::Integer(value)) => Cell::Value(value),
        Some(ValueRef::Real(value)) => {
            if value.is_finite() && value.fract() == 0.0 && value.abs() <= 9.007e15 {
                Cell::Value(value as i64)
            } else {
                Cell::Invalid
            }
        }
        Some(_) => Cell::Invalid,
    }
}

/// A decimal-preserving numeric value, used for nano AI units and multipliers
/// where binary floating point would corrupt the figure being explained.
pub fn decimal(row: &Row<'_>, index: usize) -> Cell<ExactDecimal> {
    match value_ref(row, index) {
        None | Some(ValueRef::Null) => Cell::Absent,
        Some(ValueRef::Integer(value)) => Cell::Value(ExactDecimal::from_i64(value)),
        Some(ValueRef::Real(value)) => {
            ExactDecimal::from_f64(value).map_or(Cell::Invalid, Cell::Value)
        }
        Some(ValueRef::Text(bytes)) => match std::str::from_utf8(bytes).ok() {
            Some(text) => ExactDecimal::parse(text).map_or(Cell::Invalid, Cell::Value),
            None => Cell::Invalid,
        },
        Some(_) => Cell::Invalid,
    }
}

/// Bounded UTF-8 text. Empty strings become [`Cell::Absent`]: the source uses
/// empty and NULL interchangeably for unset metadata.
pub fn text(row: &Row<'_>, index: usize) -> Cell<String> {
    bounded_text(row, index, MAX_TEXT_BYTES)
}

/// Normalize source timestamps so ordering and calendar filters use UTC.
pub fn timestamp(row: &Row<'_>, index: usize) -> Cell<String> {
    match text(row, index) {
        Cell::Value(text) => {
            let parsed = chrono::DateTime::parse_from_rfc3339(&text)
                .map(|time| time.with_timezone(&chrono::Utc))
                .or_else(|_| {
                    chrono::NaiveDateTime::parse_from_str(&text, "%Y-%m-%d %H:%M:%S%.f")
                        .map(|time| time.and_utc())
                });
            parsed
                .map(|time| Cell::Value(time.to_rfc3339_opts(chrono::SecondsFormat::Millis, true)))
                .unwrap_or(Cell::Invalid)
        }
        Cell::Absent => Cell::Absent,
        Cell::Invalid => Cell::Invalid,
    }
}

/// Bounded UTF-8 text with an explicit budget, for the JSON billing payload.
pub fn bounded_text(row: &Row<'_>, index: usize, max_bytes: usize) -> Cell<String> {
    match value_ref(row, index) {
        None | Some(ValueRef::Null) => Cell::Absent,
        Some(ValueRef::Text(bytes)) => {
            if bytes.len() > max_bytes {
                return Cell::Invalid;
            }
            match std::str::from_utf8(bytes) {
                Ok(value) if value.trim().is_empty() => Cell::Absent,
                Ok(value) => Cell::Value(value.to_string()),
                Err(_) => Cell::Invalid,
            }
        }
        Some(ValueRef::Integer(value)) => Cell::Value(value.to_string()),
        Some(_) => Cell::Invalid,
    }
}

/// A boolean stored as SQLite's usual 0/1 integer.
pub fn boolean(row: &Row<'_>, index: usize) -> Cell<bool> {
    match value_ref(row, index) {
        None | Some(ValueRef::Null) => Cell::Absent,
        Some(ValueRef::Integer(0)) => Cell::Value(false),
        Some(ValueRef::Integer(1)) => Cell::Value(true),
        Some(ValueRef::Integer(_)) => Cell::Invalid,
        Some(ValueRef::Text(bytes)) => match std::str::from_utf8(bytes).ok().map(str::trim) {
            Some("true" | "1") => Cell::Value(true),
            Some("false" | "0") => Cell::Value(false),
            _ => Cell::Invalid,
        },
        Some(_) => Cell::Invalid,
    }
}
