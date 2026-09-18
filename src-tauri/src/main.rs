use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Component, Path, PathBuf};
use std::sync::mpsc::{sync_channel, RecvTimeoutError, SyncSender};
use std::sync::{Arc, Mutex, RwLock};
use std::time::{Duration, Instant, UNIX_EPOCH};

use tauri_runtime_cef::{allocate_devtools_message_id, DevToolsProtocol, WebviewCefExt};

#[derive(Clone)]
struct CoreStarted(Instant);

const CANVAS_SAMPLE_URL: &str = "http://127.0.0.1:1421";
const MAX_EDIT_HISTORY: usize = 100;
const STYLE_INDEX_POLL_MS: u64 = 350;

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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StyleIndexState {
    version: u64,
    file_count: usize,
    rule_count: usize,
}

#[derive(Debug, Clone)]
struct StyleRuleRef {
    file: String,
    selector: String,
    line: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct StyleFileStamp {
    len: u64,
    modified_ns: u128,
}

#[derive(Debug, Clone)]
struct StyleIndexSnapshot {
    rules: Vec<StyleRuleRef>,
    files: BTreeMap<String, StyleFileStamp>,
    version: u64,
    project_version: u64,
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

#[derive(Clone)]
struct StyleIndex {
    snapshot: Arc<RwLock<StyleIndexSnapshot>>,
    refresh_tx: SyncSender<()>,
}

struct EditHistory {
    undo: Mutex<Vec<CanvasEdit>>,
}

impl StyleIndex {
    fn start(project_state: ProjectState) -> Self {
        let snapshot = Arc::new(RwLock::new(build_style_index_snapshot(&project_state, 1)));
        let (refresh_tx, refresh_rx) = sync_channel::<()>(1);
        let worker_snapshot = Arc::clone(&snapshot);
        let worker_project = project_state.clone();

        let _ = std::thread::Builder::new()
            .name("nia-style-index".to_string())
            .spawn(move || loop {
                match refresh_rx.recv_timeout(Duration::from_millis(STYLE_INDEX_POLL_MS)) {
                    Ok(()) | Err(RecvTimeoutError::Timeout) => {
                        let _ = refresh_style_index_if_changed(&worker_snapshot, &worker_project);
                    }
                    Err(RecvTimeoutError::Disconnected) => break,
                }
            });

        Self {
            snapshot,
            refresh_tx,
        }
    }

    fn request_refresh(&self) {
        let _ = self.refresh_tx.try_send(());
    }

