mod model_core;
mod project_core;
mod project_process;
mod scratch_agent;
mod scratch_code;
mod scratch_core;
mod vision_core;

mod legacy {
    use super::model_core::{
        model_settings_get as core_model_settings_get,
        model_settings_save as core_model_settings_save,
        model_test_connection as core_model_test_connection,
        ModelConnectionResult,
        ModelSettingsInput,
        ModelSettingsSnapshot,
        ModelState,
    };
    use super::project_core::{ProjectSessionSnapshot, ProjectState};
    use super::project_process::{ProjectProcessSnapshot, ProjectProcessState};
    use super::scratch_agent::{
        scratch_agent_clear_history as core_scratch_agent_clear_history,
        scratch_agent_history as core_scratch_agent_history,
        scratch_agent_run as core_scratch_agent_run,
        ScratchAgentRequest,
        ScratchAgentResponse,
        ScratchAgentState,
        ScratchChatEntry,
    };
    use super::scratch_code::{
        scratch_edit_part as core_scratch_edit_part,
        ScratchPartEdit,
    };
    use super::scratch_core::{
        scratch_get as core_scratch_get,
        scratch_report_selection as core_scratch_report_selection,
        scratch_reset as core_scratch_reset,
        scratch_set_style_px as core_scratch_set_style_px,
        scratch_undo as core_scratch_undo,
        ScratchSelection,
        ScratchSnapshot,
        ScratchState,
        ScratchStylePatchResult,
    };
    use super::vision_core::{
        vision_get as core_vision_get,
        vision_save as core_vision_save,
        VisionContextInput,
        VisionContextSnapshot,
        VisionState,
    };

    use tauri_plugin_dialog::DialogExt;

    include!("main.rs");

    fn activate_project(
        root: String,
        state: &ProjectState,
        style_index: &StyleIndex,
        canvas_state: &CanvasState,
        history: &EditHistory,
    ) -> Result<ProjectSessionSnapshot, String> {
        let snapshot = state.open(root)?;
        style_index.request_refresh();
        *canvas_state.selection.lock().map_err(|error| error.to_string())? = None;
        history.undo.lock().map_err(|error| error.to_string())?.clear();
        Ok(snapshot)
    }

    #[tauri::command]
    fn project_get(
        state: tauri::State<'_, ProjectState>,
    ) -> Result<ProjectSessionSnapshot, String> {
        state.snapshot()
    }

    #[tauri::command]
    async fn project_open(
        root: String,
        state: tauri::State<'_, ProjectState>,
        process_state: tauri::State<'_, ProjectProcessState>,
        style_index: tauri::State<'_, StyleIndex>,
        canvas_state: tauri::State<'_, CanvasState>,
        history: tauri::State<'_, EditHistory>,
    ) -> Result<ProjectSessionSnapshot, String> {
        process_state.stop().await?;
        activate_project(root, &state, &style_index, &canvas_state, &history)
    }

    #[tauri::command]
    async fn project_pick_folder(
        app: tauri::AppHandle,
        state: tauri::State<'_, ProjectState>,
        process_state: tauri::State<'_, ProjectProcessState>,
        style_index: tauri::State<'_, StyleIndex>,
        canvas_state: tauri::State<'_, CanvasState>,
        history: tauri::State<'_, EditHistory>,
    ) -> Result<Option<ProjectSessionSnapshot>, String> {
        let (sender, receiver) = tokio::sync::oneshot::channel();
        app.dialog()
            .file()
            .set_title("Open project")
            .pick_folder(move |folder| {
                let _ = sender.send(folder);
            });

        let selected = receiver
            .await
            .map_err(|_| "project folder picker closed unexpectedly".to_string())?;
        let Some(selected) = selected else {
            return Ok(None);
        };
        let path = selected
            .into_path()
            .map_err(|error| format!("failed to resolve selected project folder: {error}"))?;
        process_state.stop().await?;
        activate_project(
            path.to_string_lossy().to_string(),
            &state,
            &style_index,
            &canvas_state,
            &history,
        )
        .map(Some)
    }

    #[tauri::command]
    async fn project_process_status(
        state: tauri::State<'_, ProjectProcessState>,
    ) -> Result<ProjectProcessSnapshot, String> {
        state.snapshot().await
    }

    #[tauri::command]
    async fn project_process_start(
        state: tauri::State<'_, ProjectProcessState>,
        project_state: tauri::State<'_, ProjectState>,
    ) -> Result<ProjectProcessSnapshot, String> {
        state.start(&project_state).await
    }

    #[tauri::command]
    async fn project_process_stop(
        state: tauri::State<'_, ProjectProcessState>,
    ) -> Result<ProjectProcessSnapshot, String> {
        state.stop().await
    }

    #[tauri::command]
    fn model_settings_get(
        state: tauri::State<'_, ModelState>,
    ) -> Result<ModelSettingsSnapshot, String> {
        core_model_settings_get(state)
    }

