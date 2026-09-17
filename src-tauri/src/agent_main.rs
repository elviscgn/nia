mod model_core;
mod scratch_agent;
mod scratch_code;
mod scratch_core;
mod vision_core;

mod legacy {
    use super::model_core::{
        model_settings_get,
        model_settings_save,
        model_test_connection,
        ModelState,
    };
    use super::scratch_agent::{
        scratch_agent_clear_history,
        scratch_agent_history,
        scratch_agent_run,
        ScratchAgentState,
    };
    use super::scratch_code::scratch_edit_part;
    use super::scratch_core::{
        scratch_get,
        scratch_report_selection,
        scratch_reset,
        scratch_set_style_px,
        scratch_undo,
        ScratchState,
    };
    use super::vision_core::{vision_get, vision_save, VisionState};
    use crate::{
        __cmd__model_settings_get,
        __cmd__model_settings_save,
        __cmd__model_test_connection,
        __cmd__scratch_agent_clear_history,
        __cmd__scratch_agent_history,
        __cmd__scratch_agent_run,
        __cmd__scratch_edit_part,
        __cmd__scratch_get,
        __cmd__scratch_report_selection,
        __cmd__scratch_reset,
        __cmd__scratch_set_style_px,
        __cmd__scratch_undo,
        __cmd__vision_get,
        __cmd__vision_save,
        __tauri_command_name_model_settings_get,
        __tauri_command_name_model_settings_save,
        __tauri_command_name_model_test_connection,
        __tauri_command_name_scratch_agent_clear_history,
        __tauri_command_name_scratch_agent_history,
        __tauri_command_name_scratch_agent_run,
        __tauri_command_name_scratch_edit_part,
        __tauri_command_name_scratch_get,
        __tauri_command_name_scratch_report_selection,
        __tauri_command_name_scratch_reset,
        __tauri_command_name_scratch_set_style_px,
        __tauri_command_name_scratch_undo,
        __tauri_command_name_vision_get,
        __tauri_command_name_vision_save,
    };

    include!("main.rs");

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
