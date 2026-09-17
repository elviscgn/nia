use crate::model_core::ModelState;
use crate::scratch_core::{ScratchDocument, ScratchSelection, ScratchState};
use crate::vision_core::VisionState;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant};

const MAX_DOCUMENT_BYTES: usize = 1_000_000;
const MAX_PROMPT_BYTES: usize = 24_000;
const MAX_HISTORY_ENTRIES: usize = 80;
const STARTER_MESSAGE: &str = "Describe what you want to build or change in Scratch.";

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScratchAgentRequest {
    prompt: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScratchChatEntry {
    role: String,
    text: String,
    meta: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScratchAgentResponse {
    document: ScratchDocument,
    summary: String,
    model: String,
    latency_ms: u128,
    undo_depth: usize,
    version: u64,
    history: Vec<ScratchChatEntry>,
}

#[derive(Debug)]
pub struct ScratchAgentState {
    history: Mutex<Vec<ScratchChatEntry>>,
    path: PathBuf,
}

#[derive(Debug, Deserialize)]
struct ModelEnvelope {
    choices: Vec<ModelChoice>,
}

#[derive(Debug, Deserialize)]
struct ModelChoice {
    message: ModelMessage,
}

#[derive(Debug, Deserialize)]
struct ModelMessage {
    content: String,
}

#[derive(Debug, Deserialize)]
struct ModelEdit {
    html: String,
    css: String,
    js: String,
    summary: String,
}

struct CompletedEdit {
    document: ScratchDocument,
    summary: String,
    model: String,
    latency_ms: u128,
    undo_depth: usize,
    version: u64,
}

fn history_path() -> PathBuf {
    if let Ok(value) = std::env::var("NIA_STATE_DIR") {
        if !value.trim().is_empty() {
            return PathBuf::from(value).join("scratch-chat.json");
        }
    }

    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_else(|_| ".".to_string());
    PathBuf::from(home).join(".nia").join("scratch-chat.json")
}

fn starter_history() -> Vec<ScratchChatEntry> {
    vec![ScratchChatEntry {
        role: "assistant".to_string(),
        text: STARTER_MESSAGE.to_string(),
        meta: None,
    }]
}

fn load_history(path: &PathBuf) -> Vec<ScratchChatEntry> {
    let Ok(raw) = fs::read_to_string(path) else {
        return starter_history();
    };
    let Ok(mut history) = serde_json::from_str::<Vec<ScratchChatEntry>>(&raw) else {
        return starter_history();
    };
    if history.is_empty() {
        return starter_history();
    }
    if history.len() > MAX_HISTORY_ENTRIES {
        history.drain(0..history.len() - MAX_HISTORY_ENTRIES);
    }
    history
}

fn persist_history(path: &PathBuf, history: &[ScratchChatEntry]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("failed to create scratch agent state directory: {error}"))?;
    }
    let json = serde_json::to_string_pretty(history)
        .map_err(|error| format!("failed to serialize scratch agent history: {error}"))?;
    let temp = path.with_extension("json.tmp");
    fs::write(&temp, json)
        .map_err(|error| format!("failed to write scratch agent history: {error}"))?;
    fs::rename(&temp, path)
        .map_err(|error| format!("failed to commit scratch agent history: {error}"))?;
    Ok(())
}

impl ScratchAgentState {
    pub fn load() -> Self {
        let path = history_path();
        let history = load_history(&path);
        Self {
            history: Mutex::new(history),
            path,
        }
    }

    fn snapshot(&self) -> Result<Vec<ScratchChatEntry>, String> {
        Ok(self.history.lock().map_err(|error| error.to_string())?.clone())
    }

    fn push(&self, role: &str, text: String, meta: Option<String>) -> Result<Vec<ScratchChatEntry>, String> {
        let mut history = self.history.lock().map_err(|error| error.to_string())?;
        history.push(ScratchChatEntry {
            role: role.to_string(),
            text,
            meta,
        });
        if history.len() > MAX_HISTORY_ENTRIES {
            let overflow = history.len() - MAX_HISTORY_ENTRIES;
            history.drain(0..overflow);
        }
        persist_history(&self.path, &history)?;
        Ok(history.clone())
    }

    fn clear(&self) -> Result<Vec<ScratchChatEntry>, String> {
        let mut history = self.history.lock().map_err(|error| error.to_string())?;
        *history = starter_history();
        persist_history(&self.path, &history)?;
        Ok(history.clone())
    }
}

fn trim_json_fence(value: &str) -> &str {
    let trimmed = value.trim();
    if let Some(rest) = trimmed.strip_prefix("```json") {
        return rest.strip_suffix("```").unwrap_or(rest).trim();
    }
    if let Some(rest) = trimmed.strip_prefix("```") {
        return rest.strip_suffix("```").unwrap_or(rest).trim();
    }
    trimmed
}

fn validate_request(request: &ScratchAgentRequest, document: &ScratchDocument) -> Result<(), String> {
    if request.prompt.trim().is_empty() {
        return Err("agent prompt is empty".to_string());
    }
    if request.prompt.len() > MAX_PROMPT_BYTES {
        return Err("agent prompt is too large".to_string());
    }
    let document_size = document.html.len() + document.css.len() + document.js.len();
    if document_size > MAX_DOCUMENT_BYTES {
        return Err("scratch document is too large for this agent request".to_string());
    }
    Ok(())
}

