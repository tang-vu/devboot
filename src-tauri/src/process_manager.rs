use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

/// Constants
const MAX_LOG_LINES: usize = 1000;
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
#[derive(Debug)]
pub struct ProcessInfo {
    #[allow(dead_code)]
    pub project_id: String,
    pub child: Option<Child>,
    pub status: ProcessStatus,
    pub logs: Vec<String>,
    pub restart_count: u32,
    pub restart_on_crash: bool,
    pub path: String,
    pub commands: Vec<String>,
}

impl ProcessInfo {
    pub fn new(project_id: String, path: String, commands: Vec<String>, restart_on_crash: bool) -> Self {
        Self {
            project_id,
            child: None,
            status: ProcessStatus::Stopped,
            logs: Vec::new(),
            restart_count: 0,
            restart_on_crash,
            path,
            commands,
        }
    }

    pub fn add_log(&mut self, line: String) {
        // Keep only last MAX_LOG_LINES lines
        if self.logs.len() >= MAX_LOG_LINES {
            self.logs.remove(0);
        }
        self.logs.push(line);
    }
}

/// Process manager to handle all running processes
pub struct ProcessManager {
    processes: Arc<Mutex<HashMap<String, ProcessInfo>>>,
    git_bash_path: String,
    app_handle: Arc<Mutex<Option<AppHandle>>>,
}

