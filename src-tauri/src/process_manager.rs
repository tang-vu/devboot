use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;

use serde::{Deserialize, Serialize};

/// Process status enum
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ProcessStatus {
    Stopped,
    Running,
    Error,
    Restarting,
}

/// Process info for a running project
#[derive(Debug)]
pub struct ProcessInfo {
    pub project_id: String,
    pub child: Option<Child>,
    pub status: ProcessStatus,
    pub logs: Vec<String>,
    pub restart_count: u32,
}

impl ProcessInfo {
    pub fn new(project_id: String) -> Self {
        Self {
            project_id,
            child: None,
            status: ProcessStatus::Stopped,
            logs: Vec::new(),
            restart_count: 0,
        }
    }

    pub fn add_log(&mut self, line: String) {
        // Keep only last 1000 lines
        if self.logs.len() > 1000 {
            self.logs.remove(0);
        }
        self.logs.push(line);
    }
}

/// Process manager to handle all running processes
pub struct ProcessManager {
    processes: Arc<Mutex<HashMap<String, ProcessInfo>>>,
    git_bash_path: String,
}

impl ProcessManager {
    pub fn new() -> Self {
        // Find Git Bash path
        let git_bash_path = Self::find_git_bash();
        
        Self {
            processes: Arc::new(Mutex::new(HashMap::new())),
            git_bash_path,
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
        // Build the full command
        let cd_command = format!("cd '{}'", path.replace('\\', "/"));
        let full_commands: Vec<String> = std::iter::once(cd_command)
            .chain(commands.iter().cloned())
            .collect();
        let script = full_commands.join(" && ");

        // Spawn the process
        let mut child = Command::new(&self.git_bash_path)
            .args(["-c", &script])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .creation_flags(0x08000000) // CREATE_NO_WINDOW on Windows
            .spawn()
            .map_err(|e| format!("Failed to start process: {}", e))?;

        // Capture stdout
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();
        let processes = Arc::clone(&self.processes);
        let pid = project_id.to_string();

        // Create process info
        {
            let mut procs = self.processes.lock().unwrap();
            let mut info = ProcessInfo::new(project_id.to_string());
            info.status = ProcessStatus::Running;
            info.child = Some(child);
            procs.insert(project_id.to_string(), info);
        }

        // Spawn thread to read stdout
        if let Some(stdout) = stdout {
            let processes = Arc::clone(&processes);
            let pid = pid.clone();
            thread::spawn(move || {
                let reader = BufReader::new(stdout);
                for line in reader.lines() {
                    if let Ok(line) = line {
                        let timestamp = chrono::Local::now().format("%H:%M:%S").to_string();
                        let log_line = format!("[{}] {}", timestamp, line);
                        
                        let mut procs = processes.lock().unwrap();
                        if let Some(info) = procs.get_mut(&pid) {
                            info.add_log(log_line);
                        }
                    }
                }
            });
        }

        // Spawn thread to read stderr
        if let Some(stderr) = stderr {
            let processes = Arc::clone(&processes);
            let pid = pid.clone();
            thread::spawn(move || {
                let reader = BufReader::new(stderr);
                for line in reader.lines() {
                    if let Ok(line) = line {
                        let timestamp = chrono::Local::now().format("%H:%M:%S").to_string();
                        let log_line = format!("[{}] [ERR] {}", timestamp, line);
                        
                        let mut procs = processes.lock().unwrap();
                        if let Some(info) = procs.get_mut(&pid) {
                            info.add_log(log_line);
                        }
                    }
                }
            });
        }

        Ok(())
    }

    /// Stop a project process
    pub fn stop_project(&self, project_id: &str) -> Result<(), String> {
        let mut procs = self.processes.lock().unwrap();
        
        if let Some(info) = procs.get_mut(project_id) {
            if let Some(ref mut child) = info.child {
                child.kill().map_err(|e| format!("Failed to kill process: {}", e))?;
            }
            info.status = ProcessStatus::Stopped;
            info.child = None;
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
    pub fn is_running(&self, project_id: &str) -> bool {
        self.get_status(project_id) == ProcessStatus::Running
    }

    /// Stop all running processes
    pub fn stop_all(&self) {
        let mut procs = self.processes.lock().unwrap();
        for (_, info) in procs.iter_mut() {
            if let Some(ref mut child) = info.child {
                child.kill().ok();
            }
            info.status = ProcessStatus::Stopped;
            info.child = None;
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