fn selection_context(selection: &Option<ScratchSelection>) -> serde_json::Value {
    match selection {
        Some(selection) => serde_json::json!({
            "selector": selection.selector,
            "tag": selection.tag,
            "id": selection.id,
            "classes": selection.classes,
            "text": selection.text,
            "computedStyles": selection.styles,
        }),
        None => serde_json::Value::Null,
    }
}

async fn execute_edit(
    request: &ScratchAgentRequest,
    scratch_state: &ScratchState,
    model_state: &ModelState,
    vision_state: &VisionState,
) -> Result<CompletedEdit, String> {
    let document = scratch_state.document()?;
    let selection = scratch_state.selection()?;
    let vision = vision_state.snapshot()?;
    validate_request(request, &document)?;

    let provider = model_state.resolve()?;
    let model = provider.model.clone();
    let endpoint = format!("{}/chat/completions", provider.base_url);

    let system = r#"You are Nia's Scratch editing engine. Edit only the supplied raw HTML, CSS, and JavaScript document. Preserve working behavior unless the user asks to change it. Use the selected DOM context when provided. Follow the vision context as design intent. Return one JSON object only with exactly these string fields: html, css, js, summary. Do not wrap the JSON in markdown. Do not include explanations outside the JSON. Keep changes focused and make the resulting document runnable without a framework."#;

    let user_payload = serde_json::json!({
        "request": request.prompt,
        "vision": {
            "description": vision.description,
            "references": vision.references,
            "scope": vision.scope,
            "version": vision.version,
        },
        "selection": selection_context(&selection),
        "document": {
            "html": document.html,
            "css": document.css,
            "js": document.js,
        }
    });

    let body = serde_json::json!({
        "model": model,
        "messages": [
            { "role": "system", "content": system },
            { "role": "user", "content": user_payload.to_string() }
        ]
    });

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(45))
        .build()
        .map_err(|error| format!("failed to create model client: {error}"))?;
    let mut call = client.post(endpoint).json(&body);
    if let Some(api_key) = provider.api_key {
        call = call.bearer_auth(api_key);
    }

    let started = Instant::now();
    let response = call
        .send()
        .await
        .map_err(|error| format!("model request failed: {error}"))?;
    let status = response.status();
    let response_text = response
        .text()
        .await
        .map_err(|error| format!("failed to read model response: {error}"))?;

    if !status.is_success() {
        let preview = response_text.chars().take(800).collect::<String>();
        return Err(format!("model provider returned {status}: {preview}"));
    }

    let envelope: ModelEnvelope = serde_json::from_str(&response_text)
        .map_err(|error| format!("invalid chat completion response: {error}"))?;
    let content = envelope
        .choices
        .first()
        .map(|choice| choice.message.content.as_str())
        .ok_or_else(|| "model returned no choices".to_string())?;
    let edit: ModelEdit = serde_json::from_str(trim_json_fence(content))
        .map_err(|error| format!("model did not return valid Scratch JSON: {error}"))?;

    let next = ScratchDocument {
        html: edit.html,
        css: edit.css,
        js: edit.js,
    };
    let result_size = next.html.len() + next.css.len() + next.js.len();
    if result_size > MAX_DOCUMENT_BYTES {
        return Err("model returned a Scratch document that is too large".to_string());
    }

    let snapshot = scratch_state.replace_document(next)?;

    Ok(CompletedEdit {
        document: snapshot.document,
        summary: edit.summary,
        model,
        latency_ms: started.elapsed().as_millis(),
        undo_depth: snapshot.undo_depth,
        version: snapshot.version,
    })
}

#[tauri::command]
pub fn scratch_agent_history(
    state: tauri::State<'_, ScratchAgentState>,
) -> Result<Vec<ScratchChatEntry>, String> {
    state.snapshot()
}

#[tauri::command]
pub fn scratch_agent_clear_history(
    state: tauri::State<'_, ScratchAgentState>,
) -> Result<Vec<ScratchChatEntry>, String> {
    state.clear()
}

#[tauri::command]
pub async fn scratch_agent_run(
    request: ScratchAgentRequest,
    scratch_state: tauri::State<'_, ScratchState>,
    model_state: tauri::State<'_, ModelState>,
    vision_state: tauri::State<'_, VisionState>,
    agent_state: tauri::State<'_, ScratchAgentState>,
) -> Result<ScratchAgentResponse, String> {
    let document = scratch_state.document()?;
    validate_request(&request, &document)?;

    let prompt = request.prompt.trim().to_string();
    agent_state.push("user", prompt, None)?;

    match execute_edit(&request, &scratch_state, &model_state, &vision_state).await {
        Ok(edit) => {
            let summary = if edit.summary.trim().is_empty() {
                "Updated Scratch.".to_string()
            } else {
                edit.summary.clone()
            };
            let meta = Some(format!("{} · {} ms", edit.model, edit.latency_ms));
            let history = agent_state.push("assistant", summary.clone(), meta)?;
            Ok(ScratchAgentResponse {
                document: edit.document,
                summary,
                model: edit.model,
                latency_ms: edit.latency_ms,
                undo_depth: edit.undo_depth,
                version: edit.version,
                history,
            })
        }
        Err(error) => {
            let _ = agent_state.push("error", error.clone(), None);
            Err(error)
        }
    }
}
