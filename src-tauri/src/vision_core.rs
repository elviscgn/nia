use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

const MAX_DESCRIPTION_BYTES: usize = 16_000;
const MAX_REFERENCES: usize = 24;
const MAX_REFERENCE_BYTES: usize = 2_048;
const DEFAULT_DESCRIPTION: &str = "Warm editorial interface. Restrained amber. Dense typography. Minimal decoration.";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VisionContextSnapshot {
    pub description: String,
    pub references: Vec<String>,
    pub scope: String,
    pub version: u64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VisionContextInput {
    description: String,
    references: Vec<String>,
}

pub struct VisionState {
    inner: Mutex<VisionContextSnapshot>,
    path: PathBuf,
}

fn state_path() -> PathBuf {
    if let Ok(value) = std::env::var("NIA_STATE_DIR") {
        if !value.trim().is_empty() {
            return PathBuf::from(value).join("vision.json");
        }
    }

    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_else(|_| ".".to_string());
    PathBuf::from(home).join(".nia").join("vision.json")
}

fn default_context() -> VisionContextSnapshot {
    VisionContextSnapshot {
        description: DEFAULT_DESCRIPTION.to_string(),
        references: Vec::new(),
        scope: "project".to_string(),
        version: 1,
    }
}

fn normalize(input: VisionContextInput, version: u64) -> Result<VisionContextSnapshot, String> {
    let description = input.description.trim().to_string();
    if description.len() > MAX_DESCRIPTION_BYTES {
        return Err("vision description is too large".to_string());
    }
    if input.references.len() > MAX_REFERENCES {
        return Err(format!("vision supports at most {MAX_REFERENCES} references"));
    }

    let mut references = Vec::with_capacity(input.references.len());
    for reference in input.references {
        let trimmed = reference.trim();
        if trimmed.is_empty() {
            continue;
        }
        if trimmed.len() > MAX_REFERENCE_BYTES {
            return Err("vision reference is too large".to_string());
        }
        if !references.iter().any(|value| value == trimmed) {
            references.push(trimmed.to_string());
        }
    }

    Ok(VisionContextSnapshot {
        description,
        references,
        scope: "project".to_string(),
        version,
    })
}

fn load_context(path: &PathBuf) -> VisionContextSnapshot {
    let Ok(raw) = fs::read_to_string(path) else {
        return default_context();
    };
    let Ok(context) = serde_json::from_str::<VisionContextSnapshot>(&raw) else {
        return default_context();
    };
    if context.description.len() > MAX_DESCRIPTION_BYTES || context.references.len() > MAX_REFERENCES {
        return default_context();
    }
    context
}

fn persist(path: &PathBuf, context: &VisionContextSnapshot) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("failed to create vision state directory: {error}"))?;
    }
    let json = serde_json::to_string_pretty(context)
        .map_err(|error| format!("failed to serialize vision context: {error}"))?;
    let temp = path.with_extension("json.tmp");
    fs::write(&temp, json)
        .map_err(|error| format!("failed to write vision context: {error}"))?;
    fs::rename(&temp, path)
        .map_err(|error| format!("failed to commit vision context: {error}"))?;
    Ok(())
}

impl VisionState {
    pub fn load() -> Self {
        let path = state_path();
        let context = load_context(&path);
        Self {
            inner: Mutex::new(context),
            path,
        }
    }

    pub fn snapshot(&self) -> Result<VisionContextSnapshot, String> {
        Ok(self.inner.lock().map_err(|error| error.to_string())?.clone())
    }

    pub fn save(&self, input: VisionContextInput) -> Result<VisionContextSnapshot, String> {
        let mut inner = self.inner.lock().map_err(|error| error.to_string())?;
        let next = normalize(input, inner.version.saturating_add(1))?;
        persist(&self.path, &next)?;
        *inner = next.clone();
        Ok(next)
    }
}

pub fn vision_get(state: tauri::State<'_, VisionState>) -> Result<VisionContextSnapshot, String> {
    state.snapshot()
}

pub fn vision_save(
    input: VisionContextInput,
    state: tauri::State<'_, VisionState>,
) -> Result<VisionContextSnapshot, String> {
    state.save(input)
}
