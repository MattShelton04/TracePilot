//! Per-application mutation ordering and data-root leases.
//!
//! Capture operations read the root under a lease. A relocation takes exclusive
//! access before copying and publishing a new root. Owned guards can outlive an
//! IPC future while its blocking filesystem work completes.

use std::sync::Arc;
use tokio::sync::{Mutex, OwnedMutexGuard, OwnedRwLockReadGuard, OwnedRwLockWriteGuard, RwLock};

#[derive(Default)]
pub struct ConfigCoordinator {
    mutation: Arc<Mutex<()>>,
    root: Arc<RwLock<()>>,
}

impl ConfigCoordinator {
    pub async fn mutation(&self) -> OwnedMutexGuard<()> {
        self.mutation.clone().lock_owned().await
    }

    pub async fn root_read(&self) -> OwnedRwLockReadGuard<()> {
        self.root.clone().read_owned().await
    }

    pub async fn root_write(&self) -> OwnedRwLockWriteGuard<()> {
        self.root.clone().write_owned().await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn relocation_waits_for_a_capture_and_excludes_new_captures() {
        let coordinator = Arc::new(ConfigCoordinator::default());
        let capture = coordinator.root_read().await;
        assert!(coordinator.root.try_write().is_err());
        drop(capture);
        let relocation = coordinator.root_write().await;
        assert!(coordinator.root.try_read().is_err());
        drop(relocation);
        assert!(coordinator.root.try_read().is_ok());
    }
}
