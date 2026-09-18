use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};

const MAX_PROJECT_PATH_BYTES: usize = 8_192;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSessionSnapshot {
    pub root: String,
    pub name: String,
    pub package_manager: Option<String>,
    pub framework: Option<String>,
    pub dev_script: Option<String>,
    pub dev_command: Option<String>,
    pub scripts: Vec<String>,
    pub version: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct PersistedProject {
    root: String,
}

#[derive(Clone)]
pub struct ProjectState {
    inner: Arc<RwLock<ProjectSessionSnapshot>>,
    path: Arc<PathBuf>,
}

fn state_path() -> PathBuf {
    if let Ok(value) = std::env::var("NIA_STATE_DIR") {
        if !value.trim().is_empty() {
            return PathBuf::from(value).join("project.json");
        }
    }

    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_else(|_| ".".to_string());
    PathBuf::from(home).join(".nia").join("project.json")
}

fn default_project_root() -> Result<PathBuf, String> {
    let root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .ok_or_else(|| "could not resolve the default project root".to_string())?;
    root.canonicalize()
        .map_err(|error| format!("failed to resolve default project root: {error}"))
}

fn package_json(root: &Path) -> Result<Option<Value>, String> {
    let path = root.join("package.json");
    if !path.is_file() {
        return Ok(None);
    }

    let raw = fs::read_to_string(&path)
        .map_err(|error| format!("failed to read {}: {error}", path.display()))?;
    let value = serde_json::from_str::<Value>(&raw)
        .map_err(|error| format!("invalid {}: {error}", path.display()))?;
    Ok(Some(value))
}

fn dependency_names(package: &Value) -> BTreeSet<String> {
    let mut names = BTreeSet::new();
    for key in ["dependencies", "devDependencies", "peerDependencies"] {
        if let Some(object) = package.get(key).and_then(Value::as_object) {
            names.extend(object.keys().cloned());
        }
    }
    names
}

fn detect_framework(package: Option<&Value>, root: &Path) -> Option<String> {
    let Some(package) = package else {
        return root.join("index.html").is_file().then(|| "Static HTML".to_string());
    };

    let dependencies = dependency_names(package);
    let framework = if dependencies.contains("next") {
        "Next.js"
    } else if dependencies.contains("@sveltejs/kit") {
        "SvelteKit"
    } else if dependencies.contains("nuxt") {
        "Nuxt"
    } else if dependencies.contains("astro") {
        "Astro"
    } else if dependencies.contains("@remix-run/react") {
        "Remix"
    } else if dependencies.contains("vite") {
        "Vite"
    } else if dependencies.contains("react-scripts") {
        "Create React App"
    } else if dependencies.contains("react") {
        "React"
    } else {
        "Node web app"
    };
    Some(framework.to_string())
}

fn package_manager_from_field(package: &Value) -> Option<String> {
    package
        .get("packageManager")
        .and_then(Value::as_str)
        .and_then(|value| value.split('@').next())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn detect_package_manager(root: &Path, package: Option<&Value>) -> Option<String> {
    if root.join("pnpm-lock.yaml").is_file() {
        Some("pnpm".to_string())
    } else if root.join("bun.lock").is_file() || root.join("bun.lockb").is_file() {
        Some("bun".to_string())
    } else if root.join("yarn.lock").is_file() {
        Some("yarn".to_string())
    } else if root.join("package-lock.json").is_file() {
        Some("npm".to_string())
    } else {
        package
            .and_then(package_manager_from_field)
            .or_else(|| package.map(|_| "npm".to_string()))
    }
}

fn scripts(package: Option<&Value>) -> Vec<String> {
    let mut scripts = package
        .and_then(|value| value.get("scripts"))
        .and_then(Value::as_object)
        .map(|object| object.keys().cloned().collect::<Vec<_>>())
        .unwrap_or_default();
    scripts.sort();
    scripts
}

fn preferred_dev_script(available: &[String]) -> Option<String> {
    ["dev", "start", "serve"]
        .into_iter()
        .find(|candidate| available.iter().any(|script| script == candidate))
        .map(str::to_string)
}

fn dev_command(package_manager: Option<&str>, script: Option<&str>) -> Option<String> {
    let manager = package_manager?;
    let script = script?;
    Some(match manager {
        "pnpm" => format!("pnpm {script}"),
        "yarn" => format!("yarn {script}"),
        "bun" => format!("bun run {script}"),
        _ => format!("npm run {script}"),
    })
}

fn probe_project(root: &Path, version: u64) -> Result<ProjectSessionSnapshot, String> {
    let root = root
        .canonicalize()
        .map_err(|error| format!("failed to resolve project folder: {error}"))?;
    if !root.is_dir() {
        return Err("project path is not a directory".to_string());
    }

    let package = package_json(&root)?;
    if package.is_none() && !root.join("index.html").is_file() {
        return Err("folder does not look like a web project, expected package.json or index.html".to_string());
    }

    let available_scripts = scripts(package.as_ref());
    let dev_script = preferred_dev_script(&available_scripts);
    let package_manager = detect_package_manager(&root, package.as_ref());
    let dev_command = dev_command(package_manager.as_deref(), dev_script.as_deref());
    let name = package
        .as_ref()
        .and_then(|value| value.get("name"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .or_else(|| root.file_name().and_then(|value| value.to_str()).map(str::to_string))
        .unwrap_or_else(|| "project".to_string());

    Ok(ProjectSessionSnapshot {
        root: root.to_string_lossy().to_string(),
        name,
        package_manager,
        framework: detect_framework(package.as_ref(), &root),
        dev_script,
        dev_command,
        scripts: available_scripts,
        version,
    })
}

fn persist(path: &Path, snapshot: &ProjectSessionSnapshot) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("failed to create project state directory: {error}"))?;
    }
    let body = serde_json::to_string_pretty(&PersistedProject {
        root: snapshot.root.clone(),
    })
    .map_err(|error| format!("failed to serialize project state: {error}"))?;
    let temp = path.with_extension("json.tmp");
    fs::write(&temp, body)
        .map_err(|error| format!("failed to write project state: {error}"))?;
    fs::rename(&temp, path)
        .map_err(|error| format!("failed to commit project state: {error}"))?;
    Ok(())
}

impl ProjectState {
    pub fn load() -> Self {
        let path = state_path();
        let persisted_root = fs::read_to_string(&path)
            .ok()
            .and_then(|raw| serde_json::from_str::<PersistedProject>(&raw).ok())
            .map(|saved| PathBuf::from(saved.root));

        let snapshot = persisted_root
            .as_deref()
            .and_then(|root| probe_project(root, 1).ok())
            .or_else(|| default_project_root().ok().and_then(|root| probe_project(&root, 1).ok()))
            .unwrap_or_else(|| ProjectSessionSnapshot {
                root: default_project_root()
                    .unwrap_or_else(|_| PathBuf::from("."))
                    .to_string_lossy()
                    .to_string(),
                name: "project".to_string(),
                package_manager: None,
                framework: None,
                dev_script: None,
                dev_command: None,
                scripts: Vec::new(),
                version: 1,
            });

        Self {
            inner: Arc::new(RwLock::new(snapshot)),
            path: Arc::new(path),
        }
    }

    pub fn snapshot(&self) -> Result<ProjectSessionSnapshot, String> {
        Ok(self.inner.read().map_err(|error| error.to_string())?.clone())
    }

    pub fn root(&self) -> Result<PathBuf, String> {
        Ok(PathBuf::from(self.snapshot()?.root))
    }

    pub fn open(&self, root: String) -> Result<ProjectSessionSnapshot, String> {
        let root = root.trim();
        if root.is_empty() {
            return Err("project path is empty".to_string());
        }
        if root.len() > MAX_PROJECT_PATH_BYTES {
            return Err("project path is too long".to_string());
        }

        let next_version = self
            .inner
            .read()
            .map_err(|error| error.to_string())?
            .version
            .saturating_add(1);
        let next = probe_project(Path::new(root), next_version)?;
        persist(&self.path, &next)?;
        *self.inner.write().map_err(|error| error.to_string())? = next.clone();
        Ok(next)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prefers_dev_script_then_start() {
        assert_eq!(
            preferred_dev_script(&["build".to_string(), "start".to_string(), "dev".to_string()]),
            Some("dev".to_string())
        );
        assert_eq!(
            preferred_dev_script(&["build".to_string(), "start".to_string()]),
            Some("start".to_string())
        );
    }

    #[test]
    fn builds_package_manager_commands() {
        assert_eq!(dev_command(Some("pnpm"), Some("dev")).as_deref(), Some("pnpm dev"));
        assert_eq!(dev_command(Some("yarn"), Some("dev")).as_deref(), Some("yarn dev"));
        assert_eq!(dev_command(Some("bun"), Some("dev")).as_deref(), Some("bun run dev"));
        assert_eq!(dev_command(Some("npm"), Some("dev")).as_deref(), Some("npm run dev"));
    }

    #[test]
    fn detects_common_frameworks_from_dependencies() {
        let next = serde_json::json!({ "dependencies": { "next": "1" } });
        assert_eq!(detect_framework(Some(&next), Path::new(".")).as_deref(), Some("Next.js"));

        let vite = serde_json::json!({ "devDependencies": { "vite": "1" } });
        assert_eq!(detect_framework(Some(&vite), Path::new(".")).as_deref(), Some("Vite"));
    }
}
