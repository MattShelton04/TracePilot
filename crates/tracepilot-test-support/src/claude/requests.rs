//! Claude Code 2.1.301+ request records (`record-shapes.md` §3.2): the
//! system prompt and tool list once per distinct set, each request's
//! parameters, and request messages by hash. Every text is invented.

use serde_json::{Value, json};

use super::Transcript;

/// The Claude Code version that writes request records.
pub const REQUEST_RECORDS_VERSION: &str = "2.1.302";

impl Transcript {
    /// A request record's time: the next [`Transcript::at`] if set, else the
    /// current clock without advancing it, so records before a call leave
    /// the call's own times unchanged.
    fn request_stamp(&mut self) -> String {
        if self.next_at.is_none() {
            self.next_at = Some(self.clock_s);
        }
        self.timestamp()
    }

    fn request_record(&mut self, kind: &str, timed: bool, mut body: Value) {
        body["type"] = json!(kind);
        if timed {
            body["timestamp"] = json!(self.request_stamp());
            body["version"] = json!(REQUEST_RECORDS_VERSION);
        }
        if let Some(agent) = self.agent_id.clone() {
            body["agentId"] = json!(agent);
        }
        self.bookkeeping(body);
    }

    /// An `api-request-shape`: the system blocks and tool definitions that
    /// requests using `hash` sent.
    pub fn api_request_shape(&mut self, hash: &str, system: &[&str], tools: Vec<Value>) {
        let system: Vec<Value> = system
            .iter()
            .map(|text| json!({"type": "text", "text": text}))
            .collect();
        self.request_record(
            "api-request-shape",
            true,
            json!({"shapeHash": hash, "shape": {"system": system, "tools": tools}}),
        );
    }

    /// An `api-request-blob`: one request message, by hash.
    pub fn api_request_blob(&mut self, hash: &str, role: &str, content: Value) {
        self.request_record(
            "api-request-blob",
            false,
            json!({"hash": hash, "message": {"role": role, "content": content}}),
        );
    }

    /// An `api-request`: one model call's parameters, the shape it used, the
    /// earlier request it extends and its new messages' hashes.
    pub fn api_request(
        &mut self,
        id: &str,
        base: Option<&str>,
        shape_hash: &str,
        model: &str,
        tail: &[&str],
    ) {
        let query_source = if self.agent_id.is_some() {
            "agent:builtin:general-purpose"
        } else {
            "repl_main_thread"
        };
        let mut body = json!({
            "id": id,
            "shapeHash": shape_hash,
            "params": {
                "model": model,
                "max_tokens": 64000,
                "thinking": {"type": "adaptive"},
                "betas": ["synthetic-beta-2026-01-01"],
                "context_management": {"edits": [{"type": "clear_thinking", "keep": "all"}]},
                "output_config": {"effort": "high"},
                "safeguards": [{"type": "classifier", "classifier_context": {"user_identity": "dev@example.com"}}],
            },
            "keep": 2,
            "tail": tail,
            "cacheControl": [
                {"path": ["system", 0], "value": {"type": "ephemeral"}},
                {"path": ["tools", -1], "value": {"type": "ephemeral"}},
            ],
            "requestDigest": format!("digest-{id}"),
            "querySource": query_source,
        });
        if let Some(base) = base {
            body["base"] = json!(base);
        }
        self.request_record("api-request", true, body);
    }
}
