use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Project configuration for a single project
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Project {
    pub id: String,
    pub name: String,
    pub path: String,
    pub commands: Vec<String>,
    pub auto_start: bool,
    pub restart_on_crash: bool,
    pub enabled: bool,
}

impl Project {
    pub fn new(name: String, path: String, commands: Vec<String>) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            name,
            path,
            commands,
            auto_start: true,
            restart_on_crash: true,
            enabled: true,
        }
    }
}

/// Global app settings
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Settings {
    pub auto_start_with_windows: bool,
    pub theme: String,
    pub minimize_to_tray: bool,
    pub show_notifications: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            auto_start_with_windows: true,
            theme: "dark".to_string(),
            minimize_to_tray: true,
            show_notifications: true,
        }
    }
}

/// Main configuration structure
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub version: String,
    pub settings: Settings,
    pub projects: Vec<Project>,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            version: "1.0".to_string(),
            settings: Settings::default(),
            projects: Vec::new(),
        }
    }
}

/// Get config file path
pub fn get_config_path() -> std::path::PathBuf {
    let config_dir = dirs::config_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("devboot");
    
    std::fs::create_dir_all(&config_dir).ok();
    config_dir.join("config.json")
}

/// Load configuration from file
pub fn load_config() -> AppConfig {
    let path = get_config_path();
    
    if path.exists() {
        match std::fs::read_to_string(&path) {
            Ok(content) => {
                serde_json::from_str(&content).unwrap_or_default()
            }
            Err(_) => AppConfig::default(),
        }
    } else {
        let config = AppConfig::default();
        save_config(&config).ok();
        config
    }
}

/// Save configuration to file
pub fn save_config(config: &AppConfig) -> Result<(), String> {
    let path = get_config_path();
    let content = serde_json::to_string_pretty(config)
        .map_err(|e| e.to_string())?;
    
    std::fs::write(path, content)
        .map_err(|e| e.to_string())
}
