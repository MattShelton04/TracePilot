use crate::document::{EventParseWarning, ParseDiagnosticsExport, SectionId};
use crate::options::ExportOptions;

pub(in crate::builder) fn build_parse_diagnostics(
    options: &ExportOptions,
    diagnostics: Option<&tracepilot_core::parsing::diagnostics::ParseDiagnostics>,
    total_events: usize,
    available: &mut Vec<SectionId>,
) -> Option<ParseDiagnosticsExport> {
    if !options.includes(SectionId::ParseDiagnostics) {
        return None;
    }
    let diag = diagnostics?;

    available.push(SectionId::ParseDiagnostics);
    Some(ParseDiagnosticsExport {
        total_events,
        malformed_lines: diag.malformed_lines,
        unknown_event_types: diag.unknown_event_types.len(),
        deserialization_failures: diag.deserialization_failures.len(),
        warnings: if diag.has_warnings() {
            // Reconstruct warnings from the diagnostic maps
            let mut warnings = Vec::new();
            for event_type in diag.unknown_event_types.keys() {
                warnings.push(EventParseWarning::UnknownEventType {
                    event_type: event_type.clone(),
                });
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
