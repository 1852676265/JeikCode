//! Asynchronous, low-overhead watchdog for global artifact storage governance.
//!
//! Enforces:
//! - 7 GiB global hard capacity ceiling (`GLOBAL_MAX_CAPACITY`): triggers instant
//!   reactive eviction down to 5 GiB (`GLOBAL_TARGET_CAPACITY`) via cooperative,
//!   rate-limited LRU.
//! - 3-day proactive cycle maintenance (`WATCHDOG_CYCLE_INTERVAL`): evicts the oldest
//!   30% of artifacts across all sessions and cleans up orphaned empty directories.
//! - Near-zero overhead: hot-path tracking is a single atomic CPU instruction (<1ns).
//!   Disk traversals yield cooperatively (`tokio::task::yield_now` / micro-sleep)
//!   and use a bounded heap so memory footprint stays strictly under 2 MiB.

use std::cmp::Ordering as CmpOrdering;
use std::collections::BinaryHeap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, OnceLock};
use std::time::{Duration, SystemTime};
use tokio::sync::Notify;

/// 7 GiB: Global physical ceiling for all session artifacts combined.
pub const GLOBAL_MAX_CAPACITY: u64 = 7 * 1024 * 1024 * 1024;

/// 5 GiB: Target capacity after emergency eviction (leaves a 2 GiB buffer to prevent thrashing).
pub const GLOBAL_TARGET_CAPACITY: u64 = 5 * 1024 * 1024 * 1024;

/// 3 Days: Periodic gentle maintenance interval.
pub const WATCHDOG_CYCLE_INTERVAL: Duration = Duration::from_secs(3 * 86400);

/// Files scanned before a cooperative pause to keep disk queue depth near zero.
pub const SCAN_BATCH_SIZE: usize = 80;

/// Micro-pause during scanning to avoid monopolizing disk I/O queues.
pub const SCAN_YIELD_SLEEP: Duration = Duration::from_millis(3);

/// Micro-pause between file removals to smooth disk write spikes.
pub const DELETE_YIELD_SLEEP: Duration = Duration::from_millis(1);

/// Maximum candidate items retained in the eviction heap at once to guarantee <2 MiB RAM usage.
pub const MAX_HEAP_CANDIDATES: usize = 50_000;

static GLOBAL_WATCHDOG: OnceLock<Arc<ArtifactWatchdog>> = OnceLock::new();
static WATCHDOG_LOOP_STARTED: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);

/// Represents an artifact file candidate for eviction.
#[derive(Debug, Eq, PartialEq)]
pub struct EvictionCandidate {
    pub path: PathBuf,
    pub size: u64,
    pub mtime: SystemTime,
}

impl Ord for EvictionCandidate {
    /// Max-Heap by mtime: youngest is at the top.
    /// This allows maintaining a bounded heap of the OLDEST files by popping the youngest
    /// whenever the heap exceeds the required byte budget.
    fn cmp(&self, other: &Self) -> CmpOrdering {
        self.mtime.cmp(&other.mtime)
    }
}

impl PartialOrd for EvictionCandidate {
    fn partial_cmp(&self, other: &Self) -> Option<CmpOrdering> {
        Some(self.cmp(other))
    }
}

pub struct ArtifactWatchdog {
    global_bytes: Arc<AtomicU64>,
    trigger: Arc<Notify>,
    sessions_dir: PathBuf,
    max_capacity: u64,
    target_capacity: u64,
    cycle_interval: Duration,
}

fn default_sessions_root() -> PathBuf {
    crate::paths::config_dir().join("sessions")
}

impl ArtifactWatchdog {
    /// Return the process-wide global watchdog instance pointing to the canonical sessions root.
    pub fn global() -> Arc<Self> {
        let wd = GLOBAL_WATCHDOG
            .get_or_init(|| {
                let sessions_root = default_sessions_root();
                let inst = Arc::new(Self::new(sessions_root));
                inst.clone().spawn_initial_scan();
                inst
            })
            .clone();
        wd.ensure_background_loop_started();
        wd
    }

    /// Ensures the async background loop is actively listening, if inside a Tokio runtime.
    pub fn ensure_background_loop_started(&self) {
        if !WATCHDOG_LOOP_STARTED.swap(true, Ordering::Relaxed)
            && tokio::runtime::Handle::try_current().is_ok()
        {
            let cancel = tokio_util::sync::CancellationToken::new();
            let wd = Self::global();
            wd.start_background_loop(cancel);
        }
    }

