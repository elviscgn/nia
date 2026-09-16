use serde::Serialize;
use std::time::{Duration, Instant};

#[derive(Clone)]
struct CoreStarted(Instant);

#[derive(Serialize)]
struct CoreHealth {
    name: &'static str,
    runtime: &'static str,
    uptime_ms: u128,
}

#[tauri::command]
fn ping() -> &'static str { "pong" }

#[tauri::command]
fn core_health(state: tauri::State<'_, CoreStarted>) -> CoreHealth {
    CoreHealth { name: "nia-core", runtime: "tauri-3-cef", uptime_ms: state.0.elapsed().as_millis() }
}

#[tauri::command]
async fn simulated_background_work() -> u64 {
    tokio::time::sleep(Duration::from_millis(50)).await;
    50
}

fn main() {
    tauri::Builder::default()
        .runtime(tauri_runtime_cef::Cef::default())
        .manage(CoreStarted(Instant::now()))
        .invoke_handler(tauri::generate_handler![ping, core_health, simulated_background_work])
        .run(tauri::generate_context!())
        .expect("error while running Nia");
}
