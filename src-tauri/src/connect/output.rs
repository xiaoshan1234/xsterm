//! Raw per-session output routing.
//!
//! The frontend subscribes one [`Channel`] per live session via the
//! `subscribe_terminal_output` command; the output forwarders then push raw
//! bytes straight through that channel instead of serializing every byte as a
//! JSON number inside the `terminal-output` event. Tauri delivers
//! [`InvokeResponseBody::Raw`] payloads as `application/octet-stream`, so the
//! bytes reach the WebView as an `ArrayBuffer` with no JSON round-trip.
use std::sync::atomic::{AtomicU64, Ordering};

use dashmap::DashMap;
use tauri::ipc::{Channel, InvokeResponseBody};

/// Fan raw terminal bytes out to the per-session frontend channels.
#[derive(Default)]
pub(crate) struct OutputRouter {
    channels: DashMap<u32, (u64, Channel<InvokeResponseBody>)>,
    next_subscription_id: AtomicU64,
}

impl OutputRouter {
    /// Bind a frontend channel to a session. A later subscribe replaces any
    /// earlier channel for the same session id. Returns the subscription id
    /// the frontend must pass to [`Self::unsubscribe`].
    pub(crate) fn subscribe(&self, session_id: u32, channel: Channel<InvokeResponseBody>) -> u64 {
        let subscription_id = self.next_subscription_id.fetch_add(1, Ordering::Relaxed);
        self.channels.insert(session_id, (subscription_id, channel));
        subscription_id
    }

    /// Forget the channel for a session, but only if it is still the channel
    /// registered by `subscription_id`. This makes a late unsubscribe (e.g.
    /// React strict-mode's mount/unmount/mount cycle) unable to evict the
    /// newer subscription that replaced it.
    pub(crate) fn unsubscribe(&self, session_id: u32, subscription_id: u64) {
        if self
            .channels
            .get(&session_id)
            .is_some_and(|entry| entry.value().0 == subscription_id)
        {
            self.channels.remove(&session_id);
        }
    }

    /// Send raw bytes to the session's channel, if one is subscribed.
    ///
    /// A missing subscriber is not an error: output produced before the
    /// frontend subscribes is dropped, mirroring the old event path where
    /// events emitted before `listen()` were simply never received.
    pub(crate) fn send(&self, session_id: u32, bytes: Vec<u8>) -> Result<(), String> {
        let Some(entry) = self.channels.get(&session_id) else {
            return Ok(());
        };
        entry
            .value()
            .1
            .send(InvokeResponseBody::Raw(bytes))
            .map_err(|e| e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dummy_channel() -> Channel<InvokeResponseBody> {
        Channel::new(|_body| Ok(()))
    }

    #[test]
    fn stale_unsubscribe_does_not_evict_newer_subscription() {
        let router = OutputRouter::default();
        let first = router.subscribe(1, dummy_channel());
        let second = router.subscribe(1, dummy_channel());

        router.unsubscribe(1, first);
        assert!(router.channels.contains_key(&1));

        router.unsubscribe(1, second);
        assert!(!router.channels.contains_key(&1));
    }

    #[test]
    fn send_without_subscriber_is_not_an_error() {
        let router = OutputRouter::default();
        assert!(router.send(9, vec![1, 2, 3]).is_ok());
    }
}
