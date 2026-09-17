mod scratch_agent;
mod scratch_core;

mod legacy {
    use super::scratch_agent::scratch_agent_run;
    use super::scratch_core::{
        scratch_get,
        scratch_report_selection,
        scratch_reset,
        scratch_set_style_px,
        scratch_undo,
        ScratchState,
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
            .manage(ScratchState::load())
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
                scratch_get,
                scratch_report_selection,
                scratch_set_style_px,
                scratch_undo,
                scratch_reset,
                scratch_agent_run
            ])
            .run(tauri::generate_context!())
            .expect("error while running Nia");
    }
}

fn main() {
    legacy::run_with_scratch_agent();
}
