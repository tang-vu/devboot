// DevBoot - GitBash Management App
// Main library entry point

mod commands;
mod config;
mod process_manager;
mod startup;

use commands::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .manage(AppState::new())
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
            commands::stop_all_projects,
            // Startup commands
            commands::enable_auto_start,
            commands::disable_auto_start,
            commands::is_auto_start_enabled,
        ])
        .run(tauri::generate_context!())
        .expect("error while running DevBoot");
}
