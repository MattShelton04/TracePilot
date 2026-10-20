//! Refreshes linked pull requests' GitHub state through the user's `gh`.
//!
//! Each refresh reads what is due from a read-only connection, and returns
//! without starting `gh` when nothing is. Otherwise it takes the network lock
//! (so overlapping refreshes never send duplicate batches), reads the due work
//! again, checks `gh auth status` per host (cached), runs the branch lookups
//! and then the status batch, and writes everything in one short transaction.
//! A failed batch writes nothing and backs the host off for a while.
//!
//! Every `gh` call is logged by the orchestrator under the `tracepilot::gh`
//! target as `gh call`, with its kind, host and item count only.

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::{Arc, Mutex, PoisonError};

use chrono::{DateTime, Duration, SecondsFormat, Utc};
use tracepilot_core::ids::SessionId;
use tracepilot_indexer::index_db::{IndexDb, PullRequestRefreshWrite};
use tracepilot_orchestrator::github::pull_requests::{
    GhCallError, GhHostAuth, GhRunner, gh_host_auth,
};

use super::pull_request_plan::{BranchItem, Plan, StatusItem, updated_refs};
use super::pull_request_policy::{ActiveSpan, branch_due, branch_query, status_due, status_query};
use crate::error::CmdResult;
use crate::types::{PullRequestLookup, PullRequestRefreshResult};

/// Most sessions one list refresh considers.
pub(crate) const MAX_LIST_SESSIONS: usize = 500;
/// Most pull requests one list refresh fetches.
pub(crate) const MAX_LIST_PULL_REQUESTS: usize = 50;
/// At most one list batch this often.
pub(crate) const LIST_INTERVAL: Duration = Duration::seconds(60);
/// How long a host's `gh auth status` answer is reused, signed in or not.
pub(crate) const AUTH_TTL: Duration = Duration::minutes(10);
/// How long automatic refreshes leave a host alone after a failed batch.
pub(crate) const FAILURE_BACKOFF: Duration = Duration::minutes(2);

/// What one refresh call works from.
#[derive(Debug, Clone)]
pub(crate) struct RefreshContext {
    pub index_path: PathBuf,
    /// The `ui.pull_request_lookup` setting.
    pub enabled: bool,
    pub now: DateTime<Utc>,
}

#[derive(Debug, Clone)]
enum Target {
    Session { id: SessionId, force: bool },
    List { ids: Vec<SessionId> },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum HostAuth {
    SignedIn,
    SignedOut,
    NotInstalled,
}

#[derive(Default)]
struct Memory {
    auth: HashMap<String, (HostAuth, DateTime<Utc>)>,
    backoff_until: HashMap<String, DateTime<Utc>>,
    last_list_batch: Option<DateTime<Utc>>,
    last_lookup: Option<PullRequestLookup>,
}

/// Owns the in-memory state behind pull request refreshes: the network lock,
/// cached auth answers, per-host backoff and the list throttle.
pub struct PullRequestRefresher {
    runner: Arc<dyn GhRunner>,
    network: tokio::sync::Mutex<()>,
    memory: Mutex<Memory>,
}

fn result(lookup: PullRequestLookup) -> PullRequestRefreshResult {
    PullRequestRefreshResult {
        lookup,
        updated: Vec::new(),
        links_changed: false,
    }
}

impl PullRequestRefresher {
    pub fn new(runner: Arc<dyn GhRunner>) -> Self {
        Self {
            runner,
            network: tokio::sync::Mutex::new(()),
            memory: Mutex::new(Memory::default()),
        }
    }

    fn memory(&self) -> std::sync::MutexGuard<'_, Memory> {
        self.memory.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// A result for a call that asked GitHub nothing.
    fn idle(&self) -> PullRequestRefreshResult {
        result(self.memory().last_lookup.unwrap_or(PullRequestLookup::Ok))
    }

    fn list_throttled(&self, now: DateTime<Utc>) -> bool {
        self.memory()
            .last_list_batch
            .is_some_and(|last| now - last < LIST_INTERVAL)
    }

