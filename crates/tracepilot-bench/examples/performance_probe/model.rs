use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::error::Error;

use super::validate::fail;

pub(super) const FIXTURE_VERSION: u32 = 1;
pub(super) const PROBE_VERSION: u32 = 1;
pub(super) const MARKER_FILE: &str = ".tracepilot-performance-corpus";
pub(super) const MANIFEST_FILE: &str = "fixture-manifest.json";
pub(super) const STRESS_LABEL: &str = "TRACEPILOT_SYNTHETIC_1_MIB_STRESS_OUTPUT";
pub(super) const SEARCH_SENTINEL: &str = "refactor";
pub(super) const UUID_BASE: u128 = 0x7ace_1000_0000_4000_8000_0000_0000_0000;

pub(super) type AnyError = Box<dyn Error + Send + Sync>;

#[derive(Debug, Clone, Copy)]
pub(super) enum Scale {
    Small,
    Typical,
    Large,
    Massive,
}

impl Scale {
    pub(super) fn parse(value: &str) -> Result<Self, AnyError> {
        match value {
            "small" => Ok(Self::Small),
            "typical" => Ok(Self::Typical),
            "large" => Ok(Self::Large),
            "massive" => Ok(Self::Massive),
            _ => fail(format!(
                "unknown scale '{value}'; expected small, typical, large, or massive"
            )),
        }
    }

    pub(super) fn name(self) -> &'static str {
        match self {
            Self::Small => "small",
            Self::Typical => "typical",
            Self::Large => "large",
            Self::Massive => "massive",
        }
    }

    pub(super) fn session_count(self) -> usize {
        match self {
            Self::Small => 10,
            Self::Typical => 100,
            Self::Large => 1_000,
            Self::Massive => 500,
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct FixtureManifest {
    pub(super) fixture_version: u32,
    pub(super) generator: String,
    pub(super) scale: String,
    pub(super) root: String,
    pub(super) stable_sentinels: StableSentinels,
    pub(super) sessions: Vec<ManifestSession>,
    pub(super) totals: ManifestTotals,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct StableSentinels {
    pub(super) search_term: String,
    pub(super) stress_label: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ManifestSession {
    pub(super) id: String,
    pub(super) title: String,
    pub(super) profile: String,
    pub(super) event_count: usize,
    pub(super) turn_count: usize,
    pub(super) tool_call_count: usize,
    pub(super) expected_search_matches: usize,
    pub(super) stress_bytes: usize,
    #[serde(default)]
    pub(super) source_bytes: u64,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ManifestTotals {
    pub(super) session_count: usize,
    pub(super) event_count: usize,
    pub(super) turn_count: usize,
    pub(super) tool_call_count: usize,
    pub(super) expected_search_matches: usize,
    pub(super) stress_bytes: usize,
    #[serde(default)]
    pub(super) source_bytes: u64,
    pub(super) file_count: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ProbeReport {
    pub(super) probe_version: u32,
    pub(super) fixture_version: u32,
    pub(super) scale: String,
    pub(super) corpus_root: String,
    pub(super) command: Vec<String>,
    pub(super) repeats: usize,
    pub(super) clock: &'static str,
    pub(super) caveats: Vec<&'static str>,
    pub(super) verification: Value,
    pub(super) operations: Vec<OperationSamples>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct OperationSamples {
    pub(super) name: String,
    pub(super) metric: &'static str,
    pub(super) unit: &'static str,
    pub(super) corpus: Value,
    pub(super) samples: Vec<u64>,
    pub(super) response_bytes: Option<usize>,
    pub(super) result: Value,
}
