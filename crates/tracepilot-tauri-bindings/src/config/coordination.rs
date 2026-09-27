//! Per-application mutation ordering and data-root leases.
//!
//! Durable data writers and capture operations read the root under a lease.
//! A relocation takes exclusive access before copying and publishing a new root.
//! Owned guards outlive an IPC future while its blocking filesystem work completes.

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

    #[tokio::test]
    async fn cancelled_command_keeps_the_root_leased_until_its_worker_finishes() {
        use std::time::Duration;

        let temp = tempfile::tempdir().unwrap();
        let target = temp.path().join("repo-registry.json");
        let coordinator = Arc::new(ConfigCoordinator::default());
        let (started_tx, started_rx) = tokio::sync::oneshot::channel();
        let (finish_tx, finish_rx) = std::sync::mpsc::channel();
        let command: tokio::task::JoinHandle<crate::error::CmdResult<()>> = {
            let coordinator = coordinator.clone();
            let target = target.clone();
            tokio::spawn(async move {
                let root_lease = coordinator.root_read().await;
                // Exercise the same blocking command boundary as registry,
                // template, and backup writes. Aborting its caller must not
                // let relocation copy the root before this write completes.
                crate::blocking_cmd!({
                    let _root_lease = root_lease;
                    started_tx.send(()).unwrap();
                    finish_rx.recv_timeout(Duration::from_secs(2)).unwrap();
                    std::fs::write(target, "completed")?;
                    Ok::<_, crate::error::BindingsError>(())
                })
            })
        };
        tokio::time::timeout(Duration::from_secs(2), started_rx)
            .await
            .unwrap()
            .unwrap();
        command.abort();
        assert!(command.await.unwrap_err().is_cancelled());
        assert!(coordinator.root.try_write().is_err());
        finish_tx.send(()).unwrap();
        let _relocation = tokio::time::timeout(Duration::from_secs(2), coordinator.root_write())
            .await
            .unwrap();
        assert_eq!(std::fs::read_to_string(target).unwrap(), "completed");
    }
}