    /// Refresh one session's pull requests and pushed branches that are due;
    /// `force` refreshes all of them.
    pub(crate) async fn refresh_session(
        self: &Arc<Self>,
        ctx: RefreshContext,
        id: SessionId,
        force: bool,
    ) -> CmdResult<PullRequestRefreshResult> {
        self.refresh(ctx, Target::Session { id, force }).await
    }

    /// Refresh the due primary pull requests of listed sessions, at most one
    /// batch a minute.
    pub(crate) async fn refresh_list(
        self: &Arc<Self>,
        ctx: RefreshContext,
        mut ids: Vec<SessionId>,
    ) -> CmdResult<PullRequestRefreshResult> {
        ids.truncate(MAX_LIST_SESSIONS);
        self.refresh(ctx, Target::List { ids }).await
    }

    async fn refresh(
        self: &Arc<Self>,
        ctx: RefreshContext,
        target: Target,
    ) -> CmdResult<PullRequestRefreshResult> {
        if !ctx.enabled {
            return Ok(result(PullRequestLookup::Disabled));
        }
        let is_list = matches!(target, Target::List { .. });
        if is_list && self.list_throttled(ctx.now) {
            return Ok(self.idle());
        }
        let (this, plan_ctx, plan_target) = (Arc::clone(self), ctx.clone(), target.clone());
        let due = tokio::task::spawn_blocking(move || {
            this.read_plan(&plan_ctx, &plan_target)
                .map(|plan| !plan.is_empty())
        })
        .await??;
        if !due {
            return Ok(self.idle());
        }

        let _network = self.network.lock().await;
        let this = Arc::clone(self);
        crate::blocking_cmd!({
            // Another refresh may have done the work while this one waited.
            if is_list && this.list_throttled(ctx.now) {
                return Ok(this.idle());
            }
            let plan = this.read_plan(&ctx, &target)?;
            if plan.is_empty() {
                return Ok(this.idle());
            }
            if is_list {
                this.memory().last_list_batch = Some(ctx.now);
            }
            Ok::<_, crate::error::BindingsError>(this.execute(&ctx, plan))
        })
    }

    fn read_plan(&self, ctx: &RefreshContext, target: &Target) -> CmdResult<Plan> {
        if !ctx.index_path.exists() {
            return Ok(Plan::default());
        }
        let db = IndexDb::open_readonly(&ctx.index_path)?;
        let now = ctx.now;
        let backed_off: HashSet<String> = self
            .memory()
            .backoff_until
            .iter()
            .filter(|(_, until)| now < **until)
            .map(|(host, _)| host.clone())
            .collect();
        let open =
            |host: &str, force: bool| force || !backed_off.contains(&host.to_ascii_lowercase());

        match target {
            Target::Session { id, force } => {
                let force = *force;
                let Some(lookups) = db.session_pull_request_lookups(id)? else {
                    return Ok(Plan::default());
                };
                let (created, updated) =
                    (lookups.created_at.as_deref(), lookups.updated_at.as_deref());
                let statuses = lookups
                    .pull_requests
                    .into_iter()
                    .filter(|fetch| open(&fetch.key.host, force) && status_due(fetch, now, force))
                    .filter_map(|fetch| {
                        status_query(&fetch).map(|query| StatusItem { fetch, query })
                    })
                    .collect();
                let branches = lookups
                    .branches
                    .into_iter()
                    .filter(|branch| {
                        open(&branch.host, force)
                            && branch_due(branch, created, updated, now, force)
                    })
                    .filter_map(|lookup| {
                        let query = branch_query(&lookup)?;
                        let span =
                            ActiveSpan::new(lookup.first_push_at.as_deref(), created, updated);
                        Some(BranchItem {
                            session_id: id.clone(),
                            lookup,
                            query,
                            span,
                        })
                    })
                    .collect();
                Ok(Plan {
                    statuses,
                    branches,
                    force,
                })
            }
            Target::List { ids } => {
                let statuses = db
                    .primary_pull_request_fetch_states(ids)?
                    .into_iter()
                    .filter(|fetch| open(&fetch.key.host, false) && status_due(fetch, now, false))
                    .filter_map(|fetch| {
                        status_query(&fetch).map(|query| StatusItem { fetch, query })
                    })
                    .take(MAX_LIST_PULL_REQUESTS)
                    .collect();
                Ok(Plan {
                    statuses,
                    ..Plan::default()
                })
            }
        }
    }

