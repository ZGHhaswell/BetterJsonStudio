mod codex;
mod detection;

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
use std::sync::Arc;
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;
use tokio::sync::{Mutex, Notify};

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AgentKind {
    Codex,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CliSource {
    Configured,
    Path,
    CommonLocation,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AgentErrorCode {
    CliNotFound,
    InvalidCliPath,
    CliVersionFailed,
    InputTooLarge,
    SpawnFailed,
    AuthenticationFailed,
    NetworkFailed,
    QuotaOrRateLimited,
    ModelFailed,
    TimedOut,
    Cancelled,
    InvalidAgentOutput,
    UnknownCliError,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCommandError {
    pub code: AgentErrorCode,
    pub message: Option<String>,
}

impl AgentCommandError {
    pub(crate) fn new(code: AgentErrorCode) -> Self {
        Self {
            code,
            message: None,
        }
    }

    pub(crate) fn with_message(code: AgentErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: Some(message.into()),
        }
    }
}

const MAX_PENDING_CANCELLATIONS: usize = 256;

#[derive(Default)]
struct AgentTasks {
    active: HashMap<String, Arc<Notify>>,
    cancelled_before_registration: VecDeque<String>,
}

#[derive(Default)]
pub struct AgentTaskState {
    tasks: Mutex<AgentTasks>,
}

impl AgentTaskState {
    async fn register(&self, request_id: &str) -> Result<Arc<Notify>, AgentCommandError> {
        let mut tasks = self.tasks.lock().await;
        if let Some(index) = tasks
            .cancelled_before_registration
            .iter()
            .position(|cancelled_id| cancelled_id == request_id)
        {
            tasks.cancelled_before_registration.remove(index);
            return Err(AgentCommandError::new(AgentErrorCode::Cancelled));
        }
        if tasks.active.contains_key(request_id) {
            return Err(AgentCommandError::with_message(
                AgentErrorCode::UnknownCliError,
                "Duplicate repair request",
            ));
        }
        let notification = Arc::new(Notify::new());
        tasks
            .active
            .insert(request_id.to_string(), notification.clone());
        Ok(notification)
    }

    async fn remove(&self, request_id: &str) {
        self.tasks.lock().await.active.remove(request_id);
    }

    async fn cancel(&self, request_id: &str) -> bool {
        let mut tasks = self.tasks.lock().await;
        if let Some(notification) = tasks.active.get(request_id) {
            notification.notify_one();
            return true;
        }

        if !tasks
            .cancelled_before_registration
            .iter()
            .any(|cancelled_id| cancelled_id == request_id)
        {
            tasks
                .cancelled_before_registration
                .push_back(request_id.to_string());
        }
        while tasks.cancelled_before_registration.len() > MAX_PENDING_CANCELLATIONS {
            tasks.cancelled_before_registration.pop_front();
        }
        true
    }

    pub async fn cancel_all(&self) {
        let tasks = self.tasks.lock().await;
        for notification in tasks.active.values() {
            notification.notify_one();
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCliStatus {
    pub available: bool,
    pub path: Option<String>,
    pub version: Option<String>,
    pub source: Option<CliSource>,
    pub error: Option<AgentCommandError>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRepairResponse {
    pub repaired_json: String,
}

#[tauri::command]
pub async fn detect_agent_cli(
    _app: AppHandle,
    agent: AgentKind,
    configured_path: Option<String>,
) -> Result<AgentCliStatus, AgentCommandError> {
    match agent {
        AgentKind::Codex => detect_codex(configured_path.as_deref()).await,
    }
}

async fn detect_codex(configured_path: Option<&str>) -> Result<AgentCliStatus, AgentCommandError> {
    let resolved = match detection::resolve_installed_codex(configured_path) {
        Ok(resolved) => resolved,
        Err(error) => {
            return Ok(AgentCliStatus {
                available: false,
                path: None,
                version: None,
                source: None,
                error: Some(error),
            });
        }
    };

    match detection::probe_codex_version(&resolved.path).await {
        Ok(version) => Ok(AgentCliStatus {
            available: true,
            path: Some(resolved.path.to_string_lossy().into_owned()),
            version: Some(version),
            source: Some(resolved.source),
            error: None,
        }),
        Err(error) => Ok(AgentCliStatus {
            available: false,
            path: Some(resolved.path.to_string_lossy().into_owned()),
            version: None,
            source: Some(resolved.source),
            error: Some(error),
        }),
    }
}

#[tauri::command]
pub fn select_agent_cli(
    app: AppHandle,
    agent: AgentKind,
) -> Result<Option<String>, AgentCommandError> {
    match agent {
        AgentKind::Codex => Ok(app
            .dialog()
            .file()
            .blocking_pick_file()
            .map(|path| path.to_string())),
    }
}

#[tauri::command]
pub async fn repair_json_with_agent(
    state: tauri::State<'_, AgentTaskState>,
    agent: AgentKind,
    request_id: String,
    configured_path: Option<String>,
    content: String,
) -> Result<AgentRepairResponse, AgentCommandError> {
    let cancellation = state.register(&request_id).await?;
    let result = match agent {
        AgentKind::Codex => {
            codex::repair_json(configured_path.as_deref(), &content, cancellation).await
        }
    };
    state.remove(&request_id).await;
    result.map(|repaired_json| AgentRepairResponse { repaired_json })
}

#[tauri::command]
pub async fn cancel_agent_task(
    state: tauri::State<'_, AgentTaskState>,
    request_id: String,
) -> Result<bool, AgentCommandError> {
    Ok(state.cancel(&request_id).await)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn cancellation_before_registration_prevents_task_start() {
        let state = AgentTaskState::default();

        assert!(state.cancel("request-1").await);
        let error = state.register("request-1").await.unwrap_err();

        assert_eq!(error.code, AgentErrorCode::Cancelled);
    }
}