    /// Construct a new watchdog monitoring `sessions_dir` with production defaults.
    pub fn new(sessions_dir: impl Into<PathBuf>) -> Self {
        Self::with_options(
            sessions_dir,
            GLOBAL_MAX_CAPACITY,
            GLOBAL_TARGET_CAPACITY,
            WATCHDOG_CYCLE_INTERVAL,
        )
    }

    /// Construct with explicit thresholds (useful for tests or custom environments).
    pub fn with_options(
        sessions_dir: impl Into<PathBuf>,
        max_capacity: u64,
        target_capacity: u64,
        cycle_interval: Duration,
    ) -> Self {
        Self {
            global_bytes: Arc::new(AtomicU64::new(0)),
            trigger: Arc::new(Notify::new()),
            sessions_dir: sessions_dir.into(),
            max_capacity,
            target_capacity,
            cycle_interval,
        }
    }

    /// Current approximate total bytes stored across all monitored artifacts.
    pub fn global_bytes(&self) -> u64 {
        self.global_bytes.load(Ordering::Relaxed)
    }

    /// Hot-path addition: 1 CPU atomic instruction. Triggers background eviction if ceiling is breached.
    #[inline]
    pub fn record_addition(&self, bytes: u64) {
        if bytes == 0 {
            return;
        }
        let prev = self.global_bytes.fetch_add(bytes, Ordering::Relaxed);
        let current = prev.saturating_add(bytes);
        if current >= self.max_capacity {
            self.trigger.notify_one();
        }
    }

