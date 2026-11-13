//! Raw per-session output routing.
//!
//! The frontend subscribes one [`Channel`] per live session via the
//! `subscribe_terminal_output` command; the output forwarders then push raw
//! bytes straight through that channel instead of serializing every byte as a
//! JSON number inside the `terminal-output` event. Tauri delivers
//! [`InvokeResponseBody::Raw`] payloads as `application/octet-stream`, so the
//! bytes reach the WebView as an `ArrayBuffer` with no JSON round-trip.
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use dashmap::DashMap;
use tauri::ipc::{Channel, InvokeResponseBody};

const MAX_PENDING_OUTPUT_BYTES: usize = 4 * 1024 * 1024;

#[derive(Default)]
struct SessionRoute {
    subscription_id: u64,
    channel: Option<Channel<InvokeResponseBody>>,
    pending: Vec<u8>,
    subscribed_once: bool,
}

/// Fan raw terminal bytes out to the per-session frontend channels.
#[derive(Default)]
pub(crate) struct OutputRouter {
    routes: DashMap<u32, Mutex<SessionRoute>>,
    next_subscription_id: AtomicU64,
}

impl OutputRouter {
    /// Bind a frontend channel to a session. A later subscribe replaces any
    /// earlier channel for the same session id. Returns the subscription id
    /// the frontend must pass to [`Self::unsubscribe`].
    pub(crate) fn subscribe(&self, session_id: u32, channel: Channel<InvokeResponseBody>) -> u64 {
        let subscription_id = self.next_subscription_id.fetch_add(1, Ordering::Relaxed);
        let route_entry = self.routes.entry(session_id).or_default();
        let mut route = route_entry
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        route.subscription_id = subscription_id;
        route.subscribed_once = true;
        if !route.pending.is_empty() {
            let pending = std::mem::take(&mut route.pending);
            let _ = channel.send(InvokeResponseBody::Raw(pending));
        }
        route.channel = Some(channel);
        subscription_id
    }

    /// Forget the channel for a session, but only if it is still the channel
    /// registered by `subscription_id`. This makes a late unsubscribe (e.g.
    /// React strict-mode's mount/unmount/mount cycle) unable to evict the
    /// newer subscription that replaced it.
    pub(crate) fn unsubscribe(&self, session_id: u32, subscription_id: u64) {
        if let Some(route) = self.routes.get(&session_id) {
            let mut route = route
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            if route.subscription_id == subscription_id {
                route.subscription_id = 0;
                route.channel = None;
                route.pending.clear();
            }
        }
    }

    /// Send raw bytes to the session's channel. Before the first subscription,
    /// retain a bounded copy so fast remote prompts are not lost while React
    /// mounts the xterm instance.
    pub(crate) fn send(&self, session_id: u32, bytes: Vec<u8>) -> Result<(), String> {
        let route_entry = self.routes.entry(session_id).or_default();
        let mut route = route_entry
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let Some(channel) = route.channel.as_ref() else {
            if !route.subscribed_once {
                route.pending.extend_from_slice(&bytes);
                if route.pending.len() > MAX_PENDING_OUTPUT_BYTES {
                    let overflow = route.pending.len() - MAX_PENDING_OUTPUT_BYTES;
                    route.pending.drain(..overflow);
                }
            }
            return Ok(());
        };
        channel
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
        assert!(router
            .routes
            .get(&1)
            .unwrap()
            .lock()
            .unwrap()
            .channel
            .is_some());

        router.unsubscribe(1, second);
        assert!(router
            .routes
            .get(&1)
            .unwrap()
            .lock()
            .unwrap()
            .channel
            .is_none());
    }

    #[test]
    fn output_before_subscription_is_buffered_and_replayed() {
        let router = OutputRouter::default();
        router.send(9, b"prompt ".to_vec()).expect("buffer output");
        router.send(9, b"$ ".to_vec()).expect("buffer output");

        let received = std::sync::Arc::new(Mutex::new(Vec::new()));
        let received_for_channel = std::sync::Arc::clone(&received);
        let channel = Channel::new(move |body| {
            if let InvokeResponseBody::Raw(bytes) = body {
                received_for_channel.lock().unwrap().extend(bytes);
            }
            Ok(())
        });

        router.subscribe(9, channel);
        assert_eq!(received.lock().unwrap().as_slice(), b"prompt $ ");
    }
}
