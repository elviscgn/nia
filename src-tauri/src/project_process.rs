use crate::project_core::{ProjectSessionSnapshot, ProjectState};
use serde::Serialize;
use std::collections::VecDeque;
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::Mutex as AsyncMutex;

const MAX_LOG_LINES: usize = 300;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectProcessSnapshot {
    pub running: bool,
    pub pid: Option<u32>,
    pub url: Option<String>,
    pub command: Option<String>,
    pub logs: Vec<String>,
}

#[derive(Debug)]
struct ProcessMeta {
    running: bool,
    pid: Option<u32>,
    url: Option<String>,
    command: Option<String>,
    logs: VecDeque<String>,
    generation: u64,
}

pub struct ProjectProcessState {
    child: AsyncMutex<Option<Child>>,
    meta: Arc<Mutex<ProcessMeta>>,
}

impl ProjectProcessState {
    pub fn new() -> Self {
        Self {
            child: AsyncMutex::new(None),
            meta: Arc::new(Mutex::new(ProcessMeta {
                running: false,
                pid: None,
                url: None,
                command: None,
                logs: VecDeque::new(),
                generation: 0,
            })),
        }
    }

    pub async fn start(&self, project_state: &ProjectState) -> Result<ProjectProcessSnapshot, String> {
        self.stop().await?;

        let project = project_state.snapshot()?;
        let (program, args) = process_command(&project)?;
        let command_label = std::iter::once(program.as_str())
            .chain(args.iter().map(String::as_str))
            .collect::<Vec<_>>()
            .join(" ");

        let mut command = Command::new(&program);
        command
            .args(&args)
            .current_dir(&project.root)
            .env("BROWSER", "none")
            .env("NO_COLOR", "1")
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);

        let mut child = command
            .spawn()
            .map_err(|error| format!("failed to start {command_label}: {error}"))?;
        let pid = child.id();
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();

        let generation = {
            let mut meta = self.meta.lock().map_err(|error| error.to_string())?;
            meta.generation = meta.generation.saturating_add(1);
            meta.running = true;
            meta.pid = pid;
            meta.url = None;
            meta.command = Some(command_label.clone());
            meta.logs.clear();
            meta.logs.push_back(format!("started {command_label}"));
            meta.generation
        };

        if let Some(stdout) = stdout {
            spawn_log_reader(stdout, "out", Arc::clone(&self.meta), generation);
        }
        if let Some(stderr) = stderr {
            spawn_log_reader(stderr, "err", Arc::clone(&self.meta), generation);
        }

        *self.child.lock().await = Some(child);
        self.snapshot().await
    }

    pub async fn stop(&self) -> Result<ProjectProcessSnapshot, String> {
        let mut child_slot = self.child.lock().await;
        if let Some(mut child) = child_slot.take() {
            let _ = child.kill().await;
            let _ = child.wait().await;
        }
        drop(child_slot);

        let mut meta = self.meta.lock().map_err(|error| error.to_string())?;
        if meta.running {
            meta.logs.push_back("stopped dev server".to_string());
            trim_logs(&mut meta.logs);
        }
        meta.running = false;
        meta.pid = None;
        meta.url = None;
        meta.generation = meta.generation.saturating_add(1);
        Ok(snapshot_from_meta(&meta))
    }

    pub async fn snapshot(&self) -> Result<ProjectProcessSnapshot, String> {
        let exit = {
            let mut child_slot = self.child.lock().await;
            match child_slot.as_mut() {
                Some(child) => child
                    .try_wait()
                    .map_err(|error| format!("failed to inspect dev server: {error}"))?,
                None => None,
            }
        };

        if let Some(status) = exit {
            *self.child.lock().await = None;
            let mut meta = self.meta.lock().map_err(|error| error.to_string())?;
            meta.running = false;
            meta.pid = None;
            meta.logs.push_back(format!("dev server exited with {status}"));
            trim_logs(&mut meta.logs);
            return Ok(snapshot_from_meta(&meta));
        }

        let meta = self.meta.lock().map_err(|error| error.to_string())?;
        Ok(snapshot_from_meta(&meta))
    }
}

fn process_command(project: &ProjectSessionSnapshot) -> Result<(String, Vec<String>), String> {
    let manager = project
        .package_manager
        .as_deref()
        .ok_or_else(|| "project has no supported package manager".to_string())?;
    let script = project
        .dev_script
        .as_deref()
        .ok_or_else(|| "project has no dev, start, or serve script".to_string())?;

    let (program, args) = match manager {
        "pnpm" => ("pnpm", vec!["run".to_string(), script.to_string()]),
        "npm" => ("npm", vec!["run".to_string(), script.to_string()]),
        "yarn" => ("yarn", vec![script.to_string()]),
        "bun" => ("bun", vec!["run".to_string(), script.to_string()]),
        other => return Err(format!("unsupported package manager: {other}")),
    };

    Ok((program.to_string(), args))
}

