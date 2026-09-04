pub(crate) mod logging;
pub(crate) mod persistence;
pub(crate) mod session;

pub fn all_handlers() -> impl Fn(tauri::ipc::Invoke) -> bool + Send + Sync + 'static {
    tauri::generate_handler![
        session::create_local_session,
        session::create_ssh_session,
        session::create_tmux_session,
        session::create_session,
        session::write_session,
        session::resize_session,
        session::close_session,
        session::list_sessions,
        session::upload_image_to_ssh_session,
        session::get_session_output_channel,
        session::create_tmux_pane,
        session::kill_tmux_pane,
        session::create_tmux_window,
        session::kill_tmux_window,
        session::rename_tmux_window,
        session::attach_tmux_session,
        session::capture_tmux_pane,
        session::get_attached_tmux_servers,
        session::auto_attach_tmux_servers,
        persistence::save_sessions,
        persistence::load_sessions,
        persistence::save_groups,
        persistence::load_groups,
        persistence::save_attached_tmux_servers,
        persistence::load_attached_tmux_servers,
        logging::log_message,
        logging::get_log_config,
        logging::set_log_config,
        logging::get_log_dir,
    ]
}
