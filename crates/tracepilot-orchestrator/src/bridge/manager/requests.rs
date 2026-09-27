//! Shared request deadline and lifecycle cancellation, independent of manager locks.
use crate::bridge::BridgeError;
use std::future::Future;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::watch;

pub(super) const RPC_TIMEOUT: Duration = Duration::from_secs(15);
pub(super) const CLEANUP_TIMEOUT: Duration = Duration::from_secs(2);

#[derive(Clone)]
pub(super) struct RequestScope(Arc<watch::Sender<bool>>);

impl Default for RequestScope {
    fn default() -> Self {
        Self(Arc::new(watch::channel(false).0))
    }
}

impl RequestScope {
    pub(super) fn same(&self, other: &Self) -> bool {
        Arc::ptr_eq(&self.0, &other.0)
    }

    pub(super) fn cancel(&self) {
        self.0.send_replace(true);
    }

    pub(super) fn check(&self) -> Result<(), BridgeError> {
        if *self.0.borrow() {
            Err(BridgeError::Cancelled)
        } else {
            Ok(())
        }
    }

    pub(super) async fn run<T>(
        &self,
        operation: &str,
        future: impl Future<Output = Result<T, BridgeError>>,
    ) -> Result<T, BridgeError> {
        let mut cancelled = self.0.subscribe();
        self.check()?;
        tokio::select! {
            biased;
            _ = cancelled.changed() => Err(BridgeError::Cancelled),
            result = bounded(RPC_TIMEOUT, operation, future) => result,
        }
    }
}

pub(super) async fn bounded<T>(
    timeout: Duration,
    operation: &str,
    future: impl Future<Output = Result<T, BridgeError>>,
) -> Result<T, BridgeError> {
    tokio::time::timeout(timeout, future)
        .await
        .map_err(|elapsed| BridgeError::Timeout(format!("{operation}: {elapsed}")))?
}

pub(super) async fn stop_client(client: github_copilot_sdk::Client) {
    if bounded(CLEANUP_TIMEOUT, "stopping SDK client", async {
        client.stop().await.map_err(BridgeError::sdk)
    })
    .await
    .is_err()
    {
        client.force_stop();
    }
}