    /// `gh auth status` for a host, reused for [`AUTH_TTL`]. A forced refresh
    /// asks again when the cached answer was not signed in.
    fn host_auth(
        &self,
        host: &str,
        now: DateTime<Utc>,
        force: bool,
    ) -> Result<HostAuth, GhCallError> {
        if let Some((auth, at)) = self.memory().auth.get(host).copied()
            && now - at < AUTH_TTL
            && (auth == HostAuth::SignedIn || !force)
        {
            return Ok(auth);
        }
        let auth = match gh_host_auth(&*self.runner, host) {
            Ok(GhHostAuth::SignedIn) => HostAuth::SignedIn,
            Ok(GhHostAuth::SignedOut) => HostAuth::SignedOut,
            Err(GhCallError::NotInstalled) => HostAuth::NotInstalled,
            Err(error) => return Err(error),
        };
        self.memory().auth.insert(host.to_string(), (auth, now));
        Ok(auth)
    }

    fn back_off(&self, hosts: &[String], now: DateTime<Utc>, kind: &'static str) {
        tracing::warn!(target: "tracepilot::gh", kind, hosts = hosts.len(), "pull request lookup failed; backing off");
        let mut memory = self.memory();
        for host in hosts {
            memory
                .backoff_until
                .insert(host.clone(), now + FAILURE_BACKOFF);
        }
    }

    fn remember(&self, lookup: PullRequestLookup) -> PullRequestRefreshResult {
        self.memory().last_lookup = Some(lookup);
        result(lookup)
    }

    fn execute(&self, ctx: &RefreshContext, mut plan: Plan) -> PullRequestRefreshResult {
        let now = ctx.now;
        let hosts = plan.hosts();
        let mut signed_in = HashSet::new();
        let mut blocked = None;
        for host in &hosts {
            match self.host_auth(host, now, plan.force) {
                Ok(HostAuth::SignedIn) => {
                    signed_in.insert(host.clone());
                }
                Ok(HostAuth::NotInstalled) => {
                    return self.remember(PullRequestLookup::NotInstalled);
                }
                Ok(HostAuth::SignedOut) => blocked = Some(PullRequestLookup::SignedOut),
                Err(error) => {
                    self.back_off(std::slice::from_ref(host), now, error.kind());
                    blocked = blocked.or(Some(PullRequestLookup::Failed));
                }
            }
        }
        if signed_in.is_empty() {
            return match blocked {
                Some(PullRequestLookup::Failed) | None => result(PullRequestLookup::Failed),
                Some(lookup) => self.remember(lookup),
            };
        }
        plan.retain_hosts(&signed_in);

        let mut write = PullRequestRefreshWrite::default();
        let runner = &*self.runner;
        if let Err((host, error)) = plan
            .lookup_branches(runner, &mut write)
            .and_then(|()| plan.lookup_statuses(runner, &mut write))
        {
            self.back_off(&[host], now, error.kind());
            return result(PullRequestLookup::Failed);
        }

        let fetched_at = now.to_rfc3339_opts(SecondsFormat::Secs, true);
        let written = IndexDb::open_or_create(&ctx.index_path)
            .and_then(|db| db.write_pull_request_refresh(&write, &fetched_at));
        let links_changed = match written {
            Ok(changed) => changed,
            Err(error) => {
                tracing::warn!(
                    busy = error.is_busy(),
                    "Could not store pull request lookups"
                );
                let hosts: Vec<String> = signed_in.into_iter().collect();
                self.back_off(&hosts, now, "write");
                return result(PullRequestLookup::Failed);
            }
        };
        let mut done = self.remember(PullRequestLookup::Ok);
        done.updated = updated_refs(&plan, &write);
        done.links_changed = links_changed;
        done
    }
}

#[cfg(test)]
#[path = "pull_request_status_tests.rs"]
mod tests;
