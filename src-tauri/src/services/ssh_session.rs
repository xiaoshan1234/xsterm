use crate::infrastructure::app_backend::AppBackend;
use crate::infrastructure::ssh::{create_ssh_session as infra_create_ssh, SshBackend};
use crate::models::session::{SSHSessionConfig, SshSessionWrapper};

#[allow(dead_code)]
pub fn create_ssh_session(
    ssh_backend: &dyn SshBackend,
    config: SSHSessionConfig,
    backend: impl AppBackend + 'static,
    session_id: u32,
) -> Result<SshSessionWrapper, String> {
    infra_create_ssh(ssh_backend, config, backend, session_id)
}
