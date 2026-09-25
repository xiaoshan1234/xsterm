use serde::{Deserialize, Serialize};

/// Describes which capabilities a terminal session transport supports.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityFlags {
    #[serde(rename = "supportsResize")]
    pub can_resize: bool,
    #[serde(rename = "supportsReconnect")]
    pub can_reconnect: bool,
    #[serde(rename = "supportsLocalEcho")]
    pub can_local_echo: bool,
    #[serde(rename = "supportsMultiplex")]
    pub can_multiplex: bool,
}

impl CapabilityFlags {
    /// Capabilities for a local PTY shell session.
    pub fn for_local() -> Self {
        Self {
            can_resize: true,
            can_reconnect: false,
            can_local_echo: true,
            can_multiplex: false,
        }
    }

    /// Capabilities for an SSH session.
    pub fn for_ssh() -> Self {
        Self {
            can_resize: true,
            can_reconnect: true,
            can_local_echo: false,
            can_multiplex: false,
        }
    }

    /// Capabilities for a pane owned by a tmux `-CC` controller.
    pub fn for_tmux() -> Self {
        Self {
            can_resize: true,
            can_reconnect: true,
            can_local_echo: false,
            can_multiplex: true,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn for_local_has_expected_flags() {
        let caps = CapabilityFlags::for_local();
        assert_eq!(caps.can_resize, true);
        assert_eq!(caps.can_reconnect, false);
        assert_eq!(caps.can_local_echo, true);
        assert_eq!(caps.can_multiplex, false);
    }

    #[test]
    fn for_ssh_has_expected_flags() {
        let caps = CapabilityFlags::for_ssh();
        assert_eq!(caps.can_resize, true);
        assert_eq!(caps.can_reconnect, true);
        assert_eq!(caps.can_local_echo, false);
        assert_eq!(caps.can_multiplex, false);
    }

    #[test]
    fn for_tmux_advertises_multiplex_and_reconnect() {
        let caps = CapabilityFlags::for_tmux();
        assert!(
            caps.can_resize,
            "tmux panes must support resize so the frontend can drive SIGWINCH"
        );
        assert!(
            caps.can_reconnect,
            "tmux pane must advertise reconnect — the tmux server outlives the xsterm session"
        );
        assert!(
            !caps.can_local_echo,
            "tmux pane echoes via the inner shell, not the xsterm renderer"
        );
        assert!(
            caps.can_multiplex,
            "can_multiplex is the unlock flag for split / kill pane UI in Pane.tsx"
        );
    }
}
