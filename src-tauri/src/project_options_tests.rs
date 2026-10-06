//! Exercise the real command deserializer and persistence using a mock Tauri runtime.
//! No application setup, project process, startup setting, or real config is used.

use crate::commands::AppState;
use crate::config::{self, AppConfig};
use crate::process_manager::ProcessManager;
use serde_json::{json, Value};
use std::sync::Mutex;
use tauri::test::{get_ipc_response, mock_builder, mock_context, noop_assets, MockRuntime};

fn invoke(window: &tauri::WebviewWindow<MockRuntime>, command: &str, body: Value) -> Value {
    get_ipc_response(
        window,
        tauri::webview::InvokeRequest {
            cmd: command.into(),
            callback: tauri::ipc::CallbackFn(0),
            error: tauri::ipc::CallbackFn(1),
            url: if cfg!(windows) {
                "http://tauri.localhost"
            } else {
                "tauri://localhost"
            }
            .parse()
            .unwrap(),
            body: tauri::ipc::InvokeBody::Json(body),
            headers: Default::default(),
            invoke_key: tauri::test::INVOKE_KEY.to_string(),
        },
    )
    .expect("synthetic IPC request succeeds")
    .deserialize()
    .unwrap()
}

#[test]
fn project_options_survive_ipc_save_and_reload() {
    let app = mock_builder()
        .manage(AppState {
            config: Mutex::new(AppConfig::default()),
            process_manager: ProcessManager::new(),
        })
        .invoke_handler(tauri::generate_handler![
            crate::commands::add_project,
            crate::commands::update_project,
            crate::commands::get_projects,
        ])
        .build(mock_context(noop_assets()))
        .unwrap();
    let window = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();

    // Omitted IPC arguments preserve legacy defaults independently of each other.
    for auto_start in [None, Some(false), Some(true)] {
        for restart_on_crash in [None, Some(false), Some(true)] {
            let mut args = json!({
                "name": "Synthetic fixture",
                "path": "C:/synthetic/project/",
                "commands": ["echo fixture"],
            });
            if let Some(value) = auto_start {
                args["autoStart"] = json!(value);
            }
            if let Some(value) = restart_on_crash {
                args["restartOnCrash"] = json!(value);
            }
            let mut project = invoke(&window, "add_project", args);
            assert_eq!(project["auto_start"], auto_start.unwrap_or(true));
            assert_eq!(
                project["restart_on_crash"],
                restart_on_crash.unwrap_or(true)
            );
            assert_eq!(project["enabled"], true);
            assert_eq!(project["env_vars"], json!({}));

            // Read the actual serialized output, then load via the normal config loader.
            let saved: Value =
                serde_json::from_str(&std::fs::read_to_string(config::get_config_path()).unwrap())
                    .unwrap();
            assert_eq!(
                saved["projects"].as_array().unwrap().last().unwrap(),
                &project
            );
            let loaded = config::load_config();
            assert_eq!(
                serde_json::to_value(loaded.projects.last()).unwrap(),
                project
            );

            // Updates keep explicit false values and every unrelated serialized field.
            project["auto_start"] = json!(!auto_start.unwrap_or(true));
            project["restart_on_crash"] = json!(!restart_on_crash.unwrap_or(true));
            project["enabled"] = json!(false);
            project["env_vars"] = json!({ "FIXTURE": "preserved" });
            invoke(&window, "update_project", json!({ "project": project }));
            let loaded = config::load_config();
            assert_eq!(
                serde_json::to_value(loaded.projects.last()).unwrap(),
                project
            );
        }
    }
    assert_eq!(
        invoke(&window, "get_projects", json!({}))
            .as_array()
            .unwrap()
            .len(),
        9
    );
}
