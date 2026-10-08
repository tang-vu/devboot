use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use crate::config::{validate_env_vars, Project};
use crate::log_buffer::{LogBuffer, LogEvent, LogSnapshot};

#[cfg(test)]
#[path = "process_environment_tests.rs"]
mod environment_tests;

/// Constants
const MAX_RESTART_ATTEMPTS: u32 = 5;
const RESTART_DELAY_MS: u64 = 2000;

/// Process status enum
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ProcessStatus {
    Stopped,
    Running,
    Error,
    Restarting,
}

/// Event payloads for frontend
#[derive(Clone, Serialize)]
pub struct LogPayload {
    pub project_id: String,
    pub log: String,
}

#[derive(Clone, Serialize)]
pub struct StatusPayload {
    pub project_id: String,
    pub status: String,
}

#[derive(Clone, Serialize)]
pub struct CrashPayload {
    pub project_id: String,
    pub restart_count: u32,
    pub will_restart: bool,
}

/// Process info for a running project
pub struct ProcessInfo {
    #[allow(dead_code)]
    pub project_id: String,
    pub child: Option<Child>,
    pub status: ProcessStatus,
    logs: LogBuffer,
    pub restart_count: u32,
    pub restart_on_crash: bool,
    pub path: String,
    pub commands: Vec<String>,
    env_vars: HashMap<String, String>,
    // The monitor retains this identity, so removed/recreated entries cannot reuse it.
    launch_token: Arc<()>,
}

impl ProcessInfo {
    pub fn new(project_id: String, path: String, commands: Vec<String>, restart_on_crash: bool) -> Self {
        Self {
            project_id,
            child: None,
            status: ProcessStatus::Stopped,
            logs: LogBuffer::default(),
            restart_count: 0,
            restart_on_crash,
            path,
            commands,
            env_vars: HashMap::new(),
            launch_token: Arc::new(()),
        }
    }

    // All callers hold the process-map lock, so storage and event identity
    // share the same ordering as snapshots and clears.
    fn add_log(&mut self, line: String, session_id: &str) -> Option<LogEvent> {
        self.logs.append_event(session_id, &self.project_id, line)
    }
}

/// Process manager to handle all running processes
pub struct ProcessManager {
    session_id: String,
    processes: Arc<Mutex<HashMap<String, ProcessInfo>>>,
    stdin_handles: Arc<Mutex<HashMap<String, ChildStdin>>>,
    git_bash_path: String,
    app_handle: Arc<Mutex<Option<AppHandle>>>,
}

impl ProcessManager {
    pub fn new() -> Self {
        let git_bash_path = Self::find_git_bash();
        
        Self {
            session_id: uuid::Uuid::new_v4().to_string(),
            processes: Arc::new(Mutex::new(HashMap::new())),
            stdin_handles: Arc::new(Mutex::new(HashMap::new())),
            git_bash_path,
            app_handle: Arc::new(Mutex::new(None)),
        }
    }

    /// Set app handle for emitting events
    pub fn set_app_handle(&self, handle: AppHandle) {
        let mut app_handle = self.app_handle.lock().unwrap();
        *app_handle = Some(handle);
    }

    /// Emit event to frontend
    fn emit_event<S: Serialize + Clone>(&self, event: &str, payload: S) {
        if let Some(handle) = self.app_handle.lock().unwrap().as_ref() {
            let _ = handle.emit(event, payload);
        }
    }

    // Call only after releasing the process-map lock. Clone the handle so the
    // new log stream also avoids holding the handle mutex during event delivery.
    fn emit_log_events(
        app_handle: &Mutex<Option<AppHandle>>,
        events: impl IntoIterator<Item = LogEvent>,
    ) {
        let handle = app_handle.lock().unwrap().clone();
        if let Some(handle) = handle {
            for event in events {
                let _ = handle.emit("process-log-v2", event);
            }
        }
    }

