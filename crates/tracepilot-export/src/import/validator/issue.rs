/// A validation finding — either blocking (error) or advisory (warning).
#[derive(Debug, Clone)]
pub struct ValidationIssue {
    pub severity: IssueSeverity,
    pub message: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IssueSeverity {
    Error,
    Warning,
}

impl ValidationIssue {
    pub fn error(msg: &str) -> Self {
        Self {
            severity: IssueSeverity::Error,
            message: msg.to_string(),
        }
    }

    pub fn warning(msg: &str) -> Self {
        Self {
            severity: IssueSeverity::Warning,
            message: msg.to_string(),
        }
    }

    pub fn is_error(&self) -> bool {
        self.severity == IssueSeverity::Error
    }
}
