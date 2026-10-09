import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import type { Project, ProjectOptions, Settings, ProcessStatus, LogEvent, LogSnapshot } from '../types';
import { emptyProjectLogs, receiveLogEvent, receiveLogSnapshot } from './projectLogs';
import type { ProjectLogs } from './projectLogs';

interface StatusPayload { project_id: string; status: ProcessStatus }
interface CrashPayload { project_id: string; restart_count: number; will_restart: boolean }

export function useProjects() {
    const [projects, setProjects] = useState<Project[]>([]);
    const [loading, setLoading] = useState(true);
    const [statuses, setStatuses] = useState<Record<string, ProcessStatus>>({});
    const [logStates, setLogStates] = useState<Record<string, ProjectLogs>>({});
    const [logListenerFailed, setLogListenerFailed] = useState(false);
    const [logReadErrors, setLogReadErrors] = useState<Record<string, boolean>>({});
    const logStatesRef = useRef<Record<string, ProjectLogs>>({});
    const replaceLogStates = useCallback((next: Record<string, ProjectLogs>) => {
        logStatesRef.current = next;
        setLogStates(next);
    }, []);
    const updateLogs = useCallback((id: string, update: (state: ProjectLogs) => ProjectLogs) => {
        const next = update(logStatesRef.current[id] ?? emptyProjectLogs());
        replaceLogStates({ ...logStatesRef.current, [id]: next });
        return next;
    }, [replaceLogStates]);
    const readLifetimeRef = useRef<object | null>(null);
    const refreshRevisionRef = useRef(0);
    const statusRevisionsRef = useRef(new Map<string, number>());
    const knownProjectsRef = useRef<Set<string> | null>(null);
    const retiredProjectsRef = useRef(new Set<string>());
    const logReadyRef = useRef<Promise<void>>(Promise.resolve());
    const acceptsProject = useCallback((id: string) => !retiredProjectsRef.current.has(id)
        && (knownProjectsRef.current === null || knownProjectsRef.current.has(id)), []);

    const logs = useMemo(() => Object.fromEntries(Object.entries(logStates)
        .map(([id, state]) => [id, state.records.map(record => record.log)])), [logStates]);
    const logViews = useMemo(() => Object.fromEntries(Object.entries(logStates)
        .map(([id, state]) => [id, { records: state.records, sessionId: state.sessionId }])), [logStates]);
    const logErrors = useMemo(() => Object.fromEntries(projects.map(project => [project.id,
        logStates[project.id]?.captureError
            ? 'Log capture stopped because its sequence limit was reached. Relaunch DevBoot to resume capture.'
            : logListenerFailed ? 'Live log updates are unavailable. Reopen DevBoot to reconnect; refresh can reload retained history.'
                : logStates[project.id]?.needsSnapshot ? 'Some live logs could not be reconciled. Reload to recover retained history.'
                    : logReadErrors[project.id] ? 'Log history could not be loaded. Reload logs to try again.' : null,
    ])), [projects, logStates, logListenerFailed, logReadErrors]);

    const hydrateProjectLogs = useCallback(async (id: string, isCurrent: () => boolean) => {
        try {
            const snapshot = await invoke<LogSnapshot>('get_project_log_snapshot', { projectId: id });
            if (!isCurrent() || !acceptsProject(id)) return;
            const next = updateLogs(id, state => receiveLogSnapshot(state, snapshot));
            setLogReadErrors(prev => ({ ...prev, [id]: false }));
            if (next.needsSnapshot) {
                // A capped unknown-session buffer evicted events. Now that the
                // session is bound, one fresh read recovers that interval while
                // new events merge directly. This is recovery, not polling.
                const fresh = await invoke<LogSnapshot>('get_project_log_snapshot', { projectId: id });
                if (isCurrent() && acceptsProject(id)) updateLogs(id, state => receiveLogSnapshot(state, fresh));
            }
        } catch (error) {
            if (isCurrent() && acceptsProject(id)) {
                setLogReadErrors(prev => ({ ...prev, [id]: true }));
                console.error('Failed to load project logs:', error);
            }
        }
    }, [acceptsProject, updateLogs]);

    const loadProjects = useCallback(async () => {
        const lifetime = readLifetimeRef.current;
        if (!lifetime) return;
        const revision = ++refreshRevisionRef.current;
        const ready = logReadyRef.current;
        const isCurrent = () => readLifetimeRef.current === lifetime && refreshRevisionRef.current === revision;
        try {
            const data = await invoke<Project[]>('get_projects');
            if (!isCurrent()) return;
            // A snapshot dispatched before a successful deletion cannot restore it.
            const current = data.filter(project => !retiredProjectsRef.current.has(project.id));
            knownProjectsRef.current = new Set(current.map(project => project.id));
            setProjects(current);
            replaceLogStates(Object.fromEntries(Object.entries(logStatesRef.current).filter(([id]) => acceptsProject(id))));
            setLogReadErrors(prev => Object.fromEntries(Object.entries(prev).filter(([id]) => acceptsProject(id))));

            // Only log hydration waits for observation. Project/status loading
            // still finishes if listener registration remains pending or fails.
            const hydrateLogs = async () => {
                await ready;
                if (!isCurrent()) return;
                await Promise.all(current.filter(project => acceptsProject(project.id))
                    .map(project => hydrateProjectLogs(project.id, isCurrent)));
            };
            void hydrateLogs();
            await Promise.all(current.map(async project => {
                const statusRevision = statusRevisionsRef.current.get(project.id) || 0;
                const status = await invoke<ProcessStatus>('get_project_status', { projectId: project.id });
                if (!isCurrent() || !acceptsProject(project.id)) return;
                if ((statusRevisionsRef.current.get(project.id) || 0) === statusRevision) {
                    setStatuses(prev => ({ ...prev, [project.id]: status }));
                }
            }));
        } catch (error) {
            if (isCurrent()) console.error('Failed to load projects:', error);
        } finally {
            if (isCurrent()) setLoading(false);
        }
    }, [acceptsProject, hydrateProjectLogs, replaceLogStates]);

    useEffect(() => {
        let active = true;
        let ready!: () => void;
        logReadyRef.current = new Promise<void>(resolve => { ready = resolve; });
        setLogListenerFailed(false);
        const unlisteners: UnlistenFn[] = [];
        const reportCleanupError = (error: unknown) => console.error('Failed to remove project listener:', error);
        const dispose = (unlisten: UnlistenFn) => {
            try { void Promise.resolve(unlisten()).catch(reportCleanupError); }
            catch (error) { reportCleanupError(error); }
        };
        const cleanup = () => {
            active = false;
            ready();
            unlisteners.splice(0).forEach(dispose);
        };
        const register = async <T,>(name: string, handler: (payload: T) => void) => {
            const unlisten = await listen<T>(name, event => { if (active) handler(event.payload); });
            if (active) unlisteners.push(unlisten);
            else dispose(unlisten);
        };
        const setupListeners = async () => {
            try {
                await register<LogEvent>('process-log-v2', event => {
                    const id = event.kind === 'clear' ? event.snapshot.project_id : event.project_id;
                    if (!acceptsProject(id)) return;
                    updateLogs(id, state => receiveLogEvent(state, event));
                });
                ready();
                if (!active) return;
                await register<StatusPayload>('process-status', ({ project_id, status }) => {
                    if (!acceptsProject(project_id)) return;
                    statusRevisionsRef.current.set(project_id, (statusRevisionsRef.current.get(project_id) || 0) + 1);
                    setStatuses(prev => ({ ...prev, [project_id]: status }));
                });
                if (!active) return;
                await register<CrashPayload>('process-crash', ({ project_id, restart_count, will_restart }) => {
                    if (acceptsProject(project_id)) console.log(`Process ${project_id} crashed. Restart count: ${restart_count}, Will restart: ${will_restart}`);
                });
            } catch (error) {
                const reportError = active;
                cleanup();
                if (reportError) {
                    setLogListenerFailed(true);
                    console.error('Failed to set up project listeners:', error);
                }
            }
        };
        void setupListeners();
        return cleanup;
    }, [acceptsProject, updateLogs]);

    useEffect(() => {
        const lifetime = {};
        readLifetimeRef.current = lifetime;
        void loadProjects();
        return () => { if (readLifetimeRef.current === lifetime) readLifetimeRef.current = null; };
    }, [loadProjects]);

    const addProject = async (name: string, path: string, commands: string[], options: ProjectOptions, envVars: Record<string, string> = {}) => {
        const project = await invoke<Project>('add_project', { name, path, commands, ...options, envVars });
        knownProjectsRef.current?.add(project.id);
        setProjects(prev => [...prev, project]);
        setStatuses(prev => ({ ...prev, [project.id]: 'stopped' }));
        updateLogs(project.id, () => emptyProjectLogs());
        const lifetime = readLifetimeRef.current;
        const revision = refreshRevisionRef.current;
        void logReadyRef.current.then(() => {
            if (lifetime && readLifetimeRef.current === lifetime && refreshRevisionRef.current === revision) {
                return hydrateProjectLogs(project.id, () => readLifetimeRef.current === lifetime && refreshRevisionRef.current === revision);
            }
        });
        return project;
    };
    const updateProject = async (project: Project) => {
        await invoke('update_project', { project });
        setProjects(prev => prev.map(p => p.id === project.id ? project : p));
    };
    const deleteProject = async (projectId: string) => {
        await invoke('delete_project', { projectId });
        retiredProjectsRef.current.add(projectId);
        knownProjectsRef.current?.delete(projectId);
        setProjects(prev => prev.filter(p => p.id !== projectId));
        setStatuses(prev => { const next = { ...prev }; delete next[projectId]; return next; });
        const next = { ...logStatesRef.current }; delete next[projectId]; replaceLogStates(next);
        setLogReadErrors(prev => { const next = { ...prev }; delete next[projectId]; return next; });
    };
    const startProject = async (projectId: string) => { await invoke('start_project', { projectId }); };
    const stopProject = async (projectId: string) => { await invoke('stop_project', { projectId }); };
    const restartProject = async (projectId: string) => {
        setStatuses(prev => ({ ...prev, [projectId]: 'restarting' }));
        await invoke('restart_project', { projectId });
    };
    const clearLogs = async (projectId: string) => {
        const lifetime = readLifetimeRef.current;
        const snapshot = await invoke<LogSnapshot>('clear_project_log_snapshot', { projectId });
        if (!lifetime || readLifetimeRef.current !== lifetime || !acceptsProject(projectId)) return;
        updateLogs(projectId, state => receiveLogEvent(state, { kind: 'clear', snapshot }));
    };
    return { projects, loading, statuses, logs, logViews, logErrors, addProject, updateProject, deleteProject,
        startProject, stopProject, restartProject, clearLogs, refreshProjects: loadProjects };
}

