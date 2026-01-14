// TypeScript interfaces matching Rust structs

export interface Project {
  id: string;
  name: string;
  path: string;
  commands: string[];
  auto_start: boolean;
  restart_on_crash: boolean;
  enabled: boolean;
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
