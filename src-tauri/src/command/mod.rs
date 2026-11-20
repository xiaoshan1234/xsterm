pub(crate) mod logging;
pub(crate) mod terminal;
pub(crate) mod tmux;

pub fn all_handlers() -> impl Fn(tauri::ipc::Invoke) -> bool + Send + Sync + 'static {
    tauri::generate_handler![
        terminal::create_local_terminal,
        terminal::create_ssh_terminal,
        tmux::create_tmux_session,
        terminal::write_terminal,
        terminal::subscribe_terminal_output,
        terminal::unsubscribe_terminal_output,
        terminal::resize_terminal,
        tmux::resize_tmux_window,
        terminal::close_terminal,
        terminal::list_terminals,
        terminal::upload_image_to_ssh_terminal,
        tmux::create_tmux_pane,
        tmux::kill_tmux_pane,
        tmux::create_tmux_window,
        tmux::kill_tmux_window,
        tmux::rename_tmux_window,
        tmux::attach_tmux_session,
        tmux::detach_tmux_session,
        tmux::capture_tmux_pane,
        logging::log_message,
        logging::get_log_config,
        logging::set_log_config,
        logging::get_log_dir,
    ]
}
