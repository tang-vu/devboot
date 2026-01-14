// Application constants

// Process Management
export const MAX_LOG_LINES = 1000;
export const POLLING_INTERVAL_MS = 1000;
export const RESTART_DELAY_MS = 2000;
export const MAX_RESTART_ATTEMPTS = 5;

// Toast notifications
export const TOAST_DURATION_DEFAULT = 4000;
export const TOAST_DURATION_ERROR = 6000;

// UI
export const SIDEBAR_WIDTH = 260;
export const MIN_WINDOW_WIDTH = 900;
export const MIN_WINDOW_HEIGHT = 600;

// Keyboard shortcuts
export const SHORTCUTS = {
  ADD_PROJECT: 'Ctrl+N',
  SETTINGS: 'Ctrl+,',
  START: 'Ctrl+Enter',
  STOP: 'Ctrl+.',
  RESTART: 'Ctrl+R',
  CLEAR_LOGS: 'Ctrl+L',
  CLOSE_MODAL: 'Escape',
} as const;

// Status colors
export const STATUS_COLORS = {
  running: '#10b981',
  error: '#ef4444',
  restarting: '#f59e0b',
  stopped: '#6b7280',
} as const;

// File extensions for project detection
export const PROJECT_INDICATORS = {
  python: ['requirements.txt', 'setup.py', 'pyproject.toml', 'Pipfile'],
  node: ['package.json'],
  rust: ['Cargo.toml'],
  go: ['go.mod'],
  docker: ['docker-compose.yml', 'docker-compose.yaml', 'Dockerfile'],
} as const;