    fn state(&self) -> Result<StyleIndexState, String> {
        let snapshot = self.snapshot.read().map_err(|error| error.to_string())?;
        Ok(StyleIndexState {
            version: snapshot.version,
            file_count: snapshot.files.len(),
            rule_count: snapshot.rules.len(),
        })
    }
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

fn safe_project_file(relative: &str, project_state: &ProjectState) -> Result<PathBuf, String> {
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

    let root = project_state.root()?.canonicalize()
        .map_err(|error| format!("failed to resolve project root: {error}"))?;
    let candidate = root.join(relative_path);
    let resolved = candidate.canonicalize()
        .map_err(|error| format!("failed to resolve {}: {error}", candidate.display()))?;
    if !resolved.starts_with(&root) {
        return Err("project path escaped the active project root".to_string());
    }
    Ok(resolved)
}

fn relative_project_path(path: &Path, root: &Path) -> Result<String, String> {
    let relative = path
        .strip_prefix(root)
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

fn css_files(root: &Path) -> Vec<PathBuf> {
    let mut files = Vec::new();
    collect_css_files(root, &mut files);
    files.sort();
    files
}

fn style_file_stamp(path: &Path) -> Option<StyleFileStamp> {
    let metadata = std::fs::metadata(path).ok()?;
    let modified_ns = metadata
        .modified()
        .ok()
        .and_then(|modified| modified.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);

    Some(StyleFileStamp {
        len: metadata.len(),
        modified_ns,
    })
}

fn style_fingerprint(paths: &[PathBuf], root: &Path) -> BTreeMap<String, StyleFileStamp> {
    paths
        .iter()
        .filter_map(|path| {
            let file = relative_project_path(path, root).ok()?;
            let stamp = style_file_stamp(path)?;
            Some((file, stamp))
        })
        .collect()
}

fn index_css_file(path: &Path, css: &str, root: &Path) -> Vec<StyleRuleRef> {
    let Ok(file) = relative_project_path(path, root) else {
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

fn build_style_index_snapshot(project_state: &ProjectState, version: u64) -> StyleIndexSnapshot {
    let project = project_state.snapshot().ok();
    let project_version = project.as_ref().map(|value| value.version).unwrap_or(0);
    let root = project
        .as_ref()
        .map(|value| PathBuf::from(&value.root))
        .unwrap_or_default();
    let paths = if root.as_os_str().is_empty() { Vec::new() } else { css_files(&root) };
    let files = style_fingerprint(&paths, &root);
    let mut rules = Vec::new();

    for path in paths {
        let Ok(css) = std::fs::read_to_string(&path) else {
            continue;
        };
        rules.extend(index_css_file(&path, &css, &root));
    }

    StyleIndexSnapshot {
        rules,
        files,
        version,
        project_version,
    }
}

fn refresh_style_index_if_changed(
    snapshot: &Arc<RwLock<StyleIndexSnapshot>>,
    project_state: &ProjectState,
) -> Result<bool, String> {
    let project = project_state.snapshot()?;
    let root = PathBuf::from(&project.root);
    let paths = css_files(&root);
    let files = style_fingerprint(&paths, &root);
    let current_version = {
        let current = snapshot.read().map_err(|error| error.to_string())?;
        if current.project_version == project.version && current.files == files {
            return Ok(false);
        }
        current.version
    };

    let next = build_style_index_snapshot(project_state, current_version.saturating_add(1));
    *snapshot.write().map_err(|error| error.to_string())? = next;
    Ok(true)
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

    let Ok(snapshot) = style_index.snapshot.read() else {
        return;
    };

    let best = snapshot
        .rules
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

    drop(snapshot);

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
    style_index.request_refresh();
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

#[tauri::command]
fn canvas_style_index_state(style_index: tauri::State<'_, StyleIndex>) -> Result<StyleIndexState, String> {
    style_index.state()
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

fn source_hint_offset(source: &str, line: u32, column: u32) -> usize {
    if line == 0 {
        return 0;
    }

    let mut offset = 0usize;
    for (index, chunk) in source.split_inclusive('\n').enumerate() {
        if index + 1 == line as usize {
            return offset + (column.saturating_sub(1) as usize).min(chunk.len());
        }
        offset += chunk.len();
    }
    source.len()
}

fn parse_static_class_value(source: &str, attr_start: usize) -> Option<(usize, usize, String)> {
    let bytes = source.as_bytes();
    let mut cursor = attr_start.checked_add("className".len())?;
    while cursor < bytes.len() && bytes[cursor].is_ascii_whitespace() {
        cursor += 1;
    }
    if bytes.get(cursor).copied()? != b'=' {
        return None;
    }
    cursor += 1;
    while cursor < bytes.len() && bytes[cursor].is_ascii_whitespace() {
        cursor += 1;
    }

    let quote = *bytes.get(cursor)?;
    if quote != b'\'' && quote != b'"' {
        return None;
    }
    let value_start = cursor + 1;
    let mut value_end = value_start;
    while value_end < bytes.len() && bytes[value_end] != quote {
        value_end += 1;
    }
    if value_end >= bytes.len() {
        return None;
    }

    Some((value_start, value_end, source[value_start..value_end].to_string()))
}

fn replace_static_class_token(
    source: &str,
    line: u32,
    column: u32,
    expected_class_value: &str,
    old_token: &str,
    new_token: &str,
) -> Result<String, String> {
    if old_token.is_empty() || new_token.is_empty() {
        return Err("class tokens cannot be empty".to_string());
    }
    if old_token.len() > 160 || new_token.len() > 160 {
        return Err("class token is too long".to_string());
    }
    if old_token.chars().any(char::is_whitespace)
        || new_token.chars().any(char::is_whitespace)
        || old_token.contains(['\'', '"'])
        || new_token.contains(['\'', '"'])
    {
        return Err("class tokens must be single unquoted tokens".to_string());
    }
    if old_token == new_token {
        return Err("class token is unchanged".to_string());
    }

    let tokens = expected_class_value.split_ascii_whitespace().collect::<Vec<_>>();
    if !tokens.iter().any(|token| *token == old_token) {
        return Err(format!("class token not present in expected className: {old_token}"));
    }

    let next_class_value = tokens
        .iter()
        .map(|token| if *token == old_token { new_token } else { *token })
        .collect::<Vec<_>>()
        .join(" ");

    let hint = source_hint_offset(source, line, column);
    let mut best: Option<(usize, usize, usize)> = None;
    for (attr_start, _) in source.match_indices("className") {
        let Some((value_start, value_end, value)) = parse_static_class_value(source, attr_start) else {
            continue;
        };
        if value != expected_class_value {
            continue;
        }
        let distance = attr_start.abs_diff(hint);
        if best.map(|(_, _, current)| distance < current).unwrap_or(true) {
            best = Some((value_start, value_end, distance));
        }
    }

    let Some((value_start, value_end, distance)) = best else {
        return Err("could not find the expected static className near the source location".to_string());
    };
    if distance > 4096 {
        return Err("className match was too far from the reported source location".to_string());
    }

    let mut patched = source.to_string();
    patched.replace_range(value_start..value_end, &next_class_value);
    Ok(patched)
}

#[tauri::command]
async fn canvas_set_style_px(
    file: String,
    selector: String,
    property: String,
    value_px: f64,
    history: tauri::State<'_, EditHistory>,
    style_index: tauri::State<'_, StyleIndex>,
    project_state: tauri::State<'_, ProjectState>,
) -> Result<CanvasStylePatchResult, String> {
    let path = safe_project_file(&file, &project_state)?;
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

    style_index.request_refresh();

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
async fn canvas_replace_class_token(
    file: String,
    line: u32,
    column: u32,
    expected_class_value: String,
    old_token: String,
    new_token: String,
    history: tauri::State<'_, EditHistory>,
    project_state: tauri::State<'_, ProjectState>,
) -> Result<CanvasStylePatchResult, String> {
    let path = safe_project_file(&file, &project_state)?;
    let extension = path.extension().and_then(|extension| extension.to_str());
    if !matches!(extension, Some("tsx" | "jsx")) {
        return Err("class token edits currently require a TSX or JSX file".to_string());
    }

    let source = tokio::fs::read_to_string(&path)
        .await
        .map_err(|error| format!("failed to read {}: {error}", path.display()))?;
    let patched = replace_static_class_token(
        &source,
        line,
        column,
        &expected_class_value,
        &old_token,
        &new_token,
    )?;

    tokio::fs::write(&path, &patched)
        .await
        .map_err(|error| format!("failed to write {}: {error}", path.display()))?;

    let undo_depth = {
        let mut undo = history.undo.lock().map_err(|error| error.to_string())?;
        undo.push(CanvasEdit {
            file: file.clone(),
            selector: "className".to_string(),
            property: "class-token".to_string(),
            before: source,
            after: patched,
            previous_value: Some(old_token.clone()),
        });
        if undo.len() > MAX_EDIT_HISTORY {
            undo.remove(0);
        }
        undo.len()
    };

    Ok(CanvasStylePatchResult {
        file,
        selector: "className".to_string(),
        property: "class-token".to_string(),
        previous_value: Some(old_token),
        value: new_token,
        undo_depth,
    })
}

#[tauri::command]
async fn canvas_undo_style(
    history: tauri::State<'_, EditHistory>,
    style_index: tauri::State<'_, StyleIndex>,
    project_state: tauri::State<'_, ProjectState>,
) -> Result<CanvasUndoResult, String> {
    let edit = {
        let mut undo = history.undo.lock().map_err(|error| error.to_string())?;
        undo.pop().ok_or_else(|| "nothing to undo".to_string())?
    };

    let path = safe_project_file(&edit.file, &project_state)?;
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
    style_index.request_refresh();

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
