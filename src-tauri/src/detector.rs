//! Project detection module
//! Auto-detect project type, framework, and suggest commands

use serde::Serialize;
use std::path::Path;

#[derive(Debug, Clone, Serialize)]
pub struct CommandSuggestion {
    pub command: String,
    pub description: String,
    pub is_recommended: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct DetectedProject {
    pub name: String,
    pub project_type: String,
    pub framework: Option<String>,
    pub suggestions: Vec<CommandSuggestion>,
}

impl CommandSuggestion {
    fn new(command: &str, description: &str, is_recommended: bool) -> Self {
        Self {
            command: command.to_string(),
            description: description.to_string(),
            is_recommended,
        }
    }
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
    if let Some(result) = detect_python(path, &name) {
        return result;
    }

    // Check for Node.js project
    if let Some(result) = detect_nodejs(path, &name) {
        return result;
    }

    // Check for Rust project
    if path.join("Cargo.toml").exists() {
        return DetectedProject {
            name,
            project_type: "Rust".to_string(),
            framework: None,
            suggestions: vec![
                CommandSuggestion::new("cargo build", "Build the project", false),
                CommandSuggestion::new("cargo run", "Build and run the project", true),
                CommandSuggestion::new("cargo run --release", "Run in release mode", false),
                CommandSuggestion::new("cargo watch -x run", "Watch mode (requires cargo-watch)", false),
            ],
        };
    }

    // Check for Go project
    if path.join("go.mod").exists() {
        return DetectedProject {
            name,
            project_type: "Go".to_string(),
            framework: None,
            suggestions: vec![
                CommandSuggestion::new("go build", "Build the project", false),
                CommandSuggestion::new("go run .", "Run the project", true),
                CommandSuggestion::new("go run main.go", "Run main.go directly", false),
            ],
        };
    }

    // Check for Java project (Maven)
    if path.join("pom.xml").exists() {
        let is_spring = std::fs::read_to_string(path.join("pom.xml"))
            .map(|c| c.contains("spring-boot"))
            .unwrap_or(false);

        return DetectedProject {
            name,
            project_type: "Java".to_string(),
            framework: if is_spring { Some("Spring Boot".to_string()) } else { Some("Maven".to_string()) },
            suggestions: vec![
                CommandSuggestion::new("mvn clean install", "Build the project", true),
                CommandSuggestion::new("mvn spring-boot:run", "Run Spring Boot app", is_spring),
                CommandSuggestion::new("java -jar target/*.jar", "Run the JAR file", !is_spring),
                CommandSuggestion::new("mvn test", "Run tests", false),
            ],
        };
    }

    // Check for Java project (Gradle)
    if path.join("build.gradle").exists() || path.join("build.gradle.kts").exists() {
        let is_spring = path.join("build.gradle").exists() 
            && std::fs::read_to_string(path.join("build.gradle"))
                .map(|c| c.contains("spring-boot"))
                .unwrap_or(false);

        return DetectedProject {
            name,
            project_type: "Java".to_string(),
            framework: if is_spring { Some("Spring Boot".to_string()) } else { Some("Gradle".to_string()) },
            suggestions: vec![
                CommandSuggestion::new("./gradlew build", "Build the project", true),
                CommandSuggestion::new("./gradlew bootRun", "Run Spring Boot app", is_spring),
                CommandSuggestion::new("./gradlew run", "Run the application", !is_spring),
                CommandSuggestion::new("./gradlew test", "Run tests", false),
            ],
        };
    }

    // Check for PHP project (Composer/Laravel)
    if path.join("composer.json").exists() {
        let is_laravel = path.join("artisan").exists();
        let is_symfony = path.join("symfony.lock").exists() || path.join("bin/console").exists();

        let framework = if is_laravel {
            Some("Laravel".to_string())
        } else if is_symfony {
            Some("Symfony".to_string())
        } else {
            None
        };

        let mut suggestions = vec![
            CommandSuggestion::new("composer install", "Install dependencies", true),
        ];

        if is_laravel {
            suggestions.push(CommandSuggestion::new("php artisan serve", "Start Laravel dev server", true));
            suggestions.push(CommandSuggestion::new("php artisan migrate", "Run database migrations", false));
            suggestions.push(CommandSuggestion::new("php artisan queue:work", "Start queue worker", false));
        } else if is_symfony {
            suggestions.push(CommandSuggestion::new("symfony serve", "Start Symfony dev server", true));
            suggestions.push(CommandSuggestion::new("php bin/console", "Run Symfony console", false));
        } else {
            suggestions.push(CommandSuggestion::new("php -S localhost:8000", "Start PHP built-in server", true));
        }

        return DetectedProject {
            name,
            project_type: "PHP".to_string(),
            framework,
            suggestions,
        };
    }

