import { useState, useEffect, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { Project, ProjectOptions, Settings, ProcessStatus } from '../types';

// Event payload types
interface LogPayload {
    project_id: string;
    log: string;
}

interface StatusPayload {
    project_id: string;
    status: ProcessStatus;
}

interface CrashPayload {
    project_id: string;
    restart_count: number;
    will_restart: boolean;
}

export function useProjects() {
    const [projects, setProjects] = useState<Project[]>([]);
    const [loading, setLoading] = useState(true);
    const [statuses, setStatuses] = useState<Record<string, ProcessStatus>>({});
    const [logs, setLogs] = useState<Record<string, string[]>>({});
    const readLifetimeRef = useRef<object | null>(null);
    const refreshRevisionRef = useRef(0);
    const statusRevisionsRef = useRef(new Map<string, number>());

    // Load projects from backend
    const loadProjects = useCallback(async () => {
        const lifetime = readLifetimeRef.current;
        if (!lifetime) return;
        const revision = ++refreshRevisionRef.current;
        const isCurrent = () => readLifetimeRef.current === lifetime && refreshRevisionRef.current === revision;

        try {
            const data = await invoke<Project[]>('get_projects');
            if (!isCurrent()) return;
            setProjects(data);
            
            // Initialize statuses for each project
            for (const project of data) {
                const statusRevision = statusRevisionsRef.current.get(project.id) || 0;
                const status = await invoke<string>('get_project_status', { projectId: project.id });
                if (!isCurrent()) return;
                // Only events observed during this read invalidate its status.
                if ((statusRevisionsRef.current.get(project.id) || 0) === statusRevision) {
                    setStatuses(prev => ({ ...prev, [project.id]: status as ProcessStatus }));
                }
                
                // Load existing logs
                const projectLogs = await invoke<string[]>('get_project_logs', { projectId: project.id });
                if (!isCurrent()) return;
                setLogs(prev => ({ ...prev, [project.id]: projectLogs }));
            }
        } catch (error) {
            if (isCurrent()) console.error('Failed to load projects:', error);
        } finally {
            if (isCurrent()) setLoading(false);
        }
    }, []);

    // Setup Tauri event listeners
    useEffect(() => {
        let active = true;
        const unlisteners: UnlistenFn[] = [];
        const reportCleanupError = (error: unknown) => console.error('Failed to remove project listener:', error);
        const dispose = (unlisten: UnlistenFn) => {
            try {
                // Tauri returns a promise at runtime despite the void UnlistenFn type.
                void Promise.resolve(unlisten()).catch(reportCleanupError);
            } catch (error) {
                reportCleanupError(error);
            }
        };
        const cleanup = () => {
            active = false;
            unlisteners.splice(0).forEach(dispose);
        };
        const register = async <T,>(name: string, handler: (payload: T) => void) => {
            const unlisten = await listen<T>(name, event => {
                if (active) handler(event.payload);
            });
            if (active) unlisteners.push(unlisten);
            else dispose(unlisten);
        };

        const setupListeners = async () => {
            try {
                await register<LogPayload>('process-log', ({ project_id, log }) => {
                    setLogs(prev => ({
                        ...prev,
                        [project_id]: [...(prev[project_id] || []), log].slice(-1000), // Keep last 1000 logs
                    }));
                });
                if (!active) return;

                await register<StatusPayload>('process-status', ({ project_id, status }) => {
                    statusRevisionsRef.current.set(project_id, (statusRevisionsRef.current.get(project_id) || 0) + 1);
                    setStatuses(prev => ({ ...prev, [project_id]: status }));
                });
                if (!active) return;

                await register<CrashPayload>('process-crash', ({ project_id, restart_count, will_restart }) => {
                    console.log(`Process ${project_id} crashed. Restart count: ${restart_count}, Will restart: ${will_restart}`);
                });
            } catch (error) {
                const reportError = active;
                cleanup();
                if (reportError) console.error('Failed to set up project listeners:', error);
            }
        };

        void setupListeners();
        return cleanup;
    }, []);

    // Load projects on mount
    useEffect(() => {
        const lifetime = {};
        readLifetimeRef.current = lifetime;
        void loadProjects();
        return () => {
            if (readLifetimeRef.current === lifetime) readLifetimeRef.current = null;
        };
    }, [loadProjects]);

    // Add new project
    const addProject = async (name: string, path: string, commands: string[], options: ProjectOptions, envVars: Record<string, string> = {}) => {
        const project = await invoke<Project>('add_project', { name, path, commands, ...options, envVars });
        setProjects(prev => [...prev, project]);
        setStatuses(prev => ({ ...prev, [project.id]: 'stopped' }));
        setLogs(prev => ({ ...prev, [project.id]: [] }));
        return project;
    };

    // Update project
    const updateProject = async (project: Project) => {
        await invoke('update_project', { project });
        setProjects(prev => prev.map(p => p.id === project.id ? project : p));
    };

    // Delete project
    const deleteProject = async (projectId: string) => {
        await invoke('delete_project', { projectId });
        setProjects(prev => prev.filter(p => p.id !== projectId));
        setStatuses(prev => {
            const newStatuses = { ...prev };
            delete newStatuses[projectId];
            return newStatuses;
        });
        setLogs(prev => {
            const newLogs = { ...prev };
            delete newLogs[projectId];
            return newLogs;
        });
    };

    // Start project
    const startProject = async (projectId: string) => {
        await invoke('start_project', { projectId });
        // Status will be updated via event
    };

    // Stop project
    const stopProject = async (projectId: string) => {
        await invoke('stop_project', { projectId });
        // Status will be updated via event
    };

    // Restart project
    const restartProject = async (projectId: string) => {
        setStatuses(prev => ({ ...prev, [projectId]: 'restarting' }));
        await invoke('restart_project', { projectId });
        // Status will be updated via event
    };

    // Clear logs
    const clearLogs = async (projectId: string) => {
        await invoke('clear_project_logs', { projectId });
        setLogs(prev => ({ ...prev, [projectId]: [] }));
    };

    return {
        projects,
        loading,
        statuses,
        logs,
        addProject,
        updateProject,
        deleteProject,
        startProject,
        stopProject,
        restartProject,
        clearLogs,
        refreshProjects: loadProjects,
    };
}

export function useSettings() {
    const [settings, setSettings] = useState<Settings>({
        auto_start_with_windows: true,
        theme: 'dark',
        minimize_to_tray: true,
        show_notifications: true,
    });

    const loadSettings = useCallback(async () => {
        try {
            const data = await invoke<Settings>('get_settings');
            setSettings(data);
        } catch (error) {
            console.error('Failed to load settings:', error);
        }
    }, []);

    const updateSettings = async (newSettings: Settings) => {
        await invoke('update_settings', { settings: newSettings });
        setSettings(newSettings);

        // Handle auto-start setting
        if (newSettings.auto_start_with_windows) {
            await invoke('enable_auto_start');
        } else {
            await invoke('disable_auto_start');
        }
    };

    useEffect(() => {
        loadSettings();
    }, [loadSettings]);

    return { settings, updateSettings };
}
