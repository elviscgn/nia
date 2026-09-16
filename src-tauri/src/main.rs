use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri_runtime_cef::{allocate_devtools_message_id, DevToolsProtocol, WebviewCefExt};

#[derive(Clone)]
struct CoreStarted(Instant);

const CANVAS_SAMPLE_URL: &str = "http://127.0.0.1:1421";
const MAX_EDIT_HISTORY: usize = 100;

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
    #[serde(default)]
    style_file: String,
    #[serde(default)]
    style_selector: String,
    #[serde(default)]
    style_line: u32,
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
    undo_depth: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CanvasUndoResult {
    file: String,
    selector: String,
    property: String,
    restored_value: Option<String>,
    undo_depth: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CanvasHistoryState {
    undo_depth: usize,
}

#[derive(Debug, Clone)]
struct StyleRuleRef {
    file: String,
    selector: String,
    line: u32,
}

#[derive(Debug, Clone)]
struct CanvasEdit {
    file: String,
    selector: String,
    property: String,
    before: String,
    after: String,
    previous_value: Option<String>,
}

struct CanvasState {
    selection: Mutex<Option<CanvasSelection>>,
}

struct StyleIndex {
    rules: Mutex<Vec<StyleRuleRef>>,
}

struct EditHistory {
    undo: Mutex<Vec<CanvasEdit>>,
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
    .map(|result| result.is_ok())
    .unwrap_or(false);

    CanvasStatus {
        url: CANVAS_SAMPLE_URL,
        reachable,
        latency_ms: started.elapsed().as_millis(),
    }
}

fn project_root() -> Result<PathBuf, String> {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| "could not resolve project root".to_string())
}

fn safe_project_file(relative: &str) -> Result<PathBuf, String> {
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

    Ok(project_root()?.join(relative_path))
}

fn relative_project_path(path: &Path) -> Result<String, String> {
    let root = project_root()?;
    let relative = path
        .strip_prefix(&root)
        .map_err(|_| format!("{} is outside the project root", path.display()))?;
    Ok(relative.to_string_lossy().replace('\\', "/"))
}

fn should_skip_dir(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .map(|name| matches!(name, ".git" | "node_modules" | "target" | "dist" | ".vite"))
        .unwrap_or(false)
}

fn collect_css_files(dir: &Path, output: &mut Vec<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            if !should_skip_dir(&path) {
                collect_css_files(&path, output);
            }
            continue;
        }

        if path.extension().and_then(|ext| ext.to_str()) == Some("css") {
            output.push(path);
        }
    }
}

fn index_css_file(path: &Path, css: &str) -> Vec<StyleRuleRef> {
    let Ok(file) = relative_project_path(path) else {
        return Vec::new();
    };

    let mut rules = Vec::new();
    let mut boundary = 0usize;

    for (index, ch) in css.char_indices() {
        match ch {
            '{' => {
                let head = css[boundary..index].trim();
                if head.is_empty() || head.starts_with('@') {
                    continue;
                }

                let line = css[..index].bytes().filter(|byte| *byte == b'\n').count() as u32 + 1;
                for selector in head.split(',').map(str::trim).filter(|selector| !selector.is_empty()) {
                    rules.push(StyleRuleRef {
                        file: file.clone(),
                        selector: selector.to_string(),
                        line,
                    });
                }
            }
            '}' => boundary = index + ch.len_utf8(),
            _ => {}
        }
    }

    rules
}

fn build_style_index() -> Vec<StyleRuleRef> {
    let Ok(root) = project_root() else {
        return Vec::new();
    };

    let mut css_files = Vec::new();
    collect_css_files(&root, &mut css_files);

    let mut rules = Vec::new();
    for path in css_files {
        let Ok(css) = std::fs::read_to_string(&path) else {
            continue;
        };
        rules.extend(index_css_file(&path, &css));
    }
    rules
}

fn selector_score(rule: &str, selection: &CanvasSelection) -> i32 {
    let rule = rule.trim();
    let mut score = 0;

    if !selection.id.is_empty() {
        let id_selector = format!("#{}", selection.id);
        if rule == id_selector {
            score = score.max(120);
        } else if rule.ends_with(&format!(" {id_selector}")) {
            score = score.max(105);
        }
    }

    if !selection.classes.is_empty() {
        let compound = format!(".{}", selection.classes.join("."));
        if rule == compound {
            score = score.max(115);
        }

        for (index, class_name) in selection.classes.iter().enumerate() {
            let class_selector = format!(".{class_name}");
            let class_score = 100 - index as i32;
            if rule == class_selector {
                score = score.max(class_score);
            } else if rule.ends_with(&format!(" {class_selector}")) {
                score = score.max(class_score - 10);
            }
        }
    }

    if rule == selection.tag {
        score = score.max(60);
    } else if rule.ends_with(&format!(" {}", selection.tag)) {
        score = score.max(50);
    }

    score
}

fn resolve_style_source(selection: &mut CanvasSelection, style_index: &StyleIndex) {
    let Some(source_file) = selection.source.as_ref().map(|source| source.file.clone()) else {
        return;
    };

    let source_parent = Path::new(&source_file)
        .parent()
        .map(|path| path.to_string_lossy().replace('\\', "/"));

    let Ok(rules) = style_index.rules.lock() else {
        return;
    };

    let best = rules
        .iter()
        .filter_map(|rule| {
            let mut score = selector_score(&rule.selector, selection);
            if score == 0 {
                return None;
            }

            if let Some(parent) = &source_parent {
                if rule.file.starts_with(parent) {
                    score += 20;
                }
            }

            Some((score, rule))
        })
        .max_by_key(|(score, _)| *score)
        .map(|(_, rule)| rule.clone());

    drop(rules);

    if let (Some(source), Some(rule)) = (selection.source.as_mut(), best) {
        source.style_file = rule.file;
        source.style_selector = rule.selector;
        source.style_line = rule.line;
    }
}

