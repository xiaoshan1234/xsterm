pub(crate) mod session_log;
pub(crate) mod setup;

pub(crate) use setup::{cleanup_old_logs, get_log_config_impl, init_logging, LogConfig};
