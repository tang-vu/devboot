import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Project, Settings, ProcessStatus } from '../types';

export function useProjects() {
    const [projects, setProjects] = useState<Project[]>([]);
    const [loading, setLoading] = useState(true);
    const [statuses, setStatuses] = useState<Record<string, ProcessStatus>>({});
    const [logs, setLogs] = useState<Record<string, string[]>>({});

    // Load projects from backend
    const loadProjects = useCallback(async () => {
        try {
            const data = await invoke<Project[]>('get_projects');
            setProjects(data);
        } catch (error) {
            console.error('Failed to load projects:', error);
        } finally {
            setLoading(false);
        }
    }, []);

    // Add new project
    const addProject = async (name: string, path: string, commands: string[]) => {
        try {
            const project = await invoke<Project>('add_project', { name, path, commands });
            setProjects(prev => [...prev, project]);
            return project;
        } catch (error) {
            console.error('Failed to add project:', error);
            throw error;
        }
    };

    // Update project
    const updateProject = async (project: Project) => {
        try {
            await invoke('update_project', { project });
            setProjects(prev => prev.map(p => p.id === project.id ? project : p));
        } catch (error) {
            console.error('Failed to update project:', error);
            throw error;
        }
    };

    // Delete project
    const deleteProject = async (projectId: string) => {
        try {
            await invoke('delete_project', { projectId });
            setProjects(prev => prev.filter(p => p.id !== projectId));
        } catch (error) {
            console.error('Failed to delete project:', error);
            throw error;
        }
    };

    // Start project
    const startProject = async (projectId: string) => {
        try {
            await invoke('start_project', { projectId });
            setStatuses(prev => ({ ...prev, [projectId]: 'running' }));
        } catch (error) {
            console.error('Failed to start project:', error);
            setStatuses(prev => ({ ...prev, [projectId]: 'error' }));
            throw error;
        }
    };

    // Stop project
    const stopProject = async (projectId: string) => {
        try {
            await invoke('stop_project', { projectId });
            setStatuses(prev => ({ ...prev, [projectId]: 'stopped' }));
        } catch (error) {
            console.error('Failed to stop project:', error);
            throw error;
        }
    };

    // Restart project
    const restartProject = async (projectId: string) => {
        try {
            setStatuses(prev => ({ ...prev, [projectId]: 'restarting' }));
            await invoke('restart_project', { projectId });
            setStatuses(prev => ({ ...prev, [projectId]: 'running' }));
        } catch (error) {
            console.error('Failed to restart project:', error);
            throw error;
        }
    };

    // Get project status
    const getStatus = async (projectId: string) => {
        try {
            const status = await invoke<string>('get_project_status', { projectId });
            setStatuses(prev => ({ ...prev, [projectId]: status as ProcessStatus }));
            return status as ProcessStatus;
        } catch (error) {
            return 'stopped' as ProcessStatus;
        }
    };

    // Get project logs
    const getLogs = async (projectId: string) => {
        try {
            const projectLogs = await invoke<string[]>('get_project_logs', { projectId });
            setLogs(prev => ({ ...prev, [projectId]: projectLogs }));
            return projectLogs;
        } catch (error) {
            return [];
        }
    };

    // Clear logs
    const clearLogs = async (projectId: string) => {
        try {
            await invoke('clear_project_logs', { projectId });
            setLogs(prev => ({ ...prev, [projectId]: [] }));
        } catch (error) {
            console.error('Failed to clear logs:', error);
        }
    };

    // Poll for status and logs updates
    useEffect(() => {
        loadProjects();
    }, [loadProjects]);

    useEffect(() => {
        const interval = setInterval(async () => {
            for (const project of projects) {
                await getStatus(project.id);
                await getLogs(project.id);
            }
        }, 1000);

        return () => clearInterval(interval);
    }, [projects]);

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
        try {
            await invoke('update_settings', { settings: newSettings });
            setSettings(newSettings);

            // Handle auto-start setting
            if (newSettings.auto_start_with_windows) {
                await invoke('enable_auto_start');
            } else {
                await invoke('disable_auto_start');
            }
        } catch (error) {
            console.error('Failed to update settings:', error);
            throw error;
        }
    };

    useEffect(() => {
        loadSettings();
    }, [loadSettings]);

    return { settings, updateSettings };
}