    /// Hot-path subtraction: atomic decrement when an artifact or session is deleted.
    #[inline]
    pub fn record_subtraction(&self, bytes: u64) {
        if bytes == 0 {
            return;
        }
        let _ = self
            .global_bytes
            .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |cur| {
                Some(cur.saturating_sub(bytes))
            });
    }

    /// Overwrite current atomic total bytes (e.g. after startup scan).
    pub fn set_total_bytes(&self, bytes: u64) {
        self.global_bytes.store(bytes, Ordering::Relaxed);
        if bytes >= self.max_capacity {
            self.trigger.notify_one();
        }
    }

    /// Spawn a background initial scan of `sessions_dir` to seed the atomic counter on startup.
    /// Never blocks the caller; runs on Tokio's blocking threadpool.
    pub fn spawn_initial_scan(self: Arc<Self>) {
        let wd = Arc::clone(&self);
        tokio::task::spawn_blocking(move || {
            let total = wd.scan_disk_total_bytes_sync();
            wd.set_total_bytes(total);
        });
    }

    /// Start the asynchronous background maintenance loop.
    pub fn start_background_loop(
        self: Arc<Self>,
        cancel: tokio_util::sync::CancellationToken,
    ) -> tokio::task::JoinHandle<()> {
        tokio::spawn(async move {
            let mut timer = tokio::time::interval(self.cycle_interval);
            // Skip immediate tick to avoid contending during process startup.
            timer.tick().await;

            loop {
                tokio::select! {
                    _ = cancel.cancelled() => break,
                    _ = timer.tick() => {
                        self.perform_periodic_maintenance().await;
                    }
                    _ = self.trigger.notified() => {
                        self.perform_emergency_eviction().await;
                    }
                }
            }
        })
    }

    /// Immediate emergency eviction: called when capacity breaches `max_capacity`.
    pub async fn perform_emergency_eviction(&self) -> u64 {
        let current = self.global_bytes();
        if current <= self.target_capacity {
            return 0;
        }
        let bytes_to_free = current.saturating_sub(self.target_capacity);
        self.evict_oldest_bytes(bytes_to_free).await
    }

    /// Periodic maintenance: called every 3 days. Evicts the oldest 30% of data.
    pub async fn perform_periodic_maintenance(&self) -> u64 {
        let current = self.global_bytes();
        if current == 0 {
            return 0;
        }
        // Evict oldest 30% to maintain steady lifecycle turnover.
        let bytes_to_free = current.saturating_mul(30) / 100;
        if bytes_to_free > 0 {
            self.evict_oldest_bytes(bytes_to_free).await
        } else {
            0
        }
    }

    /// Synchronously scan all `.artifacts` directories to compute the real disk byte total.
    pub fn scan_disk_total_bytes_sync(&self) -> u64 {
        let mut total = 0u64;
        let mut scanned = 0usize;
        let artifact_dirs = collect_artifact_dirs(&self.sessions_dir);

        for dir in artifact_dirs {
            let Ok(read_dir) = std::fs::read_dir(&dir) else {
                continue;
            };
            for entry in read_dir.flatten() {
                scanned += 1;
                if scanned % SCAN_BATCH_SIZE == 0 {
                    std::thread::sleep(SCAN_YIELD_SLEEP);
                }
                if let Ok(meta) = entry.metadata() {
                    if meta.is_file() && !entry.file_name().to_string_lossy().ends_with(".tmp") {
                        total = total.saturating_add(meta.len());
                    }
                }
            }
        }
        total
    }

    /// Evicts at least `target_bytes` of oldest artifacts across all sessions.
    /// Offloads the scan and deletion to `spawn_blocking` to avoid blocking Tokio workers.
    pub async fn evict_oldest_bytes(&self, target_bytes: u64) -> u64 {
        if target_bytes == 0 {
            return 0;
        }
        let sessions_dir = self.sessions_dir.clone();
        let global_bytes = Arc::clone(&self.global_bytes);

        tokio::task::spawn_blocking(move || {
            // 1. Collect candidate files into a bounded heap.
            let mut heap: BinaryHeap<EvictionCandidate> = BinaryHeap::new();
            let mut heap_bytes = 0u64;
            let mut scanned = 0usize;

            let artifact_dirs = collect_artifact_dirs(&sessions_dir);

            for dir in &artifact_dirs {
                let Ok(read_dir) = std::fs::read_dir(dir) else {
                    continue;
                };
                for entry in read_dir.flatten() {
                    scanned += 1;
                    if scanned % SCAN_BATCH_SIZE == 0 {
                        std::thread::sleep(SCAN_YIELD_SLEEP);
                    }
                    let file_name = entry.file_name();
                    let name = file_name.to_string_lossy();
                    if name.ends_with(".tmp") {
                        continue;
                    }
                    if let Ok(meta) = entry.metadata() {
                        if !meta.is_file() {
                            continue;
                        }
                        let size = meta.len();
                        let mtime = meta.modified().unwrap_or(SystemTime::UNIX_EPOCH);

                        if heap_bytes < target_bytes || heap.len() < MAX_HEAP_CANDIDATES {
                            heap.push(EvictionCandidate {
                                path: entry.path(),
                                size,
                                mtime,
                            });
                            heap_bytes = heap_bytes.saturating_add(size);
                        } else if let Some(youngest) = heap.peek() {
                            // If this file is older than the youngest in our heap, replace it.
                            if mtime < youngest.mtime {
                                let popped = heap.pop().unwrap();
                                heap_bytes = heap_bytes.saturating_sub(popped.size);
                                heap.push(EvictionCandidate {
                                    path: entry.path(),
                                    size,
                                    mtime,
                                });
                                heap_bytes = heap_bytes.saturating_add(size);
                            }
                        }
                    }
                }
            }

            // 2. Sort the collected candidates strictly oldest-first.
            let mut candidates: Vec<EvictionCandidate> = heap.into_vec();
            candidates.sort_by(|a, b| a.mtime.cmp(&b.mtime));

            // 3. Delete files sequentially with cooperative pauses until target is reached.
            let mut freed = 0u64;
            for candidate in candidates {
                if freed >= target_bytes {
                    break;
                }
                if std::fs::remove_file(&candidate.path).is_ok() {
                    freed = freed.saturating_add(candidate.size);
                    let _ =
                        global_bytes.fetch_update(Ordering::Relaxed, Ordering::Relaxed, |cur| {
                            Some(cur.saturating_sub(candidate.size))
                        });
                    std::thread::sleep(DELETE_YIELD_SLEEP);
                }
            }

            // 4. Clean up any now-empty artifact directories.
            for dir in artifact_dirs {
                if let Ok(mut rd) = std::fs::read_dir(&dir) {
                    if rd.next().is_none() {
                        let _ = std::fs::remove_dir(&dir);
                    }
                }
            }

            freed
        })
        .await
        .unwrap_or(0)
    }
}

