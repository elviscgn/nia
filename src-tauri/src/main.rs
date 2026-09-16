use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Component, Path};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri_runtime_cef::{allocate_devtools_message_id, DevToolsProtocol, WebviewCefExt};

#[derive(Clone)]
struct CoreStarted(Instant);

const CANVAS_SAMPLE_URL: &str = "http://127.0.0.1:1421";
const SAMPLE_STYLE_FILE: &str = "sample/src/styles.css";

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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CanvasSourceRef {
    file: String,
    line: u32,
    column: u32,
    style_file: String,
    style_selector: String,
}

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
    source: Option<CanvasSourceRef>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CanvasStatus {
    url: &'static str,
    reachable: bool,
    latency_ms: u128,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CanvasStylePatchResult {
    file: String,
    selector: String,
    property: String,
    previous_value: Option<String>,
    value: String,
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

fn safe_project_file(relative: &str) -> Result<std::path::PathBuf, String> {
    let relative_path = Path::new(relative);
    if relative_path.is_absolute()
        || relative_path.components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        })
    {
        return Err("unsafe project path".to_string());
    }

    let root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .ok_or_else(|| "could not resolve project root".to_string())?;
    Ok(root.join(relative_path))
}

fn allowed_numeric_property(property: &str) -> bool {
    matches!(
        property,
        "font-size" | "gap" | "padding" | "border-radius" | "margin-top" | "margin-bottom"
    )
}

fn patch_one_line_css_rule(
    css: &str,
    selector: &str,
    property: &str,
    value: &str,
) -> Result<(String, Option<String>), String> {
    let mut output = Vec::new();
    let mut changed = false;
    let mut previous_value = None;

    for raw_line in css.lines() {
        if changed {
            output.push(raw_line.to_string());
            continue;
        }

        let trimmed = raw_line.trim();
        let Some((head, rest)) = trimmed.split_once('{') else {
            output.push(raw_line.to_string());
            continue;
        };
        if head.trim() != selector {
            output.push(raw_line.to_string());
            continue;
        }

        let Some((body, suffix)) = rest.split_once('}') else {
            return Err(format!("CSS rule for {selector} must be on one line in this spike"));
        };

        let mut declarations: Vec<(String, String)> = body
            .split(';')
            .filter_map(|declaration| {
                let declaration = declaration.trim();
                if declaration.is_empty() {
                    return None;
                }
                declaration
                    .split_once(':')
                    .map(|(name, value)| (name.trim().to_string(), value.trim().to_string()))
            })
            .collect();

        let mut found = false;
        for (name, current) in &mut declarations {
            if name == property {
                previous_value = Some(current.clone());
                *current = value.to_string();
                found = true;
                break;
            }
        }
        if !found {
            declarations.push((property.to_string(), value.to_string()));
        }

        let indent_len = raw_line.len().saturating_sub(raw_line.trim_start().len());
        let indent = &raw_line[..indent_len];
        let body = declarations
            .into_iter()
            .map(|(name, value)| format!("{name}: {value}"))
            .collect::<Vec<_>>()
            .join("; ");
        output.push(format!("{indent}{selector} {{ {body}; }}{suffix}"));
        changed = true;
    }

    if !changed {
        return Err(format!("CSS selector not found: {selector}"));
    }

    let mut result = output.join("\n");
    if css.ends_with('\n') {
        result.push('\n');
    }
    Ok((result, previous_value))
}

#[tauri::command]
async fn canvas_set_style_px(
    file: String,
    selector: String,
    property: String,
    value_px: f64,
) -> Result<CanvasStylePatchResult, String> {
    if file != SAMPLE_STYLE_FILE {
        return Err(format!("spike only allows edits to {SAMPLE_STYLE_FILE}"));
    }
    if selector.trim().is_empty() {
        return Err("missing CSS selector".to_string());
    }
    if !allowed_numeric_property(&property) {
        return Err(format!("property is not allowed for deterministic px edits: {property}"));
    }
    if !value_px.is_finite() || !(0.0..=1000.0).contains(&value_px) {
        return Err("pixel value must be finite and between 0 and 1000".to_string());
    }

    let value = if value_px.fract() == 0.0 {
        format!("{}px", value_px as i64)
    } else {
        format!("{value_px:.2}px")
    };

    let path = safe_project_file(&file)?;
    let css = tokio::fs::read_to_string(&path)
        .await
        .map_err(|e| format!("failed to read {}: {e}", path.display()))?;
    let (patched, previous_value) = patch_one_line_css_rule(&css, &selector, &property, &value)?;
    tokio::fs::write(&path, patched)
        .await
        .map_err(|e| format!("failed to write {}: {e}", path.display()))?;

    Ok(CanvasStylePatchResult {
        file,
        selector,
        property,
        previous_value,
        value,
    })
}

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
                    && let Some(tx) = pending.lock().ok().and_then(|mut guard| guard.take())
                {
                    let _ = tx.send((success, result));
                }
            }
        })
        .map_err(|e| e.to_string())?;

    webview
        .send_dev_tools_message(&bytes)
        .map_err(|e| e.to_string())?;

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

    Ok(value.pointer("/result/value").cloned().unwrap_or(value))
}

fn main() {
    let dev_cache = Path::new(env!("CARGO_MANIFEST_DIR")).join("target/cef-dev-profile");
    let cef = tauri_runtime_cef::Cef::default().root_cache_path(dev_cache);

    tauri::Builder::default()
        .runtime(cef)
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
            canvas_set_style_px,
            canvas_cdp_evaluate
        ])
        .run(tauri::generate_context!())
        .expect("error while running Nia");
}
