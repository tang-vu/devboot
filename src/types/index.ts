// TypeScript interfaces matching Rust structs

export interface Project {
  id: string;
  name: string;
  path: string;
  commands: string[];
  auto_start: boolean;
  restart_on_crash: boolean;
  enabled: boolean;
  env_vars: Record<string, string>;
}

export interface ProjectOptions {
  autoStart: boolean;
  restartOnCrash: boolean;
}

export interface Settings {
  auto_start_with_windows: boolean;
  theme: string;
  minimize_to_tray: boolean;
  show_notifications: boolean;
}

export interface AppConfig {
  version: string;
  settings: Settings;
  projects: Project[];
}

export type ProcessStatus = 'stopped' | 'running' | 'error' | 'restarting';

// Event payload types
export interface LogPayload {
  project_id: string;
  log: string;
}

// Versioned log protocol. Decimal strings preserve the backend's full u64 range.
export interface LogRecord {
  seq: string;
  log: string;
}

export type LogCaptureError = 'sequence_exhausted';

export interface LogSnapshot {
  session_id: string;
  project_id: string;
  through_seq: string;
  discarded_through: string;
  records: LogRecord[];
  capture_error: LogCaptureError | null;
}

export type LogEvent =
  | { kind: 'append'; session_id: string; project_id: string; record: LogRecord; discarded_through: string }
  | { kind: 'clear'; snapshot: LogSnapshot }
  | { kind: 'error'; session_id: string; project_id: string; error: LogCaptureError };

export interface StatusPayload {
  project_id: string;
  status: ProcessStatus;
}

export interface CrashPayload {
  project_id: string;
  restart_count: number;
  will_restart: boolean;
}

// Detection types
export interface CommandSuggestion {
  command: string;
  description: string;
  is_recommended: boolean;
}

export interface DetectedProjectInfo {
  name: string;
  project_type: string;
  framework: string | null;
  suggestions: CommandSuggestion[];
}