    /// Find Git Bash executable path
    fn find_git_bash() -> String {
        let possible_paths = vec![
            "C:\\Program Files\\Git\\bin\\bash.exe",
            "C:\\Program Files (x86)\\Git\\bin\\bash.exe",
            "C:\\Git\\bin\\bash.exe",
        ];

        for path in possible_paths {
            if std::path::Path::new(path).exists() {
                return path.to_string();
            }
        }

        // Fallback - try to find in PATH
        "bash".to_string()
    }

    /// Start a project process
    pub fn start_project(&self, project: &Project) -> Result<(), String> {
        // Keep the check, spawn, and publication together so a pending restart
        // cannot replace a newer manual launch with its old environment.
        let mut procs = self.processes.lock().unwrap();
        if let Some(info) = procs.get(&project.id) {
            if info.status == ProcessStatus::Running {
                return Err("Project is already running".to_string());
            }
        }
        let project_id = &project.id;
        let path = &project.path;
        let commands = &project.commands;
        let restart_on_crash = project.restart_on_crash;
        let mut child = project_command(&self.git_bash_path, path, commands, &project.env_vars)?
            .spawn()
            .map_err(|e| format!("Failed to start process: {}", e))?;

        // Capture stdin, stdout, and stderr
        let stdin = child.stdin.take();
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();
        let pid = project_id.to_string();

        // Create or update process info
        let launch_token = {
            let info = procs.entry(project_id.to_string()).or_insert_with(|| {
                ProcessInfo::new(
                    project_id.to_string(),
                    path.to_string(),
                    commands.to_vec(),
                    restart_on_crash,
                )
            });
            info.status = ProcessStatus::Running;
            info.child = Some(child);
            info.restart_count = 0;
            info.restart_on_crash = restart_on_crash;
            info.path = path.to_string();
            info.commands = commands.to_vec();
            info.env_vars = project.env_vars.clone();
            info.launch_token = Arc::new(());
            Arc::clone(&info.launch_token)
        };
        drop(procs);

        // Store stdin separately without holding the process lock.
        if let Some(stdin_handle) = stdin {
            let mut stdin_handles = self.stdin_handles.lock().unwrap();
            stdin_handles.insert(project_id.to_string(), stdin_handle);
        }

        // Emit status changed event
        self.emit_event("process-status", StatusPayload {
            project_id: pid.clone(),
            status: "running".to_string(),
        });

        let processes = Arc::clone(&self.processes);
        let app_handle = Arc::clone(&self.app_handle);
        let session_id = self.session_id.clone();

        // Spawn thread to read stdout
        if let Some(stdout) = stdout {
            let processes = Arc::clone(&processes);
            let app_handle = Arc::clone(&app_handle);
            let session_id = session_id.clone();
            let pid = pid.clone();
            
            thread::spawn(move || {
                let reader = BufReader::new(stdout);
                for line in reader.lines() {
                    if let Ok(line) = line {
                        let timestamp = chrono::Local::now().format("%H:%M:%S").to_string();
                        let log_line = format!("[{}] {}", timestamp, line);
                        
                        // Add to logs
                        let log_event = {
                            let mut procs = processes.lock().unwrap();
                            procs.get_mut(&pid).and_then(|info| {
                                info.add_log(log_line.clone(), &session_id)
                            })
                        };
                        Self::emit_log_events(&app_handle, log_event);

                        // Emit log event
                        if let Some(handle) = app_handle.lock().unwrap().as_ref() {
                            let _ = handle.emit("process-log", LogPayload {
                                project_id: pid.clone(),
                                log: log_line,
                            });
                        }
                    }
                }
            });
        }

        // Spawn thread to read stderr (many tools output to stderr, not just errors)
        if let Some(stderr) = stderr {
            let processes = Arc::clone(&processes);
            let app_handle = Arc::clone(&app_handle);
            let session_id = session_id.clone();
            let pid = pid.clone();
            
            thread::spawn(move || {
                let reader = BufReader::new(stderr);
                for line in reader.lines() {
                    if let Ok(line) = line {
                        let timestamp = chrono::Local::now().format("%H:%M:%S").to_string();
                        // Don't prefix with [ERR] - many tools use stderr for normal output
                        let log_line = format!("[{}] {}", timestamp, line);
                        
                        let log_event = {
                            let mut procs = processes.lock().unwrap();
                            procs.get_mut(&pid).and_then(|info| {
                                info.add_log(log_line.clone(), &session_id)
                            })
                        };
                        Self::emit_log_events(&app_handle, log_event);

                        if let Some(handle) = app_handle.lock().unwrap().as_ref() {
                            let _ = handle.emit("process-log", LogPayload {
                                project_id: pid.clone(),
                                log: log_line,
                            });
                        }
                    }
                }
            });
        }

        // Spawn monitoring thread for crash detection
        let processes_monitor = Arc::clone(&self.processes);
        let stdin_handles_monitor = Arc::clone(&self.stdin_handles);
        let app_handle_monitor = Arc::clone(&self.app_handle);
        let session_id_monitor = self.session_id.clone();
        let git_bash_path = self.git_bash_path.clone();
        let pid_monitor = pid.clone();

        thread::spawn(move || {
            Self::monitor_process(
                processes_monitor,
                stdin_handles_monitor,
                app_handle_monitor,
                session_id_monitor,
                git_bash_path,
                pid_monitor,
                launch_token,
            );
        });

        Ok(())
    }

