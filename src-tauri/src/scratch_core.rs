use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

const MAX_SCRATCH_HISTORY: usize = 100;
const MAX_SCRATCH_BYTES: usize = 1_000_000;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScratchDocument {
    pub html: String,
    pub css: String,
    pub js: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScratchSelection {
    pub selector: String,
    pub tag: String,
    pub id: String,
    pub classes: Vec<String>,
    pub text: String,
    pub styles: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScratchSnapshot {
    pub document: ScratchDocument,
    pub selection: Option<ScratchSelection>,
    pub undo_depth: usize,
    pub version: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScratchStylePatchResult {
    pub file: &'static str,
    pub selector: String,
    pub property: String,
    pub previous_value: Option<String>,
    pub value: String,
    pub undo_depth: usize,
    pub document: ScratchDocument,
    pub version: u64,
}

struct ScratchInner {
    document: ScratchDocument,
    selection: Option<ScratchSelection>,
    undo: Vec<ScratchDocument>,
    version: u64,
}

pub struct ScratchState {
    inner: Mutex<ScratchInner>,
    path: PathBuf,
}

fn starter_document() -> ScratchDocument {
    ScratchDocument {
        html: r#"<main class="landing">
  <p class="eyebrow">Nia Scratch</p>
  <h1>Build the idea first.</h1>
  <p class="lede">Raw HTML, CSS, and JavaScript. No framework in the way.</p>
  <button id="action">Try it</button>
  <p id="status" class="status">Ready.</p>
</main>"#
            .to_string(),
        css: r#"* { box-sizing: border-box; }
body {
  margin: 0;
  min-height: 100vh;
  display: grid;
  place-items: center;
  font-family: Inter, ui-sans-serif, system-ui, sans-serif;
  color: #191813;
  background: #f5f2e9;
}
.landing { width: min(680px, calc(100vw - 48px)); }
.eyebrow { color: #9a6a00; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
h1 { margin: 12px 0; font-size: 72px; line-height: .94; letter-spacing: -.05em; }
.lede { max-width: 520px; color: #69655c; font-size: 18px; line-height: 1.6; }
button { margin-top: 20px; border: 0; border-radius: 10px; padding: 12px 18px; font: inherit; font-weight: 700; background: #d79a08; color: #1d1708; cursor: pointer; }
.status { margin-top: 18px; color: #7d776d; }"#
            .to_string(),
        js: r#"const button = document.querySelector("#action");
const status = document.querySelector("#status");
let clicks = 0;
button?.addEventListener("click", () => {
  clicks += 1;
  if (status) status.textContent = `Clicked ${clicks} time${clicks === 1 ? "" : "s"}.`;
});"#
            .to_string(),
    }
}

fn state_path() -> PathBuf {
    if let Ok(value) = std::env::var("NIA_STATE_DIR") {
        if !value.trim().is_empty() {
            return PathBuf::from(value).join("scratch.json");
        }
    }

    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_else(|_| ".".to_string());
    PathBuf::from(home).join(".nia").join("scratch.json")
}

fn document_size(document: &ScratchDocument) -> usize {
    document.html.len() + document.css.len() + document.js.len()
}

fn validate_document(document: &ScratchDocument) -> Result<(), String> {
    if document_size(document) > MAX_SCRATCH_BYTES {
        return Err("scratch document is too large".to_string());
    }
    Ok(())
}

fn load_document(path: &PathBuf) -> ScratchDocument {
    let Ok(raw) = fs::read_to_string(path) else {
        return starter_document();
    };
    serde_json::from_str(&raw)
        .ok()
        .filter(|document: &ScratchDocument| validate_document(document).is_ok())
        .unwrap_or_else(starter_document)
}

fn persist_document(path: &PathBuf, document: &ScratchDocument) -> Result<(), String> {
    validate_document(document)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("failed to create scratch state directory: {error}"))?;
    }
    let json = serde_json::to_string_pretty(document)
        .map_err(|error| format!("failed to serialize scratch document: {error}"))?;
    let temp = path.with_extension("json.tmp");
    fs::write(&temp, json)
        .map_err(|error| format!("failed to write scratch state: {error}"))?;
    fs::rename(&temp, path)
        .map_err(|error| format!("failed to commit scratch state: {error}"))?;
    Ok(())
}

fn allowed_numeric_property(property: &str) -> bool {
    matches!(
        property,
        "font-size" | "gap" | "padding" | "border-radius" | "margin-top" | "margin-bottom"
    )
}

fn patch_visual_css(css: &str, selector: &str, property: &str, value: &str) -> String {
    let marker = "/* nia:visual-edits */";
    let selector = selector.trim();
    let next_rule = format!("{selector} {{ {property}: {value} !important; }}");
    let prefix = format!("{selector} {{ {property}:");

    let Some(marker_index) = css.find(marker) else {
        return format!("{}\n\n{marker}\n{next_rule}\n", css.trim_end());
    };

    let before = css[..marker_index].trim_end();
    let existing = css[marker_index + marker.len()..].trim();
    let mut replaced = false;
    let mut lines = existing
        .lines()
        .filter(|line| !line.trim().is_empty())
        .map(|line| {
            if !replaced && line.trim().starts_with(&prefix) {
                replaced = true;
                next_rule.clone()
            } else {
                line.to_string()
            }
        })
        .collect::<Vec<_>>();
    if !replaced {
        lines.push(next_rule);
    }
    format!("{before}\n\n{marker}\n{}\n", lines.join("\n"))
}

impl ScratchState {
    pub fn load() -> Self {
        let path = state_path();
        let document = load_document(&path);
        Self {
            inner: Mutex::new(ScratchInner {
                document,
                selection: None,
                undo: Vec::new(),
                version: 1,
            }),
            path,
        }
    }

    pub fn snapshot(&self) -> Result<ScratchSnapshot, String> {
        let inner = self.inner.lock().map_err(|error| error.to_string())?;
        Ok(ScratchSnapshot {
            document: inner.document.clone(),
            selection: inner.selection.clone(),
            undo_depth: inner.undo.len(),
            version: inner.version,
        })
    }

    pub fn document(&self) -> Result<ScratchDocument, String> {
        Ok(self.inner.lock().map_err(|error| error.to_string())?.document.clone())
    }

    pub fn selection(&self) -> Result<Option<ScratchSelection>, String> {
        Ok(self.inner.lock().map_err(|error| error.to_string())?.selection.clone())
    }

    pub fn replace_document(&self, next: ScratchDocument) -> Result<ScratchSnapshot, String> {
        validate_document(&next)?;
        let mut inner = self.inner.lock().map_err(|error| error.to_string())?;
        persist_document(&self.path, &next)?;
        let previous = std::mem::replace(&mut inner.document, next);
        inner.undo.push(previous);
        if inner.undo.len() > MAX_SCRATCH_HISTORY {
            inner.undo.remove(0);
        }
        inner.selection = None;
        inner.version = inner.version.saturating_add(1);
        Ok(ScratchSnapshot {
            document: inner.document.clone(),
            selection: None,
            undo_depth: inner.undo.len(),
            version: inner.version,
        })
    }
}

#[tauri::command]
pub fn scratch_get(state: tauri::State<'_, ScratchState>) -> Result<ScratchSnapshot, String> {
    state.snapshot()
}

#[tauri::command]
pub fn scratch_report_selection(
    selection: ScratchSelection,
    state: tauri::State<'_, ScratchState>,
) -> Result<(), String> {
    state.inner.lock().map_err(|error| error.to_string())?.selection = Some(selection);
    Ok(())
}

#[tauri::command]
pub fn scratch_set_style_px(
    selector: String,
    property: String,
    value_px: f64,
    state: tauri::State<'_, ScratchState>,
) -> Result<ScratchStylePatchResult, String> {
    if selector.trim().is_empty() {
        return Err("missing scratch selector".to_string());
    }
    if !allowed_numeric_property(&property) {
        return Err(format!("property is not allowed for scratch px edits: {property}"));
    }
    if !value_px.is_finite() || !(0.0..=1000.0).contains(&value_px) {
        return Err("pixel value must be finite and between 0 and 1000".to_string());
    }

    let value = if value_px.fract() == 0.0 {
        format!("{}px", value_px as i64)
    } else {
        format!("{value_px:.2}px")
    };

    let mut inner = state.inner.lock().map_err(|error| error.to_string())?;
    let mut next = inner.document.clone();
    next.css = patch_visual_css(&next.css, &selector, &property, &value);
    persist_document(&state.path, &next)?;

    let previous = std::mem::replace(&mut inner.document, next);
    inner.undo.push(previous);
    if inner.undo.len() > MAX_SCRATCH_HISTORY {
        inner.undo.remove(0);
    }
    inner.version = inner.version.saturating_add(1);

    Ok(ScratchStylePatchResult {
        file: "scratch/styles.css",
        selector,
        property,
        previous_value: None,
        value,
        undo_depth: inner.undo.len(),
        document: inner.document.clone(),
        version: inner.version,
    })
}

#[tauri::command]
pub fn scratch_undo(state: tauri::State<'_, ScratchState>) -> Result<ScratchSnapshot, String> {
    let mut inner = state.inner.lock().map_err(|error| error.to_string())?;
    let previous = inner.undo.pop().ok_or_else(|| "nothing to undo".to_string())?;
    persist_document(&state.path, &previous)?;
    inner.document = previous;
    inner.selection = None;
    inner.version = inner.version.saturating_add(1);
    Ok(ScratchSnapshot {
        document: inner.document.clone(),
        selection: None,
        undo_depth: inner.undo.len(),
        version: inner.version,
    })
}

#[tauri::command]
pub fn scratch_reset(state: tauri::State<'_, ScratchState>) -> Result<ScratchSnapshot, String> {
    state.replace_document(starter_document())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn visual_edits_replace_the_same_property() {
        let first = patch_visual_css("h1 { color: black; }", "h1", "font-size", "64px");
        let second = patch_visual_css(&first, "h1", "font-size", "68px");
        assert!(second.contains("h1 { font-size: 68px !important; }"));
        assert!(!second.contains("64px !important"));
    }
}
