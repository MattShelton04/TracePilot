//! A rewound launch still incurred usage. Anchor its children for accounting,
//! while keeping every child record native-only and out of Conversation.

use super::records::{Blocks, Rec, block_type};
use super::translate::{Stream, Translator};
use crate::error::Result;

impl<F: Fn() -> bool> Translator<'_, F> {
    pub(super) fn abandoned_children(
        &mut self,
        st: &Stream<'_>,
        rec: Rec<'_>,
        line: usize,
    ) -> Result<()> {
        let Blocks::Array(blocks) = rec.blocks() else {
            return Ok(());
        };
        for block in blocks {
            if block_type(block) != "tool_use" {
                continue;
            }
            let Some(id) = block["id"].as_str() else {
                continue;
            };
            let children = self.launches.get(id).cloned().unwrap_or_default();
            for index in children {
                let streams = self.children;
                let child = &streams[index];
                if !self.inserted.insert(child.agent_id.clone()) {
                    continue;
                }
                let mut child_stream = self.stream(
                    Some(child.agent_id.clone()),
                    Some(id.to_string()),
                    Some(st.anchor.unwrap_or(line)),
                    &child.lines,
                );
                child_stream.inherited_abandoned = true;
                self.run(&mut child_stream)?;
            }
        }
        Ok(())
    }
}
