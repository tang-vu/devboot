//! Real IPC and temporary config only: these tests never launch a project.
use crate::commands::AppState;
use crate::config::{self, AppConfig};
use crate::process_manager::ProcessManager;
use serde_json::{json, Value};
use std::sync::Mutex;
use tauri::test::{get_ipc_response, mock_builder, mock_context, noop_assets, MockRuntime};

fn invoke(
    window: &tauri::WebviewWindow<MockRuntime>,
    command: &str,
    body: Value,
) -> Result<Value, Value> {
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
    .map(|response| response.deserialize().unwrap())
}

#[test]
fn environment_survives_creation_update_and_reload_and_rejects_invalid_values() {
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
    let args = json!({
        "name": "Synthetic environment", "path": "C:/synthetic/", "commands": [],
        "autoStart": false, "restartOnCrash": false,
        "envVars": { "FIXTURE": "spaces 'quotes' $VARIABLE $(literal) & café\nnext", "EMPTY": "" },
    });
    let mut project = invoke(&window, "add_project", args.clone()).unwrap();
    assert_eq!(project["env_vars"], args["envVars"]);
    assert_eq!(
        serde_json::to_value(&config::load_config().projects[0]).unwrap(),
        project
    );

    let mut legacy = args.clone();
    legacy.as_object_mut().unwrap().remove("envVars");
    assert_eq!(
        invoke(&window, "add_project", legacy).unwrap()["env_vars"],
        json!({})
    );

    let before = invoke(&window, "get_projects", json!({})).unwrap();
    let disk_before = std::fs::read(config::get_config_path()).unwrap();
    let mut invalid = vec![
        json!({ "": "fixture" }),
        json!({ "INVALID=KEY": "fixture" }),
        json!({ "INVALID\0KEY": "fixture" }),
        json!({ "FIXTURE": "invalid\0value" }),
    ];
    if cfg!(windows) {
        invalid.push(json!({ "FIXTURE": "one", "fixture": "two" }));
    }
    for env in invalid {
        let mut invalid_args = args.clone();
        invalid_args["envVars"] = env.clone();
        let error = invoke(&window, "add_project", invalid_args).unwrap_err();
        assert!(error.as_str().unwrap().contains("Environment variable"));
        let mut invalid_project = project.clone();
        invalid_project["env_vars"] = env;
        assert!(invoke(
            &window,
            "update_project",
            json!({ "project": invalid_project })
        )
        .is_err());
        assert_eq!(invoke(&window, "get_projects", json!({})).unwrap(), before);
        assert_eq!(
            std::fs::read(config::get_config_path()).unwrap(),
            disk_before
        );
    }

    for env in [json!({ "FIXTURE": "changed" }), json!({})] {
        project["env_vars"] = env;
        invoke(&window, "update_project", json!({ "project": project })).unwrap();
        assert_eq!(
            serde_json::to_value(&config::load_config().projects[0]).unwrap(),
            project
        );
    }
}