#[tauri::command]
fn canvas_report_selection(
    mut selection: CanvasSelection,
    canvas_state: tauri::State<'_, CanvasState>,
    style_index: tauri::State<'_, StyleIndex>,
) -> Result<CanvasSelection, String> {
    resolve_style_source(&mut selection, &style_index);
    *canvas_state.selection.lock().map_err(|error| error.to_string())? = Some(selection.clone());
    Ok(selection)
}

#[tauri::command]
fn canvas_selection(state: tauri::State<'_, CanvasState>) -> Result<Option<CanvasSelection>, String> {
    Ok(state.selection.lock().map_err(|error| error.to_string())?.clone())
}

#[tauri::command]
fn canvas_clear_selection(state: tauri::State<'_, CanvasState>) -> Result<(), String> {
    *state.selection.lock().map_err(|error| error.to_string())? = None;
    Ok(())
}

#[tauri::command]
fn canvas_history_state(history: tauri::State<'_, EditHistory>) -> Result<CanvasHistoryState, String> {
    let undo_depth = history.undo.lock().map_err(|error| error.to_string())?.len();
    Ok(CanvasHistoryState { undo_depth })
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
    history: tauri::State<'_, EditHistory>,
) -> Result<CanvasStylePatchResult, String> {
    let path = safe_project_file(&file)?;
    if path.extension().and_then(|extension| extension.to_str()) != Some("css") {
        return Err("deterministic style edits currently require a CSS file".to_string());
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

    let css = tokio::fs::read_to_string(&path)
        .await
        .map_err(|error| format!("failed to read {}: {error}", path.display()))?;
    let (patched, previous_value) = patch_one_line_css_rule(&css, &selector, &property, &value)?;

    tokio::fs::write(&path, &patched)
        .await
        .map_err(|error| format!("failed to write {}: {error}", path.display()))?;

    let undo_depth = {
        let mut undo = history.undo.lock().map_err(|error| error.to_string())?;
        undo.push(CanvasEdit {
            file: file.clone(),
            selector: selector.clone(),
            property: property.clone(),
            before: css,
            after: patched,
            previous_value: previous_value.clone(),
        });
        if undo.len() > MAX_EDIT_HISTORY {
            undo.remove(0);
        }
        undo.len()
    };

    Ok(CanvasStylePatchResult {
        file,
        selector,
        property,
        previous_value,
        value,
        undo_depth,
    })
}

#[tauri::command]
async fn canvas_undo_style(history: tauri::State<'_, EditHistory>) -> Result<CanvasUndoResult, String> {
    let edit = {
        let mut undo = history.undo.lock().map_err(|error| error.to_string())?;
        undo.pop().ok_or_else(|| "nothing to undo".to_string())?
    };

    let path = safe_project_file(&edit.file)?;
    let current = tokio::fs::read_to_string(&path)
        .await
        .map_err(|error| format!("failed to read {}: {error}", path.display()))?;

    if current != edit.after {
        history
            .undo
            .lock()
            .map_err(|error| error.to_string())?
            .push(edit);
        return Err("file changed after the Nia edit, refusing to overwrite newer work".to_string());
    }

    tokio::fs::write(&path, &edit.before)
        .await
        .map_err(|error| format!("failed to restore {}: {error}", path.display()))?;

    let undo_depth = history.undo.lock().map_err(|error| error.to_string())?.len();

    Ok(CanvasUndoResult {
        file: edit.file,
        selector: edit.selector,
        property: edit.property,
        restored_value: edit.previous_value,
        undo_depth,
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
    let message_id = allocate_devtools_message_id().map_err(|error| error.to_string())?;
    let message = serde_json::json!({
        "id": message_id,
        "method": "Runtime.evaluate",
        "params": { "expression": expression, "returnByValue": true }
    });
    let bytes = serde_json::to_vec(&message).map_err(|error| error.to_string())?;

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
        .map_err(|error| error.to_string())?;

    webview
        .send_dev_tools_message(&bytes)
        .map_err(|error| error.to_string())?;

    let (success, result) = tokio::time::timeout(Duration::from_secs(10), rx)
        .await
        .map_err(|_| "CDP evaluate timed out after 10s".to_string())?
        .map_err(|_| "CDP evaluate was cancelled".to_string())?;
    if !success {
        return Err("CDP Runtime.evaluate reported failure".to_string());
    }

    let value: serde_json::Value =
        serde_json::from_slice(&result).map_err(|error| format!("bad CDP result: {error}"))?;
    if let Some(error) = value.get("exceptionDetails") {
        return Err(format!("JS threw: {error}"));
    }

    Ok(value.pointer("/result/value").cloned().unwrap_or(value))
}

fn main() {
    let style_rules = build_style_index();

    tauri::Builder::default()
        .runtime(tauri_runtime_cef::Cef::default())
        .manage(CoreStarted(Instant::now()))
        .manage(CanvasState {
            selection: Mutex::new(None),
        })
        .manage(StyleIndex {
            rules: Mutex::new(style_rules),
        })
        .manage(EditHistory {
            undo: Mutex::new(Vec::new()),
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
            canvas_history_state,
            canvas_set_style_px,
            canvas_undo_style,
            canvas_cdp_evaluate
        ])
        .run(tauri::generate_context!())
        .expect("error while running Nia");
}
