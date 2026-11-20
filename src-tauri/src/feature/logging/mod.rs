pub(crate) mod setup;
pub(crate) mod terminal_log;

pub(crate) use setup::{cleanup_old_logs, get_log_config_impl, init_logging, LogConfig};
