//! Project detection module
//! Auto-detect project type and suggest commands

use std::path::Path;

#[derive(Debug, Clone)]
pub struct DetectedProject {
    pub name: String,
    pub project_type: String,
    pub suggested_commands: Vec<String>,
}

/// Detect project type from folder path
pub fn detect_project(path: &str) -> DetectedProject {
    let path = Path::new(path);
    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("Unknown")
        .to_string();

    // Check for Python project
    if path.join("requirements.txt").exists() || path.join("setup.py").exists() {
        let has_venv = path.join(".venv").exists() || path.join("venv").exists();
        let venv_name = if path.join(".venv").exists() { ".venv" } else { "venv" };
        
        let mut commands = Vec::new();
        if has_venv {
            commands.push(format!("source {}/Scripts/activate", venv_name));
        }
        
        // Try to find main entry point
        if path.join("main.py").exists() {
            commands.push("python main.py".to_string());
        } else if path.join("app.py").exists() {
            commands.push("python app.py".to_string());
        } else if path.join("bot.py").exists() {
            commands.push("python bot.py".to_string());
        } else if path.join("run.py").exists() {
            commands.push("python run.py".to_string());
        } else {
            commands.push("python main.py".to_string());
        }

        return DetectedProject {
            name,
            project_type: "Python".to_string(),
            suggested_commands: commands,
        };
    }

    // Check for Node.js project
    if path.join("package.json").exists() {
        let mut commands = vec!["npm install".to_string()];
        
        // Read package.json to detect scripts
        if let Ok(content) = std::fs::read_to_string(path.join("package.json")) {
            if content.contains("\"dev\"") {
                commands.push("npm run dev".to_string());
            } else if content.contains("\"start\"") {
                commands.push("npm start".to_string());
            } else if content.contains("\"serve\"") {
                commands.push("npm run serve".to_string());
            }
        }

        return DetectedProject {
            name,
            project_type: "Node.js".to_string(),
            suggested_commands: commands,
        };
    }

    // Check for Rust project
    if path.join("Cargo.toml").exists() {
        return DetectedProject {
            name,
            project_type: "Rust".to_string(),
            suggested_commands: vec!["cargo run".to_string()],
        };
    }

    // Check for Go project
    if path.join("go.mod").exists() {
        return DetectedProject {
            name,
            project_type: "Go".to_string(),
            suggested_commands: vec!["go run .".to_string()],
        };
    }

    // Check for Docker project
    if path.join("docker-compose.yml").exists() || path.join("docker-compose.yaml").exists() {
        return DetectedProject {
            name,
            project_type: "Docker".to_string(),
            suggested_commands: vec!["docker-compose up".to_string()],
        };
    }

    // Default - unknown project
    DetectedProject {
        name,
        project_type: "Unknown".to_string(),
        suggested_commands: vec![],
    }
}
