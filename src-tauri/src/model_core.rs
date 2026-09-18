use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant};

const MAX_BASE_URL_LEN: usize = 512;
const MAX_MODEL_LEN: usize = 256;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PersistedModelSettings {
    base_url: String,
    model: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelSettingsSnapshot {
    pub base_url: String,
    pub model: String,
    pub has_api_key: bool,
    pub source: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelSettingsInput {
    base_url: String,
    model: String,
    api_key: Option<String>,
}

#[derive(Debug, Clone)]
pub struct ModelProviderConfig {
    pub base_url: String,
    pub model: String,
    pub api_key: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelConnectionResult {
    pub ok: bool,
    pub status: u16,
    pub latency_ms: u128,
    pub model: String,
}

#[derive(Debug)]
struct ModelInner {
    settings: PersistedModelSettings,
    api_key: Option<String>,
    source: String,
}

pub struct ModelState {
    inner: Mutex<ModelInner>,
    path: PathBuf,
}

fn env_setting(primary: &str, fallback: &str) -> Option<String> {
    std::env::var(primary)
        .ok()
        .filter(|value| !value.trim().is_empty())
        .or_else(|| std::env::var(fallback).ok().filter(|value| !value.trim().is_empty()))
}

fn state_path() -> PathBuf {
    if let Ok(value) = std::env::var("NIA_STATE_DIR") {
        if !value.trim().is_empty() {
            return PathBuf::from(value).join("model.json");
        }
    }

    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_else(|_| ".".to_string());
    PathBuf::from(home).join(".nia").join("model.json")
}

fn validate_public_settings(settings: &PersistedModelSettings) -> Result<(), String> {
    let base_url = settings.base_url.trim();
    let model = settings.model.trim();

    if base_url.is_empty() {
        return Err("model base URL is empty".to_string());
    }
    if base_url.len() > MAX_BASE_URL_LEN {
        return Err("model base URL is too long".to_string());
    }
    if !(base_url.starts_with("http://") || base_url.starts_with("https://")) {
        return Err("model base URL must start with http:// or https://".to_string());
    }
    if model.is_empty() {
        return Err("model name is empty".to_string());
    }
    if model.len() > MAX_MODEL_LEN {
        return Err("model name is too long".to_string());
    }
    Ok(())
}

fn persist(path: &PathBuf, settings: &PersistedModelSettings) -> Result<(), String> {
    validate_public_settings(settings)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("failed to create model settings directory: {error}"))?;
    }
    let json = serde_json::to_string_pretty(settings)
        .map_err(|error| format!("failed to serialize model settings: {error}"))?;
    let temp = path.with_extension("json.tmp");
    fs::write(&temp, json)
        .map_err(|error| format!("failed to write model settings: {error}"))?;
    fs::rename(&temp, path)
        .map_err(|error| format!("failed to commit model settings: {error}"))?;
    Ok(())
}

fn load_persisted(path: &PathBuf) -> Option<PersistedModelSettings> {
    let raw = fs::read_to_string(path).ok()?;
    let settings = serde_json::from_str::<PersistedModelSettings>(&raw).ok()?;
    validate_public_settings(&settings).ok()?;
    Some(settings)
}

impl ModelState {
    pub fn load() -> Self {
        let path = state_path();
        let persisted = load_persisted(&path);
        let env_base_url = env_setting("NIA_MODEL_BASE_URL", "OPENAI_BASE_URL");
        let env_model = env_setting("NIA_MODEL", "OPENAI_MODEL");
        let env_api_key = env_setting("NIA_MODEL_API_KEY", "OPENAI_API_KEY");

        let (settings, source) = if let Some(settings) = persisted {
            (settings, "settings".to_string())
        } else {
            (
                PersistedModelSettings {
                    base_url: env_base_url.unwrap_or_default(),
                    model: env_model.unwrap_or_default(),
                },
                "environment".to_string(),
            )
        };

        Self {
            inner: Mutex::new(ModelInner {
                settings,
                api_key: env_api_key,
                source,
            }),
            path,
        }
    }

    pub fn snapshot(&self) -> Result<ModelSettingsSnapshot, String> {
        let inner = self.inner.lock().map_err(|error| error.to_string())?;
        Ok(ModelSettingsSnapshot {
            base_url: inner.settings.base_url.clone(),
            model: inner.settings.model.clone(),
            has_api_key: inner.api_key.as_ref().is_some_and(|value| !value.trim().is_empty()),
            source: inner.source.clone(),
        })
    }

    pub fn resolve(&self) -> Result<ModelProviderConfig, String> {
        let inner = self.inner.lock().map_err(|error| error.to_string())?;
        validate_public_settings(&inner.settings)?;
        Ok(ModelProviderConfig {
            base_url: inner.settings.base_url.trim().trim_end_matches('/').to_string(),
            model: inner.settings.model.trim().to_string(),
            api_key: inner.api_key.clone().filter(|value| !value.trim().is_empty()),
        })
    }

    pub fn save(&self, input: ModelSettingsInput) -> Result<ModelSettingsSnapshot, String> {
        let settings = PersistedModelSettings {
            base_url: input.base_url.trim().trim_end_matches('/').to_string(),
            model: input.model.trim().to_string(),
        };
        validate_public_settings(&settings)?;
        persist(&self.path, &settings)?;

        let mut inner = self.inner.lock().map_err(|error| error.to_string())?;
        inner.settings = settings;
        if let Some(api_key) = input.api_key {
            let trimmed = api_key.trim().to_string();
            inner.api_key = if trimmed.is_empty() { None } else { Some(trimmed) };
        }
        inner.source = "settings".to_string();

        Ok(ModelSettingsSnapshot {
            base_url: inner.settings.base_url.clone(),
            model: inner.settings.model.clone(),
            has_api_key: inner.api_key.is_some(),
            source: inner.source.clone(),
        })
    }
}

pub fn model_settings_get(state: tauri::State<'_, ModelState>) -> Result<ModelSettingsSnapshot, String> {
    state.snapshot()
}

pub fn model_settings_save(
    input: ModelSettingsInput,
    state: tauri::State<'_, ModelState>,
) -> Result<ModelSettingsSnapshot, String> {
    state.save(input)
}

pub async fn model_test_connection(
    state: tauri::State<'_, ModelState>,
) -> Result<ModelConnectionResult, String> {
    let provider = state.resolve()?;
    let endpoint = format!("{}/models", provider.base_url);
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|error| format!("failed to create model client: {error}"))?;

    let mut request = client.get(endpoint);
    if let Some(api_key) = provider.api_key {
        request = request.bearer_auth(api_key);
    }

    let started = Instant::now();
    let response = request
        .send()
        .await
        .map_err(|error| format!("model connection failed: {error}"))?;
    let status = response.status();
    let latency_ms = started.elapsed().as_millis();

    if !status.is_success() {
        let preview = response.text().await.unwrap_or_default().chars().take(500).collect::<String>();
        return Err(format!("model provider returned {status}: {preview}"));
    }

    Ok(ModelConnectionResult {
        ok: true,
        status: status.as_u16(),
        latency_ms,
        model: provider.model,
    })
}
