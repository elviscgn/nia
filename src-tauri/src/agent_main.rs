mod model_core;
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

    include!("main.rs");

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
        let style_index = StyleIndex::start();

        tauri::Builder::default()
            .runtime(tauri_runtime_cef::Cef::default())
            .manage(CoreStarted(Instant::now()))
            .manage(CanvasState {
                selection: Mutex::new(None),
            })
            .manage(style_index)
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
