// DevBoot - GitBash Management App
// Main library entry point

mod commands;
mod config;
mod detector;
mod process_manager;
mod startup;

use commands::AppState;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::new())
        .setup(|app| {
            // Inject app handle into process manager for event emission
            let state = app.state::<AppState>();
            state.process_manager.set_app_handle(app.handle().clone());
            
            // Auto-start projects that have auto_start enabled
            let config = state.config.lock().unwrap();
            let projects_to_start: Vec<_> = config.projects
                .iter()
                .filter(|p| p.auto_start && p.enabled)
                .cloned()
                .collect();
            drop(config);

            for project in projects_to_start {
                let _ = state.process_manager.start_project(
                    &project.id,
                    &project.path,
                    &project.commands,
                    project.restart_on_crash,
                );
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Config commands
            commands::get_config,
            commands::save_config_cmd,
            commands::get_projects,
            commands::add_project,
            commands::update_project,
            commands::delete_project,
            commands::get_settings,
            commands::update_settings,
            // Process commands
            commands::start_project,
            commands::stop_project,
            commands::restart_project,
            commands::get_project_status,
            commands::get_project_logs,
            commands::clear_project_logs,
            commands::send_project_input,
            commands::stop_all_projects,
            // Startup commands
            commands::enable_auto_start,
            commands::disable_auto_start,
            commands::is_auto_start_enabled,
            // Detection commands
            commands::detect_project_from_path,
        ])
        .run(tauri::generate_context!())
        .expect("error while running DevBoot");
}
