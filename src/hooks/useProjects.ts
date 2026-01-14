import { useState, useEffect, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { Project, Settings, ProcessStatus } from '../types';

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
    const unlistenRefs = useRef<UnlistenFn[]>([]);

    // Load projects from backend
    const loadProjects = useCallback(async () => {
        try {
            const data = await invoke<Project[]>('get_projects');
            setProjects(data);
            
            // Initialize statuses for each project
            for (const project of data) {
                const status = await invoke<string>('get_project_status', { projectId: project.id });
                setStatuses(prev => ({ ...prev, [project.id]: status as ProcessStatus }));
                
                // Load existing logs
                const projectLogs = await invoke<string[]>('get_project_logs', { projectId: project.id });
                setLogs(prev => ({ ...prev, [project.id]: projectLogs }));
            }
        } catch (error) {
            console.error('Failed to load projects:', error);
        } finally {
            setLoading(false);
        }
    }, []);

    // Setup Tauri event listeners
    useEffect(() => {
        const setupListeners = async () => {
            // Listen for log events
            const unlistenLog = await listen<LogPayload>('process-log', (event) => {
                const { project_id, log } = event.payload;
                setLogs(prev => ({
                    ...prev,
                    [project_id]: [...(prev[project_id] || []), log].slice(-1000), // Keep last 1000 logs
                }));
            });

            // Listen for status events
            const unlistenStatus = await listen<StatusPayload>('process-status', (event) => {
                const { project_id, status } = event.payload;
                setStatuses(prev => ({ ...prev, [project_id]: status }));
            });

            // Listen for crash events
            const unlistenCrash = await listen<CrashPayload>('process-crash', (event) => {
                const { project_id, restart_count, will_restart } = event.payload;
                console.log(`Process ${project_id} crashed. Restart count: ${restart_count}, Will restart: ${will_restart}`);
            });

            unlistenRefs.current = [unlistenLog, unlistenStatus, unlistenCrash];
        };

        setupListeners();

        // Cleanup listeners on unmount
        return () => {
            unlistenRefs.current.forEach(unlisten => unlisten());
        };
    }, []);

    // Load projects on mount
    useEffect(() => {
        loadProjects();
    }, [loadProjects]);

    // Add new project
    const addProject = async (name: string, path: string, commands: string[]) => {
        const project = await invoke<Project>('add_project', { name, path, commands });
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
