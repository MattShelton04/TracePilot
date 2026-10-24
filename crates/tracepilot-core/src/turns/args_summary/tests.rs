//! The shared case table: `formatArgsSummary()` in
//! `packages/ui/src/__tests__/toolCallSummaryParity.test.ts` must produce the
//! same text for every case.

use std::collections::HashSet;

use serde::Deserialize;
use serde_json::Value;

use super::compute_args_summary;

#[derive(Deserialize)]
struct Case {
    name: String,
    tool: String,
    args: Value,
    expected: String,
}

fn cases() -> Vec<Case> {
    serde_json::from_str(include_str!(
        "../../../tests/fixtures/contracts/tool-args-summary.json"
    ))
    .expect("the case table is valid JSON")
}

#[test]
fn matches_the_frontend_case_table() {
    let failures: Vec<String> = cases()
        .iter()
        .filter_map(|case| {
            let actual = compute_args_summary(&case.tool, &case.args);
            (actual != case.expected).then(|| {
                format!(
                    "{}: {} {}\n  expected {:?}\n  actual   {:?}",
                    case.name, case.tool, case.args, case.expected, actual
                )
            })
        })
        .collect();
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

#[test]
fn case_names_are_unique() {
    let cases = cases();
    let names: HashSet<&str> = cases.iter().map(|case| case.name.as_str()).collect();
    assert_eq!(names.len(), cases.len());
}
