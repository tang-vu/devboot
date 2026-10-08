//! Disposable synthetic children only; never call application setup or OS startup APIs.
use super::*;
use std::ffi::OsStr;
use std::time::Instant;

#[test]
fn child_environment_uses_literal_values_and_project_overrides() {
    let env = HashMap::from([
        (
            "DEVBOOT_FIXTURE".into(),
            "spaces 'quotes' $VARIABLE $(literal) & café\nnext".into(),
        ),
        ("DEVBOOT_EMPTY".into(), "".into()),
        ("PYTHONUTF8".into(), "0".into()),
    ]);
    let parent_value = std::env::var_os("DEVBOOT_FIXTURE");
    let command = project_command("bash", "C:/synthetic/", &["echo fixture".into()], &env).unwrap();
    let child_env: HashMap<_, _> = command.get_envs().collect();
    for (key, value) in &env {
        assert_eq!(child_env[OsStr::new(key)], Some(OsStr::new(value)));
    }
    assert_eq!(
        child_env[OsStr::new("PYTHONIOENCODING")],
        Some(OsStr::new("utf-8"))
    );
    assert_eq!(std::env::var_os("DEVBOOT_FIXTURE"), parent_value);
    let args: Vec<_> = command.get_args().collect();
    assert_eq!(
        args,
        [
            OsStr::new("-c"),
            OsStr::new("cd 'C:/synthetic/' && echo fixture")
        ]
    );

    let other = project_command("bash", "C:/synthetic/", &[], &HashMap::new()).unwrap();
    assert!(!other.get_envs().any(|(key, _)| key == "DEVBOOT_FIXTURE"));
    assert!(project_command(
        "bash",
        "C:/synthetic/",
        &[],
        &HashMap::from([("FIXTURE".into(), "invalid\0value".into()),])
    )
    .is_err());
}

#[test]
fn environment_names_follow_host_case_semantics() {
    let both = HashMap::from([
        ("DEVBOOT_FIXTURE".into(), "one".into()),
        ("devboot_fixture".into(), "two".into()),
    ]);
    assert_eq!(validate_env_vars(&both).is_err(), cfg!(windows));
    let command = project_command(
        "bash",
        "C:/synthetic/",
        &[],
        &HashMap::from([("pythonutf8".into(), "0".into())]),
    )
    .unwrap();
    let matching: Vec<_> = command
        .get_envs()
        .filter(|(key, _)| key.to_string_lossy().eq_ignore_ascii_case("PYTHONUTF8"))
        .collect();
    assert_eq!(matching.len(), if cfg!(windows) { 1 } else { 2 });
    if cfg!(windows) {
        assert_eq!(matching[0].1, Some(OsStr::new("0")));
    }
}

struct FixtureProcess {
    manager: ProcessManager,
    project: Project,
    _directory: tempfile::TempDir,
}

impl Drop for FixtureProcess {
    fn drop(&mut self) {
        // Only the owned fixture shell, using no process-tree or OS startup APIs.
        let mut processes = self.manager.processes.lock().unwrap();
        if let Some(info) = processes.get_mut(&self.project.id) {
            info.status = ProcessStatus::Stopped;
            if let Some(mut child) = info.child.take() {
                if matches!(child.try_wait(), Ok(None)) {
                    let _ = child.kill();
                    let _ = child.wait();
                }
            }
        }
    }
}

fn wait_for_stopped(fixture: &FixtureProcess, expected_line: &str, count: usize) {
    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        let logs = fixture.manager.get_logs(&fixture.project.id);
        if fixture.manager.get_status(&fixture.project.id) == ProcessStatus::Stopped
            && logs
                .iter()
                .filter(|line| line.ends_with(expected_line))
                .count()
                == count
        {
            return;
        }
        assert!(
            Instant::now() < deadline,
            "Synthetic child did not complete: {logs:?}"
        );
        thread::sleep(Duration::from_millis(25));
    }
}