    /// Monitor process for crashes and auto-restart
    fn monitor_process(
        processes: Arc<Mutex<HashMap<String, ProcessInfo>>>,
        stdin_handles: Arc<Mutex<HashMap<String, ChildStdin>>>,
        app_handle: Arc<Mutex<Option<AppHandle>>>,
        session_id: String,
        git_bash_path: String,
        project_id: String,
        launch_token: Arc<()>,
    ) {
        loop {
            thread::sleep(Duration::from_millis(500));

            let should_restart;
            let restart_count;
            let path;
            let commands;
            let env_vars;
            let mut log_events = Vec::new();

            {
                let mut procs = processes.lock().unwrap();
                let info = match procs.get_mut(&project_id) {
                    Some(info) => info,
                    None => return, // Process info removed, exit monitor
                };

                // Check if process is still running
                if !Arc::ptr_eq(&info.launch_token, &launch_token) || info.status != ProcessStatus::Running {
                    return; // Not running, exit monitor
                }

                if let Some(ref mut child) = info.child {
                    match child.try_wait() {
                        Ok(Some(status)) => {
                            // Process exited
                            let exit_code = status.code().unwrap_or(-1);
                            let timestamp = chrono::Local::now().format("%H:%M:%S").to_string();
                            
                            if exit_code == 0 {
                                // Normal exit
                                log_events.extend(info.add_log(
                                    format!("[{}] Process exited normally", timestamp),
                                    &session_id,
                                ));
                                info.status = ProcessStatus::Stopped;
                                
                                // Emit status
                                if let Some(handle) = app_handle.lock().unwrap().as_ref() {
                                    let _ = handle.emit("process-status", StatusPayload {
                                        project_id: project_id.clone(),
                                        status: "stopped".to_string(),
                                    });
                                }
                                drop(procs);
                                Self::emit_log_events(&app_handle, log_events);
                                return;
                            } else {
                                // Crashed
                                log_events.extend(info.add_log(
                                    format!(
                                        "[{}] [ERR] Process crashed with exit code: {}",
                                        timestamp, exit_code,
                                    ),
                                    &session_id,
                                ));
                                
                                should_restart = info.restart_on_crash && info.restart_count < MAX_RESTART_ATTEMPTS;
                                restart_count = info.restart_count + 1;
                                path = info.path.clone();
                                commands = info.commands.clone();
                                env_vars = info.env_vars.clone();

                                // Emit crash event
                                if let Some(handle) = app_handle.lock().unwrap().as_ref() {
                                    let _ = handle.emit("process-crash", CrashPayload {
                                        project_id: project_id.clone(),
                                        restart_count,
                                        will_restart: should_restart,
                                    });
                                }

                                if should_restart {
                                    info.status = ProcessStatus::Restarting;
                                    log_events.extend(info.add_log(
                                        format!(
                                            "[{}] Restarting... (attempt {}/{})",
                                            timestamp, restart_count, MAX_RESTART_ATTEMPTS,
                                        ),
                                        &session_id,
                                    ));
                                    
                                    if let Some(handle) = app_handle.lock().unwrap().as_ref() {
                                        let _ = handle.emit("process-status", StatusPayload {
                                            project_id: project_id.clone(),
                                            status: "restarting".to_string(),
                                        });
                                    }
                                } else {
                                    info.status = ProcessStatus::Error;
                                    if info.restart_count >= MAX_RESTART_ATTEMPTS {
                                        log_events.extend(info.add_log(
                                            format!(
                                                "[{}] [ERR] Max restart attempts reached. Giving up.",
                                                timestamp,
                                            ),
                                            &session_id,
                                        ));
                                    }
                                    
                                    if let Some(handle) = app_handle.lock().unwrap().as_ref() {
                                        let _ = handle.emit("process-status", StatusPayload {
                                            project_id: project_id.clone(),
                                            status: "error".to_string(),
                                        });
                                    }
                                    drop(procs);
                                    Self::emit_log_events(&app_handle, log_events);
                                    return;
                                }
                            }
                        }
                        Ok(None) => {
                            // Still running
                            continue;
                        }
                        Err(e) => {
                            log_events.extend(info.add_log(
                                format!("[ERR] Failed to check process status: {}", e),
                                &session_id,
                            ));
                            info.status = ProcessStatus::Error;
                            drop(procs);
                            Self::emit_log_events(&app_handle, log_events);
                            return;
                        }
                    }
                } else {
                    return; // No child process
                }
            }
            Self::emit_log_events(&app_handle, log_events);

            // Wait outside the lock, then verify this launch still owns the restart.
            if should_restart {
                thread::sleep(Duration::from_millis(RESTART_DELAY_MS));

                let mut procs = processes.lock().unwrap();
                match procs.get(&project_id) {
                    Some(info) if Arc::ptr_eq(&info.launch_token, &launch_token) && info.status == ProcessStatus::Restarting => {}
                    _ => return,
                }
                
                // Respawn
                match project_command(&git_bash_path, &path, &commands, &env_vars)
                    .and_then(|mut command| command.spawn().map_err(|error| error.to_string()))
                {
                    Ok(mut child) => {
                        let stdin = child.stdin.take();
                        let stdout = child.stdout.take();
                        let stderr = child.stderr.take();

                        let log_event = procs.get_mut(&project_id).and_then(|info| {
                            info.child = Some(child);
                            info.status = ProcessStatus::Running;
                            info.restart_count = restart_count;

                            let timestamp = chrono::Local::now().format("%H:%M:%S").to_string();
                            info.add_log(
                                format!("[{}] Process restarted successfully", timestamp),
                                &session_id,
                            )
                        });
                        drop(procs);
                        Self::emit_log_events(&app_handle, log_event);

                        // Store stdin without holding the process lock.
                        if let Some(stdin_handle) = stdin {
                            let mut stdin_map = stdin_handles.lock().unwrap();
                            stdin_map.insert(project_id.clone(), stdin_handle);
                        }

                        if let Some(handle) = app_handle.lock().unwrap().as_ref() {
                            let _ = handle.emit("process-status", StatusPayload {
                                project_id: project_id.clone(),
                                status: "running".to_string(),
                            });
                        }

                        // Setup new stdout/stderr readers
                        if let Some(stdout) = stdout {
                            let processes = Arc::clone(&processes);
                            let app_handle = Arc::clone(&app_handle);
                            let session_id = session_id.clone();
                            let pid = project_id.clone();
                            
                            thread::spawn(move || {
                                let reader = BufReader::new(stdout);
                                for line in reader.lines() {
                                    if let Ok(line) = line {
                                        let timestamp = chrono::Local::now().format("%H:%M:%S").to_string();
                                        let log_line = format!("[{}] {}", timestamp, line);
                                        
                                        let log_event = {
                                            let mut procs = processes.lock().unwrap();
                                            procs.get_mut(&pid).and_then(|info| {
                                                info.add_log(log_line.clone(), &session_id)
                                            })
                                        };
                                        Self::emit_log_events(&app_handle, log_event);

                                        if let Some(handle) = app_handle.lock().unwrap().as_ref() {
                                            let _ = handle.emit("process-log", LogPayload {
                                                project_id: pid.clone(),
                                                log: log_line,
                                            });
                                        }
                                    }
                                }
                            });
                        }

                        if let Some(stderr) = stderr {
                            let processes = Arc::clone(&processes);
                            let app_handle = Arc::clone(&app_handle);
                            let session_id = session_id.clone();
                            let pid = project_id.clone();
                            
                            thread::spawn(move || {
                                let reader = BufReader::new(stderr);
                                for line in reader.lines() {
                                    if let Ok(line) = line {
                                        let timestamp = chrono::Local::now().format("%H:%M:%S").to_string();
                                        let log_line = format!("[{}] [ERR] {}", timestamp, line);
                                        
                                        let log_event = {
                                            let mut procs = processes.lock().unwrap();
                                            procs.get_mut(&pid).and_then(|info| {
                                                info.add_log(log_line.clone(), &session_id)
                                            })
                                        };
                                        Self::emit_log_events(&app_handle, log_event);

                                        if let Some(handle) = app_handle.lock().unwrap().as_ref() {
                                            let _ = handle.emit("process-log", LogPayload {
                                                project_id: pid.clone(),
                                                log: log_line,
                                            });
                                        }
                                    }
                                }
                            });
                        }

                        // Continue monitoring
                    }
                    Err(e) => {
                        let log_event = procs.get_mut(&project_id).and_then(|info| {
                            info.status = ProcessStatus::Error;
                            let timestamp = chrono::Local::now().format("%H:%M:%S").to_string();
                            info.add_log(
                                format!("[{}] [ERR] Failed to restart: {}", timestamp, e),
                                &session_id,
                            )
                        });
                        drop(procs);
                        Self::emit_log_events(&app_handle, log_event);
                        
                        if let Some(handle) = app_handle.lock().unwrap().as_ref() {
                            let _ = handle.emit("process-status", StatusPayload {
                                project_id: project_id.clone(),
                                status: "error".to_string(),
                            });
                        }
                        return;
                    }
                }
            }
        }
    }

