use tracepilot_core::parsing::diagnostics::ParseDiagnostics;
use tracepilot_core::provider::FormatObservations;

use crate::document::{EventParseWarning, ParseDiagnosticsExport, SectionId};
use crate::options::ExportOptions;

/// The suffix a source's drift report gives a known type whose payload
/// failed to decode (`provider::claude_code::drift`); those are counted as
/// deserialization failures, not unknown types.
const UNDECODABLE_SUFFIX: &str = ":undecodable";

/// `format` is what the source's parser reported it has no mapping for, as
/// Settings › Session format diagnostics shows it. When present it decides
/// the unknown types: Claude Code keeps bookkeeping records (`ai-title`,
/// `pr-link`) and known attachments as Events-tab records, which the shared
/// event parser alone would count as unknown.
pub(in crate::builder) fn build_parse_diagnostics(
    options: &ExportOptions,
    diagnostics: Option<&ParseDiagnostics>,
    format: Option<&FormatObservations>,
    total_events: usize,
    available: &mut Vec<SectionId>,
) -> Option<ParseDiagnosticsExport> {
    if !options.includes(SectionId::ParseDiagnostics) {
        return None;
    }
    let diag = diagnostics?;
    let unknown_types = unknown_types(diag, format);

    available.push(SectionId::ParseDiagnostics);
    Some(ParseDiagnosticsExport {
        total_events,
        malformed_lines: diag.malformed_lines,
        unknown_event_types: unknown_types.len(),
        deserialization_failures: diag.deserialization_failures.len(),
        warnings: if !unknown_types.is_empty()
            || !diag.deserialization_failures.is_empty()
            || diag.malformed_lines > 0
        {
            // Reconstruct warnings from the diagnostic maps
            let mut warnings = Vec::new();
            for event_type in unknown_types {
                warnings.push(EventParseWarning::UnknownEventType { event_type });
            }
            for (event_type, info) in &diag.deserialization_failures {
                warnings.push(EventParseWarning::DeserializationFailed {
                    event_type: event_type.clone(),
                    error: info.first_error.clone(),
                });
            }
            Some(warnings)
        } else {
            None
        },
    })
}

/// The unknown types, by name: the source's unmapped record types, then its
/// unmapped attachment types as `attachment:<type>` (the name the Events tab
/// shows), or, for a source that reports no format, every type the event
/// parser didn't know.
fn unknown_types(diag: &ParseDiagnostics, format: Option<&FormatObservations>) -> Vec<String> {
    let Some(format) = format else {
        let mut names: Vec<String> = diag.unknown_event_types.keys().cloned().collect();
        names.sort();
        return names;
    };
    let records = format
        .unmapped_record_types
        .keys()
        .filter(|name| !name.ends_with(UNDECODABLE_SUFFIX))
        .cloned();
    let attachments = format
        .unmapped_attachment_types
        .keys()
        .map(|name| format!("attachment:{name}"));
    records.chain(attachments).collect()
}

#[cfg(test)]
mod tests {
    use std::collections::{BTreeMap, HashMap};

    use super::*;
    use crate::options::ExportFormat;

    fn diagnostics(unknown: &[&str]) -> ParseDiagnostics {
        ParseDiagnostics {
            unknown_event_types: unknown.iter().map(|n| (n.to_string(), 1)).collect(),
            deserialization_failures: HashMap::from([(
                "session.shutdown".to_string(),
                tracepilot_core::parsing::diagnostics::DeserFailureInfo {
                    count: 1,
                    first_error: "bad".to_string(),
                },
            )]),
            ..Default::default()
        }
    }

    fn build(
        diag: &ParseDiagnostics,
        format: Option<&FormatObservations>,
    ) -> ParseDiagnosticsExport {
        let options = ExportOptions::all(ExportFormat::Json);
        build_parse_diagnostics(&options, Some(diag), format, 10, &mut Vec::new()).unwrap()
    }

    /// A source's format report decides what is unknown; a known type that
    /// failed to decode is a deserialization failure, not also an unknown type.
    #[test]
    fn format_report_decides_the_unknown_types() {
        let diag = diagnostics(&["ai-title", "pr-link", "attachment:date", "brand-new"]);
        let format = FormatObservations {
            unmapped_record_types: BTreeMap::from([
                ("brand-new".to_string(), 2),
                ("session.shutdown:undecodable".to_string(), 1),
            ]),
            unmapped_attachment_types: BTreeMap::from([("x".to_string(), 1)]),
            versions: BTreeMap::new(),
        };

        let export = build(&diag, Some(&format));

        assert_eq!(export.unknown_event_types, 2);
        assert_eq!(export.deserialization_failures, 1);
        let unknown: Vec<_> = export
            .warnings
            .unwrap()
            .into_iter()
            .filter_map(|w| match w {
                EventParseWarning::UnknownEventType { event_type } => Some(event_type),
                EventParseWarning::DeserializationFailed { .. } => None,
            })
            .collect();
        assert_eq!(unknown, ["brand-new", "attachment:x"]);
    }

    /// Without a format report (Copilot's directory export) every type the
    /// event parser didn't know counts, in name order.
    #[test]
    fn without_a_format_report_every_unknown_event_type_counts() {
        let export = build(&diagnostics(&["b.new", "a.new"]), None);
        assert_eq!(export.unknown_event_types, 2);
        assert!(matches!(
            &export.warnings.unwrap()[..2],
            [
                EventParseWarning::UnknownEventType { event_type: a },
                EventParseWarning::UnknownEventType { event_type: b },
            ] if a == "a.new" && b == "b.new"
        ));
    }
}
