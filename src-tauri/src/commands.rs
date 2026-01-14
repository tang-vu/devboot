//! Tauri IPC commands for DevBoot
//! These commands are called from the frontend

use crate::config::{self, AppConfig, Project, Settings};
use crate::process_manager::{ProcessManager, ProcessStatus};
use crate::startup;
use std::sync::Mutex;
use tauri::State;

/// Application state
pub struct AppState {
    pub config: Mutex<AppConfig>,
    pub process_manager: ProcessManager,
}

impl AppState {
    pub fn new() -> Self {
        let config = config::load_config();
        Self {
            config: Mutex::new(config),
            process_manager: ProcessManager::new(),
        }
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}

// ============ Config Commands ============

#[tauri::command]
pub fn get_config(state: State<AppState>) -> AppConfig {
    state.config.lock().unwrap().clone()
}

#[tauri::command]
pub fn save_config_cmd(state: State<AppState>, config: AppConfig) -> Result<(), String> {
    let mut current = state.config.lock().unwrap();
    *current = config.clone();
    config::save_config(&config)
}

#[tauri::command]
pub fn get_projects(state: State<AppState>) -> Vec<Project> {
    state.config.lock().unwrap().projects.clone()
}

#[tauri::command]
pub fn add_project(
    state: State<AppState>,
    name: String,
    path: String,
    commands: Vec<String>,
) -> Result<Project, String> {
    let project = Project::new(name, path, commands);
    let mut config = state.config.lock().unwrap();
    config.projects.push(project.clone());
    config::save_config(&config)?;
    Ok(project)
}

#[tauri::command]
pub fn update_project(state: State<AppState>, project: Project) -> Result<(), String> {
    let mut config = state.config.lock().unwrap();
    if let Some(p) = config.projects.iter_mut().find(|p| p.id == project.id) {
        *p = project;
    }
    config::save_config(&config)
}

#[tauri::command]
pub fn delete_project(state: State<AppState>, project_id: String) -> Result<(), String> {
    // Stop the project first if running
    state.process_manager.stop_project(&project_id).ok();
    
    let mut config = state.config.lock().unwrap();
    config.projects.retain(|p| p.id != project_id);
    config::save_config(&config)
}

#[tauri::command]
pub fn get_settings(state: State<AppState>) -> Settings {
    state.config.lock().unwrap().settings.clone()
}

#[tauri::command]
pub fn update_settings(state: State<AppState>, settings: Settings) -> Result<(), String> {
    let mut config = state.config.lock().unwrap();
    config.settings = settings;
    config::save_config(&config)
}

// ============ Process Commands ============

#[tauri::command]
pub fn start_project(state: State<AppState>, project_id: String) -> Result<(), String> {
    let config = state.config.lock().unwrap();
    let project = config
        .projects
        .iter()
        .find(|p| p.id == project_id)
        .ok_or("Project not found")?
        .clone();
    drop(config);

    state.process_manager.start_project(
        &project.id,
        &project.path,
        &project.commands,
        project.restart_on_crash,
    )
}

#[tauri::command]
pub fn stop_project(state: State<AppState>, project_id: String) -> Result<(), String> {
    state.process_manager.stop_project(&project_id)
}

#[tauri::command]
pub fn restart_project(state: State<AppState>, project_id: String) -> Result<(), String> {
    state.process_manager.stop_project(&project_id)?;
    
    // Small delay before restart
    std::thread::sleep(std::time::Duration::from_millis(500));
    
    start_project(state, project_id)
}

#[tauri::command]
pub fn get_project_status(state: State<AppState>, project_id: String) -> String {
    match state.process_manager.get_status(&project_id) {
        ProcessStatus::Stopped => "stopped".to_string(),
        ProcessStatus::Running => "running".to_string(),
        ProcessStatus::Error => "error".to_string(),
        ProcessStatus::Restarting => "restarting".to_string(),
    }
}

#[tauri::command]
pub fn get_project_logs(state: State<AppState>, project_id: String) -> Vec<String> {
    state.process_manager.get_logs(&project_id)
}

#[tauri::command]
pub fn clear_project_logs(state: State<AppState>, project_id: String) {
    state.process_manager.clear_logs(&project_id);
}

#[tauri::command]
pub fn stop_all_projects(state: State<AppState>) {
    state.process_manager.stop_all();
}

// ============ Startup Commands ============

#[tauri::command]
pub fn enable_auto_start() -> Result<(), String> {
    startup::enable_auto_start()
}

#[tauri::command]
pub fn disable_auto_start() -> Result<(), String> {
    startup::disable_auto_start()
}

#[tauri::command]
pub fn is_auto_start_enabled() -> bool {
    startup::is_auto_start_enabled()
}

// ============ Detection Commands ============

use crate::detector::{self, DetectedProject};

#[tauri::command]
pub fn detect_project_from_path(path: String) -> DetectedProject {
    detector::detect_project(&path)
}
