/// Statistics about what the redaction engine modified.
#[derive(Debug, Clone, Default)]
pub struct RedactionStats {
    /// Number of string fields that were modified.
    pub fields_redacted: usize,
    /// Number of individual pattern matches replaced.
    pub total_replacements: usize,
}