    /// Stop a project process
    pub fn stop_project(&self, project_id: &str) -> Result<(), String> {
        let mut procs = self.processes.lock().unwrap();
        
        if let Some(info) = procs.get_mut(project_id) {
            if let Some(ref mut child) = info.child {
                let pid = child.id();
                
                // On Windows, use taskkill to kill the entire process tree
                #[cfg(windows)]
                {
                    let _ = std::process::Command::new("taskkill")
                        .args(["/F", "/T", "/PID", &pid.to_string()])
                        .creation_flags(0x08000000) // CREATE_NO_WINDOW
                        .output();
                }
                
                // Fallback: also try normal kill
                let _ = child.kill();
                let _ = child.wait(); // Wait for cleanup
            }
            info.status = ProcessStatus::Stopped;
            info.child = None;
            info.restart_count = 0; // Reset restart count

            // Clear stdin handle
            {
                let mut stdin_handles = self.stdin_handles.lock().unwrap();
                stdin_handles.remove(project_id);
            }

            // Emit status changed
            self.emit_event("process-status", StatusPayload {
                project_id: project_id.to_string(),
                status: "stopped".to_string(),
            });
        }
        
        Ok(())
    }

    /// Get process status
    pub fn get_status(&self, project_id: &str) -> ProcessStatus {
        let procs = self.processes.lock().unwrap();
        procs
            .get(project_id)
            .map(|info| info.status.clone())
            .unwrap_or(ProcessStatus::Stopped)
    }

