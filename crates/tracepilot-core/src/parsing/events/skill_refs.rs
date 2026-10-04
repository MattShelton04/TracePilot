//! Resolve deduplicated skill receipts against earlier inline skill bodies.
//!
//! Copilot CLI 1.0.86+ writes a skill's body once, in the first inline
//! `skill.invoked`. Later `skill.invoked_ref` and every
//! `skill.context_delivered_ref` name it by `contentId`, which is
//! `sha256:<lowercase hex>` over the UTF-8 bytes of that `content`. Bodies are
//! hashed lazily, only once a reference appears, so sessions without
//! references pay nothing beyond keeping their skill bodies until parsing ends.

use std::collections::HashMap;

use sha2::{Digest, Sha256};

use super::types::TypedEventData;

#[derive(Default)]
pub(super) struct SkillContentResolver {
    unhashed: Vec<String>,
    by_id: HashMap<String, String>,
}

pub(crate) fn skill_content_id(content: &str) -> String {
    format!("sha256:{:x}", Sha256::digest(content.as_bytes()))
}

impl SkillContentResolver {
    pub(super) fn observe(&mut self, data: &mut TypedEventData) {
        match data {
            TypedEventData::SkillInvoked(invoked) => {
                if let Some(content) = invoked.content.as_ref().filter(|c| !c.is_empty()) {
                    self.unhashed.push(content.clone());
                }
            }
            TypedEventData::SkillInvokedRef(reference) => {
                reference.resolved_content = self.resolve(reference.content_id.as_deref());
            }
            TypedEventData::SkillContextDeliveredRef(reference) => {
                reference.resolved_content = self.resolve(reference.content_id.as_deref());
            }
            _ => {}
        }
    }

    fn resolve(&mut self, content_id: Option<&str>) -> Option<String> {
        let content_id = content_id?;
        for content in self.unhashed.drain(..) {
            self.by_id.insert(skill_content_id(&content), content);
        }
        self.by_id.get(content_id).cloned()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::event_types::{
        SkillContextDeliveredRefData, SkillInvokedData, SkillInvokedRefData,
    };

    // Body and contentId taken from a real Copilot CLI 1.0.91 probe session.
    const BODY: &str = "# Probe notes\n\nWhen asked for the probe codeword, answer exactly: TANGERINE-42.\nDo not read any other files.\n";
    const BODY_ID: &str = "sha256:16496d3505aead541459a146c5fd9f4f00cb2fdd6f0a62b601f4115543d79b9b";

    #[test]
    fn content_id_matches_copilot_cli() {
        assert_eq!(skill_content_id(BODY), BODY_ID);
    }

    #[test]
    fn resolves_references_to_earlier_inline_bodies_only() {
        let mut resolver = SkillContentResolver::default();
        let mut early = TypedEventData::SkillInvokedRef(SkillInvokedRefData {
            content_id: Some(BODY_ID.into()),
            ..Default::default()
        });
        resolver.observe(&mut early);
        let TypedEventData::SkillInvokedRef(early) = early else {
            unreachable!()
        };
        assert_eq!(early.resolved_content, None);

        resolver.observe(&mut TypedEventData::SkillInvoked(SkillInvokedData {
            content: Some(BODY.into()),
            ..Default::default()
        }));
        let mut delivered =
            TypedEventData::SkillContextDeliveredRef(SkillContextDeliveredRefData {
                content_id: Some(BODY_ID.into()),
                prefix: Some("<skill-context name=\"probe-notes\">\n".into()),
                suffix: Some("\n</skill-context>".into()),
                ..Default::default()
            });
        resolver.observe(&mut delivered);
        let TypedEventData::SkillContextDeliveredRef(delivered) = delivered else {
            unreachable!()
        };
        assert_eq!(delivered.resolved_content.as_deref(), Some(BODY));
        assert_eq!(
            delivered.delivered_content().unwrap(),
            format!("<skill-context name=\"probe-notes\">\n{BODY}\n</skill-context>")
        );

        let mut unknown = TypedEventData::SkillInvokedRef(SkillInvokedRefData {
            content_id: Some("sha256:00".into()),
            ..Default::default()
        });
        resolver.observe(&mut unknown);
        let TypedEventData::SkillInvokedRef(unknown) = unknown else {
            unreachable!()
        };
        assert_eq!(unknown.resolved_content, None);
    }
}
