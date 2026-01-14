---
description: How to add support for a new project type detection
---

# Adding Project Type Detection

DevBoot auto-detects project types when users drag & drop folders.

## Location
`src-tauri/src/detector.rs`

## Adding a New Project Type

Add a new detection block in `detect_project()` function:

```rust
// Check for [YOUR LANGUAGE] project
if path.join("your_config_file.ext").exists() {
    return DetectedProject {
        name,
        project_type: "Your Language".to_string(),
        suggested_commands: vec![
            "your_install_command".to_string(),
            "your_run_command".to_string(),
        ],
    };
}
```

## Current Detections

| Project Type | Detection File | Default Commands |
|--------------|----------------|------------------|
| Python | `requirements.txt`, `.venv` | `source .venv/Scripts/activate`, `python main.py` |
| Node.js | `package.json` | `npm install`, `npm run dev` |
| Rust | `Cargo.toml` | `cargo run` |
| Go | `go.mod` | `go run .` |
| Docker | `docker-compose.yml` | `docker-compose up` |

## Entry Point Detection

For Python, we check multiple entry points:
- `main.py`
- `app.py`
- `bot.py`  
- `run.py`

Add similar logic for other project types if needed.

## Testing

1. Create a test folder with the config file
2. Drag into DevBoot → should auto-detect
3. Verify suggested commands are correct