    /// Get process logs
    pub fn get_logs(&self, project_id: &str) -> Vec<String> {
        let procs = self.processes.lock().unwrap();
        procs
            .get(project_id)
            .map(|info| info.logs.legacy_logs())
            .unwrap_or_default()
    }

    /// Read the complete retained log view at one process-map lock boundary.
    pub fn get_log_snapshot(&self, project_id: &str) -> LogSnapshot {
        let procs = self.processes.lock().unwrap();
        match procs.get(project_id) {
            Some(info) => info.logs.snapshot(&self.session_id, project_id),
            None => LogBuffer::default().snapshot(&self.session_id, project_id),
        }
    }

    /// Clear and capture the boundary atomically. Readers may append after the
    /// lock is released; their sequence numbers remain above this boundary.
    pub fn clear_log_snapshot(&self, project_id: &str) -> LogSnapshot {
        let snapshot = {
            let mut procs = self.processes.lock().unwrap();
            match procs.get_mut(project_id) {
                Some(info) => info.logs.clear(&self.session_id, project_id),
                None => LogBuffer::default().snapshot(&self.session_id, project_id),
            }
        };
        Self::emit_log_events(
            &self.app_handle,
            Some(LogEvent::Clear {
                snapshot: snapshot.clone(),
            }),
        );
        snapshot
    }

