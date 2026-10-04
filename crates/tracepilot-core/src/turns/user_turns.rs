//! Grouping agent turns into the user requests they serve.
//!
//! A [`ConversationTurn`] is one agent turn (`assistant.turn_start` →
//! `assistant.turn_end`). Answering one user message usually takes several,
//! and the user turn is what effort, cost and phase views compare.
//!
//! Copilot CLI 1.0.88+ stamps every main-agent `assistant.message` with the
//! `originatingMessageId` of the user message whose request it serves. That ID
//! stays the same across tool iterations and steering, so it decides the
//! request whenever it names a user message seen in the log. Older logs fall
//! back to message order: a user message starts a new request unless its
//! `delivery` says it steered the running one. Agent turns without a typed
//! user message (tool iterations, runs woken by a system notification)
//! continue the previous request.

use std::collections::{HashMap, HashSet};

use crate::models::conversation::ConversationTurn;

/// Set [`ConversationTurn::user_turn_index`] on every turn.
pub fn assign_user_turns(turns: &mut [ConversationTurn]) {
    let indices = user_turn_indices(turns);
    for (turn, index) in turns.iter_mut().zip(indices) {
        turn.user_turn_index = Some(index);
    }
}

/// The user turn of each agent turn, in order.
pub fn user_turn_indices(turns: &[ConversationTurn]) -> Vec<usize> {
    let mut indices = Vec::with_capacity(turns.len());
    // Message ID → user turn, once that message's request has started.
    let mut started: HashMap<String, usize> = HashMap::new();
    // User messages logged before the run that serves them (queued while busy).
    let mut waiting: HashSet<String> = HashSet::new();
    let mut count = 0usize;
    let mut current: Option<usize> = None;

    for turn in turns {
        let own_id = turn.user_message_id.clone();
        let has_user_message = turn.user_message.is_some() && !turn.system_initiated;
        let steering = turn.user_message_delivery.as_deref() == Some("steering");
        let origin = turn.originating_message_id.as_deref();

        let mut start = |key: Option<&str>, started: &mut HashMap<String, usize>| {
            let index = count;
            count += 1;
            if let Some(key) = key {
                started.insert(key.to_string(), index);
            }
            index
        };

        let index = match origin {
            Some(id) if started.contains_key(id) => started[id],
            Some(id)
                if waiting.remove(id) || (has_user_message && own_id.as_deref() == Some(id)) =>
            {
                start(Some(id), &mut started)
            }
            _ if has_user_message && !steering => start(own_id.as_deref(), &mut started),
            _ => match current {
                Some(index) => index,
                None => start(own_id.as_deref(), &mut started),
            },
        };

        if has_user_message
            && let Some(id) = own_id
            && !started.contains_key(&id)
        {
            waiting.insert(id);
        }
        current = Some(index);
        indices.push(index);
    }
    indices
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::turns::reconstructor::new_turn;

    fn agent_turn(origin: Option<&str>) -> ConversationTurn {
        let mut turn = new_turn(0, None, None, None, None, None);
        turn.originating_message_id = origin.map(str::to_string);
        turn
    }

    fn user_turn(id: Option<&str>, delivery: &str, origin: Option<&str>) -> ConversationTurn {
        let mut turn = agent_turn(origin);
        turn.user_message = Some(format!("message {}", id.unwrap_or("?")));
        turn.user_message_id = id.map(str::to_string);
        turn.user_message_delivery = Some(delivery.to_string());
        turn
    }

    fn indices(mut turns: Vec<ConversationTurn>) -> Vec<usize> {
        assign_user_turns(&mut turns);
        turns.iter().map(|t| t.user_turn_index.unwrap()).collect()
    }

    #[test]
    fn older_logs_group_agent_turns_under_the_preceding_user_message() {
        let turns = vec![
            agent_turn(None),
            user_turn(None, "idle", None),
            agent_turn(None),
            agent_turn(None),
            user_turn(None, "idle", None),
        ];
        // Agent activity before any user message forms its own request.
        assert_eq!(indices(turns), vec![0, 1, 1, 1, 2]);
    }

    #[test]
    fn steering_stays_in_the_request_it_redirects() {
        let with_origin = vec![
            user_turn(Some("p"), "idle", Some("p")),
            agent_turn(Some("p")),
            user_turn(Some("s"), "steering", Some("p")),
            agent_turn(Some("p")),
            user_turn(Some("n"), "idle", Some("n")),
        ];
        assert_eq!(indices(with_origin), vec![0, 0, 0, 0, 1]);

        // Without originatingMessageId, delivery alone keeps steering in place.
        let delivery_only = vec![
            user_turn(Some("p"), "idle", None),
            user_turn(Some("s"), "steering", None),
            agent_turn(None),
        ];
        assert_eq!(indices(delivery_only), vec![0, 0, 0]);
    }

    #[test]
    fn a_queued_message_logged_mid_run_starts_its_request_when_served() {
        let turns = vec![
            user_turn(Some("p"), "idle", Some("p")),
            // Logged while the agent was still answering "p".
            user_turn(Some("q"), "queued", Some("p")),
            agent_turn(Some("p")),
            agent_turn(Some("q")),
            agent_turn(Some("q")),
        ];
        assert_eq!(indices(turns), vec![0, 0, 0, 1, 1]);
    }

    #[test]
    fn messages_copilot_injected_continue_the_current_request() {
        let mut notification = user_turn(Some("n"), "idle", Some("n"));
        notification.system_initiated = true;
        let turns = vec![
            user_turn(Some("p"), "idle", Some("p")),
            notification,
            agent_turn(Some("n")),
            user_turn(Some("q"), "idle", Some("q")),
        ];
        assert_eq!(indices(turns), vec![0, 0, 0, 1]);
    }

    #[test]
    fn runs_without_a_user_origin_continue_the_current_request() {
        // A notification wakes the agent: no originatingMessageId, or one
        // that is not a user message in this log.
        let turns = vec![
            user_turn(Some("p"), "idle", Some("p")),
            agent_turn(None),
            agent_turn(Some("notification-1")),
        ];
        assert_eq!(indices(turns), vec![0, 0, 0]);
    }
}