    #[tauri::command]
    fn model_settings_save(
        input: ModelSettingsInput,
        state: tauri::State<'_, ModelState>,
    ) -> Result<ModelSettingsSnapshot, String> {
        core_model_settings_save(input, state)
    }

    #[tauri::command]
    async fn model_test_connection(
        state: tauri::State<'_, ModelState>,
    ) -> Result<ModelConnectionResult, String> {
        core_model_test_connection(state).await
    }

    #[tauri::command]
    fn scratch_get(
        state: tauri::State<'_, ScratchState>,
    ) -> Result<ScratchSnapshot, String> {
        core_scratch_get(state)
    }

    #[tauri::command]
    fn scratch_report_selection(
        selection: ScratchSelection,
        state: tauri::State<'_, ScratchState>,
    ) -> Result<(), String> {
        core_scratch_report_selection(selection, state)
    }

    #[tauri::command]
    fn scratch_set_style_px(
        selector: String,
        property: String,
        value_px: f64,
        state: tauri::State<'_, ScratchState>,
    ) -> Result<ScratchStylePatchResult, String> {
        core_scratch_set_style_px(selector, property, value_px, state)
    }

    #[tauri::command]
    fn scratch_undo(
        state: tauri::State<'_, ScratchState>,
    ) -> Result<ScratchSnapshot, String> {
        core_scratch_undo(state)
    }

    #[tauri::command]
    fn scratch_reset(
        state: tauri::State<'_, ScratchState>,
    ) -> Result<ScratchSnapshot, String> {
        core_scratch_reset(state)
    }

    #[tauri::command]
    fn scratch_edit_part(
        edit: ScratchPartEdit,
        state: tauri::State<'_, ScratchState>,
    ) -> Result<ScratchSnapshot, String> {
        core_scratch_edit_part(edit, state)
    }

    #[tauri::command]
    fn scratch_agent_history(
        state: tauri::State<'_, ScratchAgentState>,
    ) -> Result<Vec<ScratchChatEntry>, String> {
        core_scratch_agent_history(state)
    }

    #[tauri::command]
    fn scratch_agent_clear_history(
        state: tauri::State<'_, ScratchAgentState>,
    ) -> Result<Vec<ScratchChatEntry>, String> {
        core_scratch_agent_clear_history(state)
    }

    #[tauri::command]
    async fn scratch_agent_run(
        request: ScratchAgentRequest,
        scratch_state: tauri::State<'_, ScratchState>,
        model_state: tauri::State<'_, ModelState>,
        vision_state: tauri::State<'_, VisionState>,
        agent_state: tauri::State<'_, ScratchAgentState>,
    ) -> Result<ScratchAgentResponse, String> {
        core_scratch_agent_run(
            request,
            scratch_state,
            model_state,
            vision_state,
            agent_state,
        )
        .await
    }

    #[tauri::command]
    fn vision_get(
        state: tauri::State<'_, VisionState>,
    ) -> Result<VisionContextSnapshot, String> {
        core_vision_get(state)
    }

    #[tauri::command]
    fn vision_save(
        input: VisionContextInput,
        state: tauri::State<'_, VisionState>,
    ) -> Result<VisionContextSnapshot, String> {
        core_vision_save(input, state)
    }

    pub fn run_with_scratch_agent() {
        let project_state = ProjectState::load();
        let style_index = StyleIndex::start(project_state.clone());

        tauri::Builder::default()
            .runtime(tauri_runtime_cef::Cef::default())
            .plugin(tauri_plugin_dialog::init())
            .manage(CoreStarted(Instant::now()))
            .manage(CanvasState {
                selection: Mutex::new(None),
            })
            .manage(style_index)
            .manage(project_state)
            .manage(ProjectProcessState::new())
            .manage(EditHistory {
                undo: Mutex::new(Vec::new()),
            })
            .manage(ModelState::load())
            .manage(ScratchState::load())
            .manage(ScratchAgentState::load())
            .manage(VisionState::load())
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
                canvas_style_index_state,
                canvas_set_style_px,
                canvas_replace_class_token,
                canvas_undo_style,
                canvas_cdp_evaluate,
                project_get,
                project_open,
                project_pick_folder,
                project_process_status,
                project_process_start,
                project_process_stop,
                model_settings_get,
                model_settings_save,
                model_test_connection,
                scratch_get,
                scratch_report_selection,
                scratch_set_style_px,
                scratch_undo,
                scratch_reset,
                scratch_edit_part,
                scratch_agent_history,
                scratch_agent_clear_history,
                scratch_agent_run,
                vision_get,
                vision_save
            ])
            .run(tauri::generate_context!())
            .expect("error while running Nia");
    }
}

fn main() {
    legacy::run_with_scratch_agent();
}
