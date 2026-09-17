use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::env;
use std::time::{Duration, Instant};

const MAX_DOCUMENT_BYTES: usize = 1_000_000;
const MAX_PROMPT_BYTES: usize = 24_000;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScratchAgentSelection {
    selector: String,
    tag: String,
    id: String,
    classes: Vec<String>,
    text: String,
    styles: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScratchAgentRequest {
    prompt: String,
    html: String,
    css: String,
    js: String,
    vision: String,
    selection: Option<ScratchAgentSelection>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScratchAgentDocument {
    html: String,
    css: String,
    js: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScratchAgentResponse {
    html: String,
    css: String,
    js: String,
    summary: String,
    model: String,
    latency_ms: u128,
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

fn provider_setting(primary: &str, fallback: &str) -> Option<String> {
    env::var(primary)
        .ok()
        .filter(|value| !value.trim().is_empty())
        .or_else(|| env::var(fallback).ok().filter(|value| !value.trim().is_empty()))
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

fn validate_request(request: &ScratchAgentRequest) -> Result<(), String> {
    if request.prompt.trim().is_empty() {
        return Err("agent prompt is empty".to_string());
    }
    if request.prompt.len() > MAX_PROMPT_BYTES {
        return Err("agent prompt is too large".to_string());
    }
    let document_size = request.html.len() + request.css.len() + request.js.len();
    if document_size > MAX_DOCUMENT_BYTES {
        return Err("scratch document is too large for this agent request".to_string());
    }
    Ok(())
}

fn selection_context(selection: &Option<ScratchAgentSelection>) -> serde_json::Value {
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

#[tauri::command]
pub async fn scratch_agent_run(request: ScratchAgentRequest) -> Result<ScratchAgentResponse, String> {
    validate_request(&request)?;

    let base_url = provider_setting("NIA_MODEL_BASE_URL", "OPENAI_BASE_URL")
        .ok_or_else(|| "no model provider configured, set NIA_MODEL_BASE_URL and NIA_MODEL".to_string())?;
    let model = provider_setting("NIA_MODEL", "OPENAI_MODEL")
        .ok_or_else(|| "no model configured, set NIA_MODEL".to_string())?;
    let api_key = provider_setting("NIA_MODEL_API_KEY", "OPENAI_API_KEY");
    let endpoint = format!("{}/chat/completions", base_url.trim_end_matches('/'));

    let system = r#"You are Nia's Scratch editing engine. Edit only the supplied raw HTML, CSS, and JavaScript document. Preserve working behavior unless the user asks to change it. Use the selected DOM context when provided. Follow the vision context as design intent. Return one JSON object only with exactly these string fields: html, css, js, summary. Do not wrap the JSON in markdown. Do not include explanations outside the JSON. Keep changes focused and make the resulting document runnable without a framework."#;

    let user_payload = serde_json::json!({
        "request": request.prompt,
        "vision": request.vision,
        "selection": selection_context(&request.selection),
        "document": {
            "html": request.html,
            "css": request.css,
            "js": request.js,
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
    if let Some(api_key) = api_key {
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

    let result_size = edit.html.len() + edit.css.len() + edit.js.len();
    if result_size > MAX_DOCUMENT_BYTES {
        return Err("model returned a Scratch document that is too large".to_string());
    }

    Ok(ScratchAgentResponse {
        html: edit.html,
        css: edit.css,
        js: edit.js,
        summary: edit.summary,
        model,
        latency_ms: started.elapsed().as_millis(),
    })
}
