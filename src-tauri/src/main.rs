use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri_runtime_cef::{DevToolsProtocol, WebviewCefExt, allocate_devtools_message_id};

#[derive(Clone)]
struct CoreStarted(Instant);

/// URL of the sample app served for the canvas. Single place that owns it on
/// the Rust side; the frontend asks for it instead of hardcoding.
const CANVAS_SAMPLE_URL: &str = "http://127.0.0.1:1421";

#[derive(Serialize)]
struct CoreHealth {
    name: &'static str,
    runtime: &'static str,
    uptime_ms: u128,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CanvasRect {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

/// Element description produced by the sample page's instrumentation and
/// stored by Rust, which stays the source of truth for the inspector.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CanvasSelection {
    tag: String,
    id: String,
    classes: Vec<String>,
    rect: CanvasRect,
    path: Vec<String>,
    selector: String,
    styles: BTreeMap<String, String>,
    text: String,
    source_url: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CanvasStatus {
    url: &'static str,
    reachable: bool,
    latency_ms: u128,
}

struct CanvasState {
    selection: Mutex<Option<CanvasSelection>>,
}

#[tauri::command]
fn ping() -> &'static str {
    "pong"
}

#[tauri::command]
fn core_health(state: tauri::State<'_, CoreStarted>) -> CoreHealth {
    CoreHealth {
        name: "nia-core",
        runtime: "tauri-3-cef",
        uptime_ms: state.0.elapsed().as_millis(),
    }
}

#[tauri::command]
async fn simulated_background_work() -> u64 {
    tokio::time::sleep(Duration::from_millis(50)).await;
    50
}

#[tauri::command]
fn canvas_sample_url() -> &'static str {
    CANVAS_SAMPLE_URL
}

/// Liveness check for the sample dev server, so the shell can show whether
/// the canvas page is actually being served. Plain TCP connect: no new deps.
#[tauri::command]
async fn canvas_status() -> CanvasStatus {
    let started = Instant::now();
    let reachable = tokio::time::timeout(
        Duration::from_millis(1500),
        tokio::net::TcpStream::connect("127.0.0.1:1421"),
    )
    .await
    .map(|r| r.is_ok())
    .unwrap_or(false);
    CanvasStatus {
        url: CANVAS_SAMPLE_URL,
        reachable,
        latency_ms: started.elapsed().as_millis(),
    }
}

/// The shell forwards every canvas selection here; Rust stores it and the
/// inspector reads it back via `canvas_selection`.
#[tauri::command]
fn canvas_report_selection(
    selection: CanvasSelection,
    state: tauri::State<'_, CanvasState>,
) -> Result<(), String> {
    *state.selection.lock().map_err(|e| e.to_string())? = Some(selection);
    Ok(())
}

#[tauri::command]
fn canvas_selection(state: tauri::State<'_, CanvasState>) -> Result<Option<CanvasSelection>, String> {
    Ok(state.selection.lock().map_err(|e| e.to_string())?.clone())
}

#[tauri::command]
fn canvas_clear_selection(state: tauri::State<'_, CanvasState>) -> Result<(), String> {
    *state.selection.lock().map_err(|e| e.to_string())? = None;
    Ok(())
}

/// Evaluate JavaScript in the Nia webview through the CEF DevTools protocol.
///
/// This is the real `tauri-runtime-cef` CDP path: the message id comes from
/// the shared `allocate_devtools_message_id` allocator and the reply is
/// correlated from the browser-wide `on_dev_tools_protocol` observer stream.
/// Each call registers a narrow observer that only answers its own id and
/// ignores everyone else's traffic (acceptable for a spike; a production
/// version would use one shared observer plus a pending-request map).
#[tauri::command]
async fn canvas_cdp_evaluate<R: tauri::Runtime>(
    webview: tauri::WebviewWindow<R>,
    expression: String,
) -> Result<serde_json::Value, String>
where
    R::WebviewDispatcher: tauri_runtime_cef::AsCefWebviewDispatcher,
{
    let message_id = allocate_devtools_message_id().map_err(|e| e.to_string())?;
    let message = serde_json::json!({
        "id": message_id,
        "method": "Runtime.evaluate",
        "params": { "expression": expression, "returnByValue": true }
    });
    let bytes = serde_json::to_vec(&message).map_err(|e| e.to_string())?;

    let (tx, rx) = tokio::sync::oneshot::channel::<(bool, Vec<u8>)>();
    let pending = std::sync::Arc::new(std::sync::Mutex::new(Some(tx)));
    webview
        .on_dev_tools_protocol(move |protocol| {
            if let DevToolsProtocol::MethodResult {
                message_id: id,
                success,
                result,
            } = protocol
            {
                if id == message_id
                    && let Some(tx) = pending.lock().ok().and_then(|mut g| g.take())
                {
                    let _ = tx.send((success, result));
                }
            }
        })
        .map_err(|e| e.to_string())?;

    webview.send_dev_tools_message(&bytes).map_err(|e| e.to_string())?;

    let (success, result) = tokio::time::timeout(Duration::from_secs(10), rx)
        .await
        .map_err(|_| "CDP evaluate timed out after 10s".to_string())?
        .map_err(|_| "CDP evaluate was cancelled".to_string())?;
    if !success {
        return Err("CDP Runtime.evaluate reported failure".to_string());
    }
    let value: serde_json::Value =
        serde_json::from_slice(&result).map_err(|e| format!("bad CDP result: {e}"))?;
    if let Some(error) = value.get("exceptionDetails") {
        return Err(format!("JS threw: {error}"));
    }
    // Runtime.evaluate answers { result: { type, value } }; hand the caller
    // just the value, falling back to the whole payload.
    Ok(value
        .pointer("/result/value")
        .cloned()
        .unwrap_or(value))
}

fn main() {
    tauri::Builder::default()
        .runtime(tauri_runtime_cef::Cef::default())
        .manage(CoreStarted(Instant::now()))
        .manage(CanvasState {
            selection: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            ping,
            core_health,
            simulated_background_work,
            canvas_sample_url,
            canvas_status,
            canvas_report_selection,
            canvas_selection,
            canvas_clear_selection,
            canvas_cdp_evaluate
        ])
        .run(tauri::generate_context!())
        .expect("error while running Nia");
}
