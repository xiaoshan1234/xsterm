/// Transport abstraction for [`TmuxController`](crate::services::tmux::TmuxController).
///
/// Sibling to [`crate::infrastructure::pty::PtySystem`] and
/// [`crate::infrastructure::ssh::SshBackend`]: this module owns only
/// the transport trait + its two implementations (local child process
/// and SSH exec channel). The state-machine / line-protocol / Promise
/// coordination lives in [`crate::services::tmux`].
pub(crate) mod backend;