#[test]
fn initial_crash_and_manual_restart_keep_the_project_environment() {
    let directory = tempfile::tempdir().unwrap();
    let mut project = Project::new(
        "Disposable environment fixture".into(),
        directory.path().to_str().unwrap().into(),
        vec![concat!(
            "printf '%s|%s|%s\\n' \"$DEVBOOT_FIXTURE\" \"$DEVBOOT_EMPTY\" \"$PYTHONUTF8\"; ",
            "if [ ! -f restarted ]; then : > restarted; exit 1; fi",
        )
        .into()],
    );
    project.auto_start = false;
    let value = "spaces 'quotes' $VARIABLE $(literal) & café";
    project.env_vars = HashMap::from([
        ("DEVBOOT_FIXTURE".into(), value.into()),
        ("DEVBOOT_EMPTY".into(), "".into()),
        ("PYTHONUTF8".into(), "0".into()),
    ]);
    let mut fixture = FixtureProcess {
        manager: ProcessManager::new(),
        project,
        _directory: directory,
    };
    fixture.manager.start_project(&fixture.project).unwrap();
    wait_for(
        &fixture.manager,
        &fixture.project.id,
        ProcessStatus::Restarting,
    );
    fixture
        .project
        .env_vars
        .insert("DEVBOOT_FIXTURE".into(), "edited fixture".into());
    // Edits affect the next manual launch; an automatic retry keeps its launch snapshot.
    wait_for_stopped(&fixture, &format!("{value}||0"), 2);
    assert_eq!(
        fixture.manager.processes.lock().unwrap()[&fixture.project.id].restart_count,
        1
    );

    fixture.manager.start_project(&fixture.project).unwrap();
    wait_for_stopped(&fixture, "edited fixture||0", 1);
}

fn wait_for(manager: &ProcessManager, id: &str, status: ProcessStatus) {
    let deadline = Instant::now() + Duration::from_secs(10);
    while manager.get_status(id) != status {
        assert!(Instant::now() < deadline, "Disposable fixture timed out");
        thread::sleep(Duration::from_millis(20));
    }
}

#[test]
fn validation_errors_do_not_disclose_values() {
    let secret = "SYNTHETIC_PRIVATE_CANARY";
    for key in ["", "BAD=KEY", "BAD\0KEY"] {
        let env = HashMap::from([(key.to_string(), secret.to_string())]);
        let error = validate_env_vars(&env).unwrap_err();
        assert!(!error.contains(secret));
    }
    let error =
        validate_env_vars(&HashMap::from([("FIXTURE".into(), format!("{secret}\0"))])).unwrap_err();
    assert!(!error.contains(secret));
    assert!(validate_env_vars(&HashMap::from([
        ("变量".into(), "".into()),
        (
            "café".into(),
            "spaces 'quotes' $VARIABLE $(literal) & café\nnext".into()
        )
    ]))
    .is_ok());
}

#[test]
fn silent_children_do_not_log_environment_values() {
    let dir = tempfile::tempdir().unwrap();
    let mut project = Project::new(
        "Synthetic private environment".into(),
        dir.path().to_str().unwrap().into(),
        vec!["exit 0".into()],
    );
    project.auto_start = false;
    project.env_vars.insert(
        "DEVBOOT_REVIEW_CANARY".into(),
        "SYNTHETIC_PRIVATE_CANARY".into(),
    );
    let manager = ProcessManager::new();
    manager.start_project(&project).unwrap();
    wait_for(&manager, &project.id, ProcessStatus::Stopped);
    assert!(manager
        .get_logs(&project.id)
        .iter()
        .all(|line| !line.contains("SYNTHETIC_PRIVATE_CANARY")));
}

