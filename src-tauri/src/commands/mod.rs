pub(crate) mod logging;
pub(crate) mod persistence;
pub(crate) mod session;

pub fn all_handlers() -> impl Fn(tauri::ipc::Invoke) -> bool + Send + Sync + 'static {
    tauri::generate_handler![
        session::create_local_session,
        session::create_ssh_session,
        session::create_tmux_session,
        session::create_ssh_tmux_session,
        session::write_session,
        session::resize_session,
        session::close_session,
        session::list_sessions,
        session::write_tmux_command,
        session::resize_tmux_pane,
        session::send_keys_to_tmux_pane,
        session::capture_tmux_pane,
        persistence::save_sessions,
        persistence::load_sessions,
        persistence::save_groups,
        persistence::load_groups,
        logging::log_message,
        logging::get_log_config,
        logging::set_log_config,
        logging::get_log_dir,
    ]
}