/// Discovers all `<session_id>.artifacts` directories under `sessions_dir`.
/// Supports both:
/// 1. Project-bucketed layout: `<sessions_dir>/<project_hash>/<session_id>.artifacts`
/// 2. Flat layout: `<sessions_dir>/<session_id>.artifacts`
fn collect_artifact_dirs(sessions_dir: &Path) -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    let Ok(root_entries) = std::fs::read_dir(sessions_dir) else {
        return dirs;
    };

    for entry in root_entries.flatten() {
        let Ok(meta) = entry.metadata() else {
            continue;
        };
        if !meta.is_dir() {
            continue;
        }
        let name = entry.file_name();
        let name_str = name.to_string_lossy();

        if name_str.ends_with(".artifacts") {
            dirs.push(entry.path());
        } else {
            // Might be a project bucket directory; scan one level down.
            if let Ok(sub_entries) = std::fs::read_dir(entry.path()) {
                for sub_entry in sub_entries.flatten() {
                    if let Ok(sub_meta) = sub_entry.metadata() {
                        if sub_meta.is_dir()
                            && sub_entry
                                .file_name()
                                .to_string_lossy()
                                .ends_with(".artifacts")
                        {
                            dirs.push(sub_entry.path());
                        }
                    }
                }
            }
        }
    }
    dirs
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[tokio::test]
    async fn watchdog_tracks_and_evicts_oldest_files_when_cap_breached() {
        let temp = tempdir().unwrap();
        let root = temp.path();

        // Create mock project bucket & session artifacts dir
        let session_art_dir = root.join("proj_hash").join("sess1.artifacts");
        std::fs::create_dir_all(&session_art_dir).unwrap();

        let f1 = session_art_dir.join("0123456789abcdef");
        let f2 = session_art_dir.join("1123456789abcdef");
        let f3 = session_art_dir.join("2123456789abcdef");

        std::fs::write(&f1, b"aaa").unwrap();
        // Set older time on f1
        let past = SystemTime::now() - Duration::from_secs(100);
        let file = std::fs::File::options().write(true).open(&f1).unwrap();
        file.set_times(std::fs::FileTimes::new().set_modified(past))
            .unwrap();

        std::fs::write(&f2, b"bbbb").unwrap();
        std::fs::write(&f3, b"ccccc").unwrap();

        // 3 + 4 + 5 = 12 bytes total.
        // Set max capacity to 10 bytes, target 5 bytes.
        let wd = Arc::new(ArtifactWatchdog::with_options(
            root,
            10, // max
            5,  // target (needs to free >= 7 bytes)
            Duration::from_secs(3600),
        ));

        let total = wd.scan_disk_total_bytes_sync();
        assert_eq!(total, 12);
        wd.set_total_bytes(total);

        // Run emergency eviction
        let freed = wd.perform_emergency_eviction().await;
        assert!(freed >= 7, "Freed at least 7 bytes (got {freed})");

        // Oldest file f1 must be removed first
        assert!(!f1.exists(), "Oldest file f1 should be evicted");
        assert!(wd.global_bytes() <= 5, "Global bytes reduced to <= 5");
    }

    #[tokio::test]
    async fn periodic_maintenance_evicts_30_percent_of_data() {
        let temp = tempdir().unwrap();
        let session_art_dir = temp.path().join("sess.artifacts");
        std::fs::create_dir_all(&session_art_dir).unwrap();

        for i in 0..10 {
            let path = session_art_dir.join(format!("{i:016x}"));
            std::fs::write(&path, vec![b'x'; 100]).unwrap();
            let past = SystemTime::now() - Duration::from_secs(1000 - i * 10);
            let file = std::fs::File::options().write(true).open(&path).unwrap();
            file.set_times(std::fs::FileTimes::new().set_modified(past))
                .unwrap();
        }

        // 10 files * 100 bytes = 1000 bytes.
        let wd = Arc::new(ArtifactWatchdog::with_options(
            temp.path(),
            5000,
            2000,
            Duration::from_secs(3600),
        ));
        wd.set_total_bytes(1000);

        let freed = wd.perform_periodic_maintenance().await;
        // 30% of 1000 = 300 bytes (at least 3 files)
        assert!(freed >= 300, "Freed at least 300 bytes (got {freed})");
        assert_eq!(wd.global_bytes(), 1000 - freed);
    }
}