    // Check for .NET project
    let has_csproj = std::fs::read_dir(path)
        .map(|entries| {
            entries
                .filter_map(|e| e.ok())
                .any(|e| e.path().extension().map(|ext| ext == "csproj").unwrap_or(false))
        })
        .unwrap_or(false);

    if has_csproj || path.join("*.sln").exists() {
        return DetectedProject {
            name,
            project_type: ".NET".to_string(),
            framework: Some("ASP.NET".to_string()),
            suggestions: vec![
                CommandSuggestion::new("dotnet restore", "Restore dependencies", true),
                CommandSuggestion::new("dotnet build", "Build the project", false),
                CommandSuggestion::new("dotnet run", "Run the project", true),
                CommandSuggestion::new("dotnet watch run", "Run with hot reload", false),
                CommandSuggestion::new("dotnet test", "Run tests", false),
            ],
        };
    }

    // Check for Flutter project
    if path.join("pubspec.yaml").exists() {
        let is_flutter = std::fs::read_to_string(path.join("pubspec.yaml"))
            .map(|c| c.contains("flutter:"))
            .unwrap_or(false);

        if is_flutter {
            return DetectedProject {
                name,
                project_type: "Flutter".to_string(),
                framework: Some("Dart".to_string()),
                suggestions: vec![
                    CommandSuggestion::new("flutter pub get", "Get dependencies", true),
                    CommandSuggestion::new("flutter run", "Run on connected device", true),
                    CommandSuggestion::new("flutter run -d windows", "Run on Windows", false),
                    CommandSuggestion::new("flutter run -d chrome", "Run on Chrome (web)", false),
                    CommandSuggestion::new("flutter build apk", "Build Android APK", false),
                ],
            };
        } else {
            // Pure Dart project
            return DetectedProject {
                name,
                project_type: "Dart".to_string(),
                framework: None,
                suggestions: vec![
                    CommandSuggestion::new("dart pub get", "Get dependencies", true),
                    CommandSuggestion::new("dart run", "Run the project", true),
                ],
            };
        }
    }

    // Check for Ruby project
    if path.join("Gemfile").exists() {
        let is_rails = path.join("bin/rails").exists() || path.join("config/routes.rb").exists();

        return DetectedProject {
            name,
            project_type: "Ruby".to_string(),
            framework: if is_rails { Some("Rails".to_string()) } else { None },
            suggestions: vec![
                CommandSuggestion::new("bundle install", "Install dependencies", true),
                CommandSuggestion::new(
                    if is_rails { "rails server" } else { "ruby main.rb" },
                    if is_rails { "Start Rails server" } else { "Run main script" },
                    true,
                ),
                CommandSuggestion::new("rails console", "Start Rails console", is_rails),
            ],
        };
    }

    // Check for Docker project
    if path.join("docker-compose.yml").exists() || path.join("docker-compose.yaml").exists() {
        return DetectedProject {
            name,
            project_type: "Docker".to_string(),
            framework: Some("Compose".to_string()),
            suggestions: vec![
                CommandSuggestion::new("docker-compose up", "Start all services", true),
                CommandSuggestion::new("docker-compose up -d", "Start in background", false),
                CommandSuggestion::new("docker-compose up --build", "Rebuild and start", false),
                CommandSuggestion::new("docker-compose down", "Stop all services", false),
                CommandSuggestion::new("docker-compose logs -f", "Follow logs", false),
            ],
        };
    }

