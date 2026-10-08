use serde::{Deserialize, Serialize};
use std::collections::HashMap;
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
    #[serde(default)]
    pub env_vars: HashMap<String, String>,
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
            env_vars: HashMap::new(),
        }
    }
}

/// Check values before saving or launching, without exposing their contents in errors.
pub fn validate_env_vars(env_vars: &HashMap<String, String>) -> Result<(), String> {
    for (key, value) in env_vars {
        if key.is_empty() || key.contains('=') || key.contains('\0') {
            return Err("Environment variable names cannot be empty or contain '=' or NUL".into());
        }
        if value.contains('\0') {
            return Err("Environment variable values cannot contain NUL".into());
        }
    }

    // Command uses the host's key comparison, including Windows case-insensitivity.
    // Configure only: this never starts a child or changes the current environment.
    let mut environment = std::process::Command::new("");
    environment.envs(env_vars);
    if environment.get_envs().count() != env_vars.len() {
        return Err("Environment variable names must be unique (case-insensitive on Windows)".into());
    }
    Ok(())
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

// Tests always use test-owned storage, including calls through the real IPC handler.
// A thread-local TempDir avoids environment overrides and cleans up when the test exits.
#[cfg(test)]
thread_local! {
    static TEST_CONFIG_DIR: tempfile::TempDir = tempfile::tempdir().unwrap();
}

/// Get config file path
pub fn get_config_path() -> std::path::PathBuf {
    #[cfg(not(test))]
    let config_dir = dirs::config_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("devboot");
    #[cfg(test)]
    let config_dir = TEST_CONFIG_DIR.with(|dir| dir.path().to_path_buf());
    
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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn saved_config_roundtrips_every_option_combination() {
        for auto_start in [false, true] {
            for restart_on_crash in [false, true] {
                let mut project = Project::new(
                    "Synthetic fixture".into(),
                    "C:/synthetic/project/".into(),
                    vec!["echo fixture".into()],
                );
                project.auto_start = auto_start;
                project.restart_on_crash = restart_on_crash;
                project.enabled = false;
                project
                    .env_vars
                    .insert("FIXTURE".into(), "preserved".into());
                let mut config = AppConfig::default();
                config.settings.auto_start_with_windows = false;
                config.projects.push(project);
                let expected = serde_json::to_value(&config).unwrap();
                save_config(&config).unwrap();
                let saved: serde_json::Value =
                    serde_json::from_str(&std::fs::read_to_string(get_config_path()).unwrap())
                        .unwrap();
                assert_eq!(saved, expected);
                assert_eq!(serde_json::to_value(load_config()).unwrap(), expected);
            }
        }
    }

    #[test]
    fn project_constructor_and_stored_schema_keep_existing_defaults() {
        let project = Project::new("Fixture".into(), "C:/synthetic/".into(), vec![]);
        assert!(project.auto_start);
        assert!(project.restart_on_crash);
        assert!(project.enabled);
        assert!(project.env_vars.is_empty());

        let existing = json!({
            "id": "existing-id",
            "name": "Existing fixture",
            "path": "C:/synthetic/",
            "commands": ["echo fixture"],
            "auto_start": false,
            "restart_on_crash": true,
            "enabled": false,
            "env_vars": { "FIXTURE": "preserved" }
        });
        let decoded: Project = serde_json::from_value(existing.clone()).unwrap();
        assert_eq!(serde_json::to_value(decoded).unwrap(), existing);
        for field in ["auto_start", "restart_on_crash", "enabled"] {
            let mut incomplete = existing.clone();
            incomplete.as_object_mut().unwrap().remove(field);
            assert!(serde_json::from_value::<Project>(incomplete).is_err());
        }
        let mut without_env = existing;
        without_env.as_object_mut().unwrap().remove("env_vars");
        assert!(serde_json::from_value::<Project>(without_env)
            .unwrap()
            .env_vars
            .is_empty());
    }
}