    /// Legacy callers share the same clear boundary and v2 notification.
    pub fn clear_logs(&self, project_id: &str) {
        self.clear_log_snapshot(project_id);
    }

    /// Send input to a running process
    pub fn send_input(&self, project_id: &str, input: &str) -> Result<(), String> {
        // Check if process is running
        {
            let procs = self.processes.lock().unwrap();
            match procs.get(project_id) {
                Some(info) if info.status == ProcessStatus::Running => {}
                Some(_) => return Err("Process is not running".to_string()),
                None => return Err("Project not found".to_string()),
            }
        }

        // Get stdin handle and write input
        let mut stdin_handles = self.stdin_handles.lock().unwrap();
        if let Some(stdin) = stdin_handles.get_mut(project_id) {
            // Write the input with a newline
            let input_with_newline = format!("{}\n", input);
            stdin
                .write_all(input_with_newline.as_bytes())
                .map_err(|e| format!("Failed to write to stdin: {}", e))?;
            stdin
                .flush()
                .map_err(|e| format!("Failed to flush stdin: {}", e))?;

            // Echo the input to logs
            let timestamp = chrono::Local::now().format("%H:%M:%S").to_string();
            let log_line = format!("[{}] > {}", timestamp, input);
            
            let log_event = {
                let mut procs = self.processes.lock().unwrap();
                procs.get_mut(project_id).and_then(|info| {
                    info.add_log(log_line.clone(), &self.session_id)
                })
            };
            Self::emit_log_events(&self.app_handle, log_event);

            // Emit log event for the echoed input
            self.emit_event("process-log", LogPayload {
                project_id: project_id.to_string(),
                log: log_line,
            });

            Ok(())
        } else {
            Err("No stdin handle available for this process".to_string())
        }
    }