fn snapshot_from_meta(meta: &ProcessMeta) -> ProjectProcessSnapshot {
    ProjectProcessSnapshot {
        running: meta.running,
        pid: meta.pid,
        url: meta.url.clone(),
        command: meta.command.clone(),
        logs: meta.logs.iter().cloned().collect(),
    }
}

fn trim_logs(logs: &mut VecDeque<String>) {
    while logs.len() > MAX_LOG_LINES {
        logs.pop_front();
    }
}

fn record_log(meta: &Arc<Mutex<ProcessMeta>>, generation: u64, source: &str, line: String) {
    let Ok(mut meta) = meta.lock() else {
        return;
    };
    if meta.generation != generation {
        return;
    }

    let clean = strip_ansi(&line);
    if meta.url.is_none() {
        meta.url = local_url_from_line(&clean);
    }
    if !clean.trim().is_empty() {
        meta.logs.push_back(format!("[{source}] {}", clean.trim_end()));
        trim_logs(&mut meta.logs);
    }
}

fn spawn_log_reader<R>(
    reader: R,
    source: &'static str,
    meta: Arc<Mutex<ProcessMeta>>,
    generation: u64,
) where
    R: tokio::io::AsyncRead + Unpin + Send + 'static,
{
    tokio::spawn(async move {
        let mut lines = BufReader::new(reader).lines();
        loop {
            match lines.next_line().await {
                Ok(Some(line)) => record_log(&meta, generation, source, line),
                Ok(None) => break,
                Err(error) => {
                    record_log(&meta, generation, source, format!("log read failed: {error}"));
                    break;
                }
            }
        }
    });
}

fn strip_ansi(input: &str) -> String {
    let mut output = String::with_capacity(input.len());
    let mut chars = input.chars().peekable();

    while let Some(character) = chars.next() {
        if character == '\u{1b}' && chars.peek() == Some(&'[') {
            let _ = chars.next();
            for next in chars.by_ref() {
                if next.is_ascii_alphabetic() {
                    break;
                }
            }
            continue;
        }
        output.push(character);
    }
    output
}

fn local_url_from_line(line: &str) -> Option<String> {
    for raw in line.split_whitespace() {
        let token = raw.trim_matches(|character: char| {
            matches!(character, '(' | ')' | '[' | ']' | '<' | '>' | ',' | ';' | '"' | '\'')
        });
        let normalized = if let Some(rest) = token.strip_prefix("http://0.0.0.0") {
            format!("http://127.0.0.1{rest}")
        } else if let Some(rest) = token.strip_prefix("https://0.0.0.0") {
            format!("https://127.0.0.1{rest}")
        } else {
            token.to_string()
        };

        if normalized.starts_with("http://127.0.0.1")
            || normalized.starts_with("https://127.0.0.1")
            || normalized.starts_with("http://localhost")
            || normalized.starts_with("https://localhost")
            || normalized.starts_with("http://[::1]")
            || normalized.starts_with("https://[::1]")
        {
            return Some(normalized.trim_end_matches('.').to_string());
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn project(manager: &str, script: &str) -> ProjectSessionSnapshot {
        ProjectSessionSnapshot {
            root: "/tmp/project".to_string(),
            name: "project".to_string(),
            package_manager: Some(manager.to_string()),
            framework: Some("Vite".to_string()),
            dev_script: Some(script.to_string()),
            dev_command: None,
            scripts: vec![script.to_string()],
            version: 1,
        }
    }

    #[test]
    fn builds_safe_package_manager_command() {
        assert_eq!(
            process_command(&project("pnpm", "dev")).unwrap(),
            ("pnpm".to_string(), vec!["run".to_string(), "dev".to_string()])
        );
        assert!(process_command(&project("custom", "dev")).is_err());
    }

    #[test]
    fn extracts_local_dev_server_urls() {
        assert_eq!(
            local_url_from_line("Local: http://localhost:5173/").as_deref(),
            Some("http://localhost:5173/")
        );
        assert_eq!(
            local_url_from_line("ready on http://0.0.0.0:3000").as_deref(),
            Some("http://127.0.0.1:3000")
        );
        assert_eq!(local_url_from_line("https://example.com").as_deref(), None);
    }

    #[test]
    fn strips_basic_ansi_sequences() {
        assert_eq!(strip_ansi("\u{1b}[32mhttp://localhost:3000\u{1b}[0m"), "http://localhost:3000");
    }
}