impl ProcessManager {
    pub fn new() -> Self {
        let git_bash_path = Self::find_git_bash();
        
        Self {
            processes: Arc::new(Mutex::new(HashMap::new())),
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
    pub fn start_project(
        &self,
        project_id: &str,
        path: &str,
        commands: &[String],
        restart_on_crash: bool,
    ) -> Result<(), String> {
        // Check if already running
        {
            let procs = self.processes.lock().unwrap();
            if let Some(info) = procs.get(project_id) {
                if info.status == ProcessStatus::Running {
                    return Err("Project is already running".to_string());
                }
            }
        }

        self.spawn_process(project_id, path, commands, restart_on_crash, 0)
    }

    /// Internal spawn process (used for initial start and restarts)
    fn spawn_process(
        &self,
        project_id: &str,
        path: &str,
        commands: &[String],
        restart_on_crash: bool,
        restart_count: u32,
    ) -> Result<(), String> {
        // Build the full command
        let cd_command = format!("cd '{}'", path.replace('\\', "/"));
        let full_commands: Vec<String> = std::iter::once(cd_command)
            .chain(commands.iter().cloned())
            .collect();
        let script = full_commands.join(" && ");

        // Spawn the process with UTF-8 encoding for Python and other tools
        let mut child = Command::new(&self.git_bash_path)
            .args(["-c", &script])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            // Set UTF-8 encoding environment variables
            .env("PYTHONIOENCODING", "utf-8")
            .env("PYTHONUTF8", "1")
            .env("LANG", "en_US.UTF-8")
            .env("LC_ALL", "en_US.UTF-8")
            .creation_flags(0x08000000) // CREATE_NO_WINDOW on Windows
            .spawn()
            .map_err(|e| format!("Failed to start process: {}", e))?;

        // Capture stdout and stderr
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();
        let pid = project_id.to_string();

        // Create or update process info
        {
            let mut procs = self.processes.lock().unwrap();
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
            info.restart_count = restart_count;
            info.restart_on_crash = restart_on_crash;
            info.path = path.to_string();
            info.commands = commands.to_vec();
        }

        // Emit status changed event
        self.emit_event("process-status", StatusPayload {
            project_id: pid.clone(),
            status: "running".to_string(),
        });

        let processes = Arc::clone(&self.processes);
        let app_handle = Arc::clone(&self.app_handle);

        // Spawn thread to read stdout
        if let Some(stdout) = stdout {
            let processes = Arc::clone(&processes);
            let app_handle = Arc::clone(&app_handle);
            let pid = pid.clone();
            
            thread::spawn(move || {
                let reader = BufReader::new(stdout);
                for line in reader.lines() {
                    if let Ok(line) = line {
                        let timestamp = chrono::Local::now().format("%H:%M:%S").to_string();
                        let log_line = format!("[{}] {}", timestamp, line);
                        
                        // Add to logs
                        {
                            let mut procs = processes.lock().unwrap();
                            if let Some(info) = procs.get_mut(&pid) {
                                info.add_log(log_line.clone());
                            }
                        }

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
            let pid = pid.clone();
            
            thread::spawn(move || {
                let reader = BufReader::new(stderr);
                for line in reader.lines() {
                    if let Ok(line) = line {
                        let timestamp = chrono::Local::now().format("%H:%M:%S").to_string();
                        // Don't prefix with [ERR] - many tools use stderr for normal output
                        let log_line = format!("[{}] {}", timestamp, line);
                        
                        {
                            let mut procs = processes.lock().unwrap();
                            if let Some(info) = procs.get_mut(&pid) {
                                info.add_log(log_line.clone());
                            }
                        }

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
        let app_handle_monitor = Arc::clone(&self.app_handle);
        let git_bash_path = self.git_bash_path.clone();
        let pid_monitor = pid.clone();

        thread::spawn(move || {
            Self::monitor_process(
                processes_monitor,
                app_handle_monitor,
                git_bash_path,
                pid_monitor,
            );
        });

        Ok(())
    }

    /// Monitor process for crashes and auto-restart
    fn monitor_process(
        processes: Arc<Mutex<HashMap<String, ProcessInfo>>>,
        app_handle: Arc<Mutex<Option<AppHandle>>>,
        git_bash_path: String,
        project_id: String,
    ) {
        loop {
            thread::sleep(Duration::from_millis(500));

            let should_restart;
            let restart_count;
            let path;
            let commands;

            {
                let mut procs = processes.lock().unwrap();
                let info = match procs.get_mut(&project_id) {
                    Some(info) => info,
                    None => return, // Process info removed, exit monitor
                };

                // Check if process is still running
                if info.status != ProcessStatus::Running {
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
                                info.add_log(format!("[{}] Process exited normally", timestamp));
                                info.status = ProcessStatus::Stopped;
                                
                                // Emit status
                                if let Some(handle) = app_handle.lock().unwrap().as_ref() {
                                    let _ = handle.emit("process-status", StatusPayload {
                                        project_id: project_id.clone(),
                                        status: "stopped".to_string(),
                                    });
                                }
                                return;
                            } else {
                                // Crashed
                                info.add_log(format!("[{}] [ERR] Process crashed with exit code: {}", timestamp, exit_code));
                                
                                should_restart = info.restart_on_crash && info.restart_count < MAX_RESTART_ATTEMPTS;
                                restart_count = info.restart_count + 1;
                                path = info.path.clone();
                                commands = info.commands.clone();

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
                                    info.add_log(format!("[{}] Restarting... (attempt {}/{})", timestamp, restart_count, MAX_RESTART_ATTEMPTS));
                                    
                                    if let Some(handle) = app_handle.lock().unwrap().as_ref() {
                                        let _ = handle.emit("process-status", StatusPayload {
                                            project_id: project_id.clone(),
                                            status: "restarting".to_string(),
                                        });
                                    }
                                } else {
                                    info.status = ProcessStatus::Error;
                                    if info.restart_count >= MAX_RESTART_ATTEMPTS {
                                        info.add_log(format!("[{}] [ERR] Max restart attempts reached. Giving up.", timestamp));
                                    }
                                    
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
                        Ok(None) => {
                            // Still running
                            continue;
                        }
                        Err(e) => {
                            info.add_log(format!("[ERR] Failed to check process status: {}", e));
                            info.status = ProcessStatus::Error;
                            return;
                        }
                    }
                } else {
                    return; // No child process
                }
            }

            // Restart the process (outside lock)
            if should_restart {
                thread::sleep(Duration::from_millis(RESTART_DELAY_MS));
                
                // Respawn
                let cd_command = format!("cd '{}'", path.replace('\\', "/"));
                let full_commands: Vec<String> = std::iter::once(cd_command)
                    .chain(commands.iter().cloned())
                    .collect();
                let script = full_commands.join(" && ");

                match Command::new(&git_bash_path)
                    .args(["-c", &script])
                    .stdout(Stdio::piped())
                    .stderr(Stdio::piped())
                    .creation_flags(0x08000000)
                    .spawn()
                {
                    Ok(mut child) => {
                        let stdout = child.stdout.take();
                        let stderr = child.stderr.take();

                        {
                            let mut procs = processes.lock().unwrap();
                            if let Some(info) = procs.get_mut(&project_id) {
                                info.child = Some(child);
                                info.status = ProcessStatus::Running;
                                info.restart_count = restart_count;
                                
                                let timestamp = chrono::Local::now().format("%H:%M:%S").to_string();
                                info.add_log(format!("[{}] Process restarted successfully", timestamp));
                            }
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
                            let pid = project_id.clone();
                            
                            thread::spawn(move || {
                                let reader = BufReader::new(stdout);
                                for line in reader.lines() {
                                    if let Ok(line) = line {
                                        let timestamp = chrono::Local::now().format("%H:%M:%S").to_string();
                                        let log_line = format!("[{}] {}", timestamp, line);
                                        
                                        {
                                            let mut procs = processes.lock().unwrap();
                                            if let Some(info) = procs.get_mut(&pid) {
                                                info.add_log(log_line.clone());
                                            }
                                        }

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
                            let pid = project_id.clone();
                            
                            thread::spawn(move || {
                                let reader = BufReader::new(stderr);
                                for line in reader.lines() {
                                    if let Ok(line) = line {
                                        let timestamp = chrono::Local::now().format("%H:%M:%S").to_string();
                                        let log_line = format!("[{}] [ERR] {}", timestamp, line);
                                        
                                        {
                                            let mut procs = processes.lock().unwrap();
                                            if let Some(info) = procs.get_mut(&pid) {
                                                info.add_log(log_line.clone());
                                            }
                                        }

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
                        let mut procs = processes.lock().unwrap();
                        if let Some(info) = procs.get_mut(&project_id) {
                            info.status = ProcessStatus::Error;
                            let timestamp = chrono::Local::now().format("%H:%M:%S").to_string();
                            info.add_log(format!("[{}] [ERR] Failed to restart: {}", timestamp, e));
                        }
                        
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
                child.kill().map_err(|e| format!("Failed to kill process: {}", e))?;
                let _ = child.wait(); // Wait for cleanup
            }
            info.status = ProcessStatus::Stopped;
            info.child = None;
            info.restart_count = 0; // Reset restart count

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
            .map(|info| info.logs.clone())
            .unwrap_or_default()
    }

    /// Clear logs for a project
    pub fn clear_logs(&self, project_id: &str) {
        let mut procs = self.processes.lock().unwrap();
        if let Some(info) = procs.get_mut(project_id) {
            info.logs.clear();
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
                child.kill().ok();
                let _ = child.wait();
            }
            info.status = ProcessStatus::Stopped;
            info.child = None;

            self.emit_event("process-status", StatusPayload {
                project_id: project_id.clone(),
                status: "stopped".to_string(),
            });
        }
    }
}

impl Default for ProcessManager {
    fn default() -> Self {
        Self::new()
    }
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