    // Default - unknown project
    DetectedProject {
        name,
        project_type: "Unknown".to_string(),
        framework: None,
        suggestions: vec![],
    }
}

/// Detect Python project type and framework
fn detect_python(path: &Path, name: &str) -> Option<DetectedProject> {
    let has_requirements = path.join("requirements.txt").exists();
    let has_setup = path.join("setup.py").exists();
    let has_pyproject = path.join("pyproject.toml").exists();

    if !has_requirements && !has_setup && !has_pyproject {
        return None;
    }

    // Detect virtual environment
    let has_venv = path.join(".venv").exists() || path.join("venv").exists();
    let venv_name = if path.join(".venv").exists() { ".venv" } else { "venv" };

    // Read requirements to detect framework
    let requirements_content = std::fs::read_to_string(path.join("requirements.txt")).unwrap_or_default();
    let pyproject_content = std::fs::read_to_string(path.join("pyproject.toml")).unwrap_or_default();
    let combined = format!("{}\n{}", requirements_content, pyproject_content).to_lowercase();

    // Detect framework
    let framework = if path.join("manage.py").exists() {
        Some("Django".to_string())
    } else if combined.contains("fastapi") {
        Some("FastAPI".to_string())
    } else if combined.contains("flask") {
        Some("Flask".to_string())
    } else if combined.contains("discord") || combined.contains("nextcord") || combined.contains("disnake") {
        Some("Discord Bot".to_string())
    } else if combined.contains("telegram") || combined.contains("aiogram") || combined.contains("pyrogram") {
        Some("Telegram Bot".to_string())
    } else if combined.contains("streamlit") {
        Some("Streamlit".to_string())
    } else {
        None
    };

    let mut suggestions = Vec::new();

    // Virtual environment activation
    if has_venv {
        suggestions.push(CommandSuggestion::new(
            &format!("source {}/Scripts/activate", venv_name),
            "Activate virtual environment",
            true,
        ));
    }

    // Framework-specific commands
    match framework.as_deref() {
        Some("Django") => {
            suggestions.push(CommandSuggestion::new(
                "python manage.py runserver",
                "Start Django dev server",
                true,
            ));
            suggestions.push(CommandSuggestion::new(
                "python manage.py migrate",
                "Run database migrations",
                false,
            ));
            suggestions.push(CommandSuggestion::new(
                "python manage.py shell",
                "Start Django shell",
                false,
            ));
        }
        Some("FastAPI") => {
            let main_file = find_python_entry(path);
            suggestions.push(CommandSuggestion::new(
                &format!("uvicorn {}:app --reload", main_file.replace(".py", "")),
                "Start FastAPI with hot reload",
                true,
            ));
            suggestions.push(CommandSuggestion::new(
                &format!("python {}", main_file),
                "Run directly",
                false,
            ));
        }
        Some("Flask") => {
            let main_file = find_python_entry(path);
            suggestions.push(CommandSuggestion::new(
                &format!("flask --app {} run --reload", main_file.replace(".py", "")),
                "Start Flask with hot reload",
                true,
            ));
            suggestions.push(CommandSuggestion::new(
                &format!("python {}", main_file),
                "Run directly",
                false,
            ));
        }
        Some("Streamlit") => {
            let main_file = find_python_entry(path);
            suggestions.push(CommandSuggestion::new(
                &format!("streamlit run {}", main_file),
                "Start Streamlit app",
                true,
            ));
        }
        Some("Discord Bot") | Some("Telegram Bot") => {
            let main_file = find_python_entry(path);
            suggestions.push(CommandSuggestion::new(
                &format!("python {}", main_file),
                "Start the bot",
                true,
            ));
        }
        _ => {
            // Generic Python
            let main_file = find_python_entry(path);
            suggestions.push(CommandSuggestion::new(
                &format!("python {}", main_file),
                "Run main script",
                true,
            ));
        }
    }

    // Install dependencies
    if has_requirements {
        suggestions.push(CommandSuggestion::new(
            "pip install -r requirements.txt",
            "Install dependencies",
            false,
        ));
    }

    Some(DetectedProject {
        name: name.to_string(),
        project_type: "Python".to_string(),
        framework,
        suggestions,
    })
}

/// Find Python entry point file
fn find_python_entry(path: &Path) -> String {
    let candidates = ["main.py", "app.py", "bot.py", "run.py", "server.py", "__main__.py"];
    for candidate in candidates {
        if path.join(candidate).exists() {
            return candidate.to_string();
        }
    }
    "main.py".to_string()
}

/// Detect Node.js project type and framework
fn detect_nodejs(path: &Path, name: &str) -> Option<DetectedProject> {
    if !path.join("package.json").exists() {
        return None;
    }

    let package_json = std::fs::read_to_string(path.join("package.json")).unwrap_or_default();

    // Detect package manager
    let has_yarn_lock = path.join("yarn.lock").exists();
    let has_pnpm_lock = path.join("pnpm-lock.yaml").exists();
    let pkg_manager = if has_pnpm_lock {
        "pnpm"
    } else if has_yarn_lock {
        "yarn"
    } else {
        "npm"
    };

    // Detect framework from dependencies
    let framework = if package_json.contains("\"next\"") {
        Some("Next.js".to_string())
    } else if package_json.contains("\"nuxt\"") {
        Some("Nuxt".to_string())
    } else if package_json.contains("\"@remix-run") {
        Some("Remix".to_string())
    } else if package_json.contains("\"react-scripts\"") {
        Some("Create React App".to_string())
    } else if package_json.contains("\"vite\"") && package_json.contains("\"react\"") {
        Some("Vite + React".to_string())
    } else if package_json.contains("\"vite\"") && package_json.contains("\"vue\"") {
        Some("Vite + Vue".to_string())
    } else if package_json.contains("\"vite\"") {
        Some("Vite".to_string())
    } else if package_json.contains("\"vue\"") {
        Some("Vue".to_string())
    } else if package_json.contains("\"@angular/core\"") {
        Some("Angular".to_string())
    } else if package_json.contains("\"svelte\"") || package_json.contains("\"@sveltejs") {
        Some("Svelte".to_string())
    } else if package_json.contains("\"express\"") {
        Some("Express".to_string())
    } else if package_json.contains("\"fastify\"") {
        Some("Fastify".to_string())
    } else if package_json.contains("\"nestjs\"") || package_json.contains("\"@nestjs") {
        Some("NestJS".to_string())
    } else if package_json.contains("\"discord.js\"") || package_json.contains("\"eris\"") {
        Some("Discord Bot".to_string())
    } else if package_json.contains("\"electron\"") {
        Some("Electron".to_string())
    } else if package_json.contains("\"tauri\"") || package_json.contains("\"@tauri-apps") {
        Some("Tauri".to_string())
    } else {
        None
    };

    let mut suggestions = Vec::new();

    // Install command
    let install_cmd = match pkg_manager {
        "pnpm" => "pnpm install",
        "yarn" => "yarn",
        _ => "npm install",
    };
    suggestions.push(CommandSuggestion::new(install_cmd, "Install dependencies", true));

    // Detect available scripts
    let has_dev = package_json.contains("\"dev\"");
    let has_start = package_json.contains("\"start\"");
    let has_serve = package_json.contains("\"serve\"");
    let has_build = package_json.contains("\"build\"");

    // Dev script
    if has_dev {
        suggestions.push(CommandSuggestion::new(
            &format!("{} run dev", pkg_manager),
            "Start development server",
            true,
        ));
    }

    // Start script
    if has_start {
        suggestions.push(CommandSuggestion::new(
            &format!("{} start", if pkg_manager == "npm" { "npm" } else { pkg_manager }),
            "Start the application",
            !has_dev, // Recommended if no dev script
        ));
    }

    // Serve script (Vue CLI)
    if has_serve {
        suggestions.push(CommandSuggestion::new(
            &format!("{} run serve", pkg_manager),
            "Start dev server (Vue CLI)",
            !has_dev && !has_start,
        ));
    }

    // Build script
    if has_build {
        suggestions.push(CommandSuggestion::new(
            &format!("{} run build", pkg_manager),
            "Build for production",
            false,
        ));
    }

    // Framework-specific commands
    if let Some(ref fw) = framework {
        match fw.as_str() {
            "Electron" => {
                suggestions.push(CommandSuggestion::new(
                    &format!("{} run electron:serve", pkg_manager),
                    "Start Electron in dev mode",
                    false,
                ));
            }
            "Tauri" => {
                suggestions.push(CommandSuggestion::new(
                    &format!("{} run tauri dev", pkg_manager),
                    "Start Tauri in dev mode",
                    true,
                ));
            }
            _ => {}
        }
    }

    Some(DetectedProject {
        name: name.to_string(),
        project_type: "Node.js".to_string(),
        framework,
        suggestions,
    })
}