export function useSettings() {
    const [settings, setSettings] = useState<Settings | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [savingSettings, setSavingSettings] = useState<Settings | null>(null);
    const [saveError, setSaveError] = useState<string | null>(null);
    const [startupError, setStartupError] = useState<string | null>(null);
    const [failedSettings, setFailedSettings] = useState<Settings | null>(null);
    const lifetimeRef = useRef<object | null>(null);
    const readRevisionRef = useRef(0);
    const savingRef = useRef(false);

    const loadSettings = useCallback(async () => {
        const lifetime = lifetimeRef.current;
        if (!lifetime || savingRef.current) return;
        const revision = ++readRevisionRef.current;
        const isCurrent = () => lifetimeRef.current === lifetime && readRevisionRef.current === revision;
        setLoading(true);
        setLoadError(null);
        try {
            const data = await invoke<Settings>('get_settings');
            if (isCurrent()) setSettings(data);
        } catch (error) {
            if (isCurrent()) setLoadError(`Settings could not be loaded. Retry to edit your preferences. ${error}`);
        } finally {
            if (isCurrent()) setLoading(false);
        }
    }, []);

    const updateSettings = async (newSettings: Settings) => {
        if (!settings || loading) throw new Error('Load settings before saving.');
        if (savingRef.current) throw new Error('A settings save is already in progress.');
        const lifetime = lifetimeRef.current;
        const draft = { ...newSettings };
        savingRef.current = true;
        ++readRevisionRef.current;
        setSavingSettings(draft);
        setSaveError(null);
        setFailedSettings(null);
        let preferencesSaved = false;
        try {
            await invoke('update_settings', { settings: draft });
            preferencesSaved = true;
            // The preferences are persisted even if the subsequent startup action fails.
            if (lifetimeRef.current === lifetime) setSettings(draft);
            await invoke(draft.auto_start_with_windows ? 'enable_auto_start' : 'disable_auto_start');
            if (lifetimeRef.current === lifetime) setStartupError(null);
        } catch (error) {
            const message = preferencesSaved
                ? `Preferences were saved, but the Windows startup update was not confirmed. Retry Save Changes to apply your startup choice. ${error}`
                : `Settings save was not confirmed. These are your attempted changes; retry Save Changes or Cancel to discard them. ${error}`;
            if (lifetimeRef.current === lifetime) {
                if (preferencesSaved) setStartupError(message);
                else {
                    setSaveError(message);
                    setFailedSettings(draft);
                }
            }
            throw new Error(message);
        } finally {
            savingRef.current = false;
            if (lifetimeRef.current === lifetime) setSavingSettings(null);
        }
    };

    useEffect(() => {
        const lifetime = {};
        lifetimeRef.current = lifetime;
        void loadSettings();
        return () => { if (lifetimeRef.current === lifetime) lifetimeRef.current = null; };
    }, [loadSettings]);

    const dismissSaveError = useCallback(() => {
        if (savingRef.current) return;
        setSaveError(null);
        setFailedSettings(null);
    }, []);

    return { settings, loading, loadError, savingSettings, failedSettings, saveError, startupError, updateSettings,
        retryLoad: loadSettings, dismissSaveError };
}
