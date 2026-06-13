use tauri::{AppHandle, Emitter};

pub trait AppBackend: Send + Sync + Clone {
    fn emit(&self, event: &str, payload: &[u8]) -> Result<(), String>;
    fn spawn(&self, f: Box<dyn FnOnce() + Send>);
}

#[derive(Clone)]
pub struct RealAppBackend {
    app: std::sync::Arc<tauri::AppHandle>,
}

impl RealAppBackend {
    pub fn new(app: AppHandle) -> Self {
        Self { app: std::sync::Arc::new(app) }
    }
}

impl AppBackend for RealAppBackend {
    fn emit(&self, event: &str, payload: &[u8]) -> Result<(), String> {
        let json: serde_json::Value = serde_json::from_slice(payload)
            .map_err(|e| e.to_string())?;
        self.app.emit(event, json).map_err(|e| e.to_string())
    }

    fn spawn(&self, f: Box<dyn FnOnce() + Send>) {
        std::thread::spawn(f);
    }
}
