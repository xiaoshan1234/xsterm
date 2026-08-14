use serde::{Deserialize, Serialize};

/// Describes which capabilities a terminal session transport supports.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityFlags {
    pub supports_resize: bool,
    pub supports_reconnect: bool,
    pub supports_local_echo: bool,
    pub supports_multiplex: bool,
}

impl CapabilityFlags {
    /// Capabilities for a local PTY shell session.
    pub fn for_local() -> Self {
        Self {
            supports_resize: true,
            supports_reconnect: false,
            supports_local_echo: true,
            supports_multiplex: false,
        }
    }

    /// Capabilities for an SSH session.
    pub fn for_ssh() -> Self {
        Self {
            supports_resize: true,
            supports_reconnect: true,
            supports_local_echo: false,
            supports_multiplex: false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn for_local_has_expected_flags() {
        let caps = CapabilityFlags::for_local();
        assert_eq!(caps.supports_resize, true);
        assert_eq!(caps.supports_reconnect, false);
        assert_eq!(caps.supports_local_echo, true);
        assert_eq!(caps.supports_multiplex, false);
    }

    #[test]
    fn for_ssh_has_expected_flags() {
        let caps = CapabilityFlags::for_ssh();
        assert_eq!(caps.supports_resize, true);
        assert_eq!(caps.supports_reconnect, true);
        assert_eq!(caps.supports_local_echo, false);
        assert_eq!(caps.supports_multiplex, false);
    }
}