    /// Send interrupt signal (Ctrl+C) to a running process
    pub fn send_interrupt(&self, project_id: &str) -> Result<(), String> {
        // Check if process is running
        {
            let procs = self.processes.lock().unwrap();
            match procs.get(project_id) {
                Some(info) if info.status == ProcessStatus::Running => {}
                Some(_) => return Err("Process is not running".to_string()),
                None => return Err("Project not found".to_string()),
            }
        }

        // Send Ctrl+C character (0x03 = ETX = End of Text)
        let mut stdin_handles = self.stdin_handles.lock().unwrap();
        if let Some(stdin) = stdin_handles.get_mut(project_id) {
            // Write Ctrl+C character
            stdin
                .write_all(&[0x03])
                .map_err(|e| format!("Failed to send interrupt: {}", e))?;
            stdin
                .flush()
                .map_err(|e| format!("Failed to flush: {}", e))?;

            // Log the interrupt
            let timestamp = chrono::Local::now().format("%H:%M:%S").to_string();
            let log_line = format!("[{}] ^C", timestamp);
            
            let log_event = {
                let mut procs = self.processes.lock().unwrap();
                procs.get_mut(project_id).and_then(|info| {
                    info.add_log(log_line.clone(), &self.session_id)
                })
            };
            Self::emit_log_events(&self.app_handle, log_event);

            self.emit_event("process-log", LogPayload {
                project_id: project_id.to_string(),
                log: log_line,
            });

            Ok(())
        } else {
            Err("No stdin handle available".to_string())
        }
    }

    /// Check if a project is running
    #[allow(dead_code)]
    pub fn is_running(&self, project_id: &str) -> bool {
        self.get_status(project_id) == ProcessStatus::Running
    }

    /// Stop all running processes
    pub fn stop_all(&self) {
        let mut procs = self.processes.lock().unwrap();
        for (project_id, info) in procs.iter_mut() {
            if let Some(ref mut child) = info.child {
                let pid = child.id();
                
                // On Windows, use taskkill to kill the entire process tree
                #[cfg(windows)]
                {
                    let _ = std::process::Command::new("taskkill")
                        .args(["/F", "/T", "/PID", &pid.to_string()])
                        .creation_flags(0x08000000)
                        .output();
                }
                
                let _ = child.kill();
                let _ = child.wait();
            }
            info.status = ProcessStatus::Stopped;
            info.child = None;

            self.emit_event("process-status", StatusPayload {
                project_id: project_id.clone(),
                status: "stopped".to_string(),
            });
        }

        // Clear all stdin handles
        {
            let mut stdin_handles = self.stdin_handles.lock().unwrap();
            stdin_handles.clear();
        }
    }
}

impl Default for ProcessManager {
    fn default() -> Self {
        Self::new()
    }
}

/// Build the same child environment for initial launches and crash restarts.
fn project_command(
    git_bash_path: &str,
    path: &str,
    commands: &[String],
    env_vars: &HashMap<String, String>,
) -> Result<Command, String> {
    validate_env_vars(env_vars)?;
    let cd_command = format!("cd '{}'", path.replace('\\', "/"));
    let script = std::iter::once(cd_command)
        .chain(commands.iter().cloned())
        .collect::<Vec<_>>()
        .join(" && ");
    let mut command = Command::new(git_bash_path);
    command
        .args(["-c", &script])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env("PYTHONIOENCODING", "utf-8")
        .env("PYTHONUTF8", "1")
        .env("LANG", "en_US.UTF-8")
        .env("LC_ALL", "en_US.UTF-8")
        // Pass raw values to the child, never interpolate them into the shell script.
        .envs(env_vars)
        .creation_flags(0x08000000); // CREATE_NO_WINDOW on Windows
    Ok(command)
}

// Windows-specific trait for process spawning
#[cfg(windows)]
trait CommandExt {
    fn creation_flags(&mut self, flags: u32) -> &mut Self;
}

#[cfg(windows)]
impl CommandExt for Command {
    fn creation_flags(&mut self, flags: u32) -> &mut Self {
        use std::os::windows::process::CommandExt as WinCommandExt;
        WinCommandExt::creation_flags(self, flags);
        self
    }
}

#[cfg(not(windows))]
trait CommandExt {
    fn creation_flags(&mut self, _flags: u32) -> &mut Self;
}

#[cfg(not(windows))]
impl CommandExt for Command {
    fn creation_flags(&mut self, _flags: u32) -> &mut Self {
        self
    }
}