#[test]
fn manual_start_during_pending_crash_restart_keeps_newest_environment() {
    let dir = tempfile::tempdir().unwrap();
    let mut project = Project::new("Synthetic pending restart".into(), dir.path().to_str().unwrap().into(), vec!["printf 'ENV=%s\\n' \"$DEVBOOT_REVIEW_VALUE\"; if [ ! -f restarted ]; then : > restarted; exit 1; fi".into()]);
    project.auto_start = false;
    project
        .env_vars
        .insert("DEVBOOT_REVIEW_VALUE".into(), "OLD".into());
    let manager = ProcessManager::new();
    manager.start_project(&project).unwrap();
    wait_for(&manager, &project.id, ProcessStatus::Restarting);
    project
        .env_vars
        .insert("DEVBOOT_REVIEW_VALUE".into(), "NEW".into());
    manager.start_project(&project).unwrap();
    wait_for(&manager, &project.id, ProcessStatus::Stopped);
    // Allow the already scheduled restart to resolve. All fixture commands exit on their own.
    thread::sleep(Duration::from_millis(3000));
    wait_for(&manager, &project.id, ProcessStatus::Stopped);
    let values: Vec<_> = manager
        .get_logs(&project.id)
        .into_iter()
        .filter(|line| line.contains("ENV="))
        .collect();
    assert_eq!(
        values.len(),
        2,
        "A stale automatic restart ran with an old environment: {values:?}"
    );
    assert!(values[1].ends_with("ENV=NEW"));
}

#[test]
fn recreated_project_entry_does_not_reuse_pending_restart_ownership() {
    let dir = tempfile::tempdir().unwrap();
    let mut project = Project::new(
        "Synthetic recreated entry".into(),
        dir.path().to_str().unwrap().into(),
        vec!["printf 'ENV=%s\\n' \"$DEVBOOT_REVIEW_VALUE\"; exit 1".into()],
    );
    project
        .env_vars
        .insert("DEVBOOT_REVIEW_VALUE".into(), "OLD".into());
    let manager = ProcessManager::new();
    manager.start_project(&project).unwrap();
    wait_for(&manager, &project.id, ProcessStatus::Restarting);
    // The old child has exited and been reaped. Only its delayed monitor remains.
    manager.processes.lock().unwrap().remove(&project.id);
    project.commands = vec!["printf 'ENV=%s\\n' \"$DEVBOOT_REVIEW_VALUE\"".into()];
    project
        .env_vars
        .insert("DEVBOOT_REVIEW_VALUE".into(), "NEW".into());
    manager.start_project(&project).unwrap();
    wait_for(&manager, &project.id, ProcessStatus::Stopped);
    thread::sleep(Duration::from_millis(RESTART_DELAY_MS + 500));
    let values: Vec<_> = manager
        .get_logs(&project.id)
        .into_iter()
        .filter(|line| line.contains("ENV="))
        .collect();
    assert_eq!(
        values.len(),
        1,
        "Stale restart recreated an old launch: {values:?}"
    );
    assert!(values[0].ends_with("ENV=NEW"));
}

#[test]
fn simultaneous_starts_publish_only_one_child() {
    let dir = tempfile::tempdir().unwrap();
    let project = Project::new(
        "Synthetic concurrent start".into(),
        dir.path().to_str().unwrap().into(),
        vec!["printf 'single owned child\\n'; read -t 3 -r reply; exit 0".into()],
    );
    let manager = ProcessManager::new();
    let barrier = std::sync::Barrier::new(3);
    let results = thread::scope(|scope| {
        let first = scope.spawn(|| {
            barrier.wait();
            manager.start_project(&project)
        });
        let second = scope.spawn(|| {
            barrier.wait();
            manager.start_project(&project)
        });
        barrier.wait();
        [first.join().unwrap(), second.join().unwrap()]
    });
    // Release the owned shell with synthetic stdin; every fixture also exits on its own.
    manager.send_input(&project.id, "fixture done").unwrap();
    wait_for(&manager, &project.id, ProcessStatus::Stopped);
    assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
    assert_eq!(
        manager
            .get_logs(&project.id)
            .iter()
            .filter(|line| line.ends_with("single owned child"))
            .count(),
        1
    );
}
