import type { DetectedProjectInfo, Project, Settings } from '../../src/types';

export const syntheticPaths = Object.freeze({
    A: 'C:\\Synthetic\\ProjectA',
    B: 'C:\\Synthetic\\ProjectB',
    Empty: 'C:\\Synthetic\\Empty',
    Short: 'C:\\A',
    Trailing: 'C:\\Synthetic\\Trailing\\',
    DropA: 'synthetic-drop-a',
    DropB: 'synthetic-drop-b',
});

const settings: Settings = {
    auto_start_with_windows: false, theme: 'dark', minimize_to_tray: false, show_notifications: false,
};

export type BridgeEntry = {
    id: number;
    kind: 'invoke' | 'picker' | 'listen' | 'unlisten' | 'denied';
    command: string;
    args: unknown;
    status: 'pending' | 'resolved' | 'rejected' | 'denied';
    result?: unknown;
    error?: string;
};

type AddPayload = {
    name: string; path: string; commands: string[]; autoStart: boolean;
    restartOnCrash: boolean; envVars: Record<string, string>;
};

let entries: readonly BridgeEntry[] = [];
let projects: Project[] = [];
let nextId = 0;
const subscribers = new Set<() => void>();
const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
const publish = () => subscribers.forEach(subscriber => subscriber());
export const getLedger = () => entries;
export const subscribe = (subscriber: () => void) => {
    subscribers.add(subscriber);
    return () => { subscribers.delete(subscriber); };
};

function record(entry: Omit<BridgeEntry, 'id'>) {
    const id = ++nextId;
    entries = [...entries, { ...entry, id }];
    publish();
    return id;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function keysAre(value: unknown, keys: string[]): value is Record<string, unknown> {
    return isRecord(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
}

function isSyntheticPath(value: unknown): value is string {
    return typeof value === 'string' && Object.values(syntheticPaths).some(path => path === value);
}

function isCommands(value: unknown): value is string[] {
    return Array.isArray(value) && value.every(command => typeof command === 'string');
}

function isEnvironment(value: unknown): value is Record<string, string> {
    return isRecord(value) && Object.values(value).every(item => typeof item === 'string');
}

function isAddPayload(value: unknown): value is AddPayload {
    return keysAre(value, ['name', 'path', 'commands', 'autoStart', 'restartOnCrash', 'envVars'])
        && typeof value.name === 'string' && isSyntheticPath(value.path) && isCommands(value.commands)
        && typeof value.autoStart === 'boolean' && typeof value.restartOnCrash === 'boolean'
        && isEnvironment(value.envVars);
}

function isProject(value: unknown): value is Project {
    return keysAre(value, ['id', 'name', 'path', 'commands', 'auto_start', 'restart_on_crash', 'enabled', 'env_vars'])
        && projects.some(project => project.id === value.id)
        && typeof value.name === 'string' && isSyntheticPath(value.path) && isCommands(value.commands)
        && typeof value.auto_start === 'boolean' && typeof value.restart_on_crash === 'boolean'
        && typeof value.enabled === 'boolean' && isEnvironment(value.env_vars);
}

export function deny(command: string, args?: unknown): never {
    record({ kind: 'denied', command, args: args ?? null, status: 'denied' });
    throw new Error(`Synthetic project fixture refuses native or external action: ${command}`);
}

function hold<T>(kind: 'invoke' | 'picker', command: string, args: unknown): Promise<T> {
    const id = record({ kind, command, args: structuredClone(args), status: 'pending' });
    return new Promise<T>((resolve, reject) => {
        pending.set(id, { resolve: value => resolve(value as T), reject });
    });
}

// No Tauri imports, backend state, real filesystem paths, or forwarded calls.
// Reads return fixture-owned data; mutations remain held until native UI controls settle them.
export async function invoke<T>(command: string, args?: unknown): Promise<T> {
    if (['get_projects', 'get_settings'].includes(command) && args === undefined) {
        const result = structuredClone(command === 'get_projects' ? projects : settings);
        record({ kind: 'invoke', command, args: null, status: 'resolved', result });
        return result as T;
    }
    if (['get_project_status', 'get_project_log_snapshot'].includes(command)
        && keysAre(args, ['projectId']) && projects.some(project => project.id === args.projectId)) {
        const result = command === 'get_project_status' ? 'stopped' : {
            project_id: args.projectId, session_id: 'synthetic-project-session', through_seq: '0',
            discarded_through: '0', records: [], capture_error: null,
        };
        record({ kind: 'invoke', command, args: structuredClone(args), status: 'resolved', result });
        return result as T;
    }
    const allowed = command === 'detect_project_from_path'
        ? keysAre(args, ['path']) && isSyntheticPath(args.path)
        : command === 'add_project' ? isAddPayload(args)
            : command === 'update_project' && keysAre(args, ['project']) && isProject(args.project);
    if (!allowed) return deny(command, args);
    return hold<T>('invoke', command, args);
}

export type UnlistenFn = () => void;
export async function listen<T>(event: string, _handler: (event: { payload: T }) => void, options?: unknown): Promise<UnlistenFn> {
    if (!['process-log-v2', 'process-status', 'process-crash'].includes(event) || options !== undefined) {
        return deny(`listen:${event}`, options);
    }
    record({ kind: 'listen', command: event, args: null, status: 'resolved' });
    return () => { record({ kind: 'unlisten', command: event, args: null, status: 'resolved' }); };
}

export async function open(options?: unknown): Promise<string | null> {
    if (!keysAre(options, ['directory', 'multiple', 'title'])
        || options.directory !== true || options.multiple !== false || options.title !== 'Select Project Folder') {
        return deny('dialog:open', options);
    }
    return hold('picker', 'dialog:open', options);
}

function detectionResult(entry: BridgeEntry): DetectedProjectInfo {
    const path = (entry.args as { path: string }).path;
    const label = Object.entries(syntheticPaths).find(([, candidate]) => candidate === path)![0];
    return {
        name: `Synthetic ${label} #${entry.id}`,
        project_type: `Synthetic ${label}`,
        framework: `Fixture #${entry.id}`,
        suggestions: label === 'Empty' ? [] : [
            { command: `echo ${label}-${entry.id}-recommended`, description: 'Synthetic recommended command', is_recommended: true },
            { command: `echo ${label}-${entry.id}-optional`, description: 'Synthetic optional command', is_recommended: false },
        ],
    };
}

export function settle(id: number, outcome: 'resolve' | 'reject' | 'cancel', pickerPath?: string) {
    const entry = entries.find(item => item.id === id);
    const operation = pending.get(id);
    if (!entry || !operation || entry.status !== 'pending') throw new Error(`No pending synthetic operation #${id}`);
    if (outcome === 'cancel' && entry.kind !== 'picker') throw new Error('Only a picker can be cancelled');
    if (entry.kind === 'picker' && outcome === 'resolve' && !isSyntheticPath(pickerPath)) {
        throw new Error('Picker results must use a declared synthetic path');
    }
    let result: unknown = null;
    if (outcome === 'resolve') {
        if (entry.kind === 'picker') result = pickerPath;
        else if (entry.command === 'detect_project_from_path') result = detectionResult(entry);
        else if (entry.command === 'add_project') {
            const args = entry.args as AddPayload;
            const project: Project = {
                id: `synthetic-project-${entry.id}`, name: args.name, path: args.path,
                commands: [...args.commands], auto_start: args.autoStart, restart_on_crash: args.restartOnCrash,
                enabled: true, env_vars: { ...args.envVars },
            };
            projects = [...projects, project];
            result = project;
        } else if (entry.command === 'update_project') {
            const project = (entry.args as { project: Project }).project;
            projects = projects.map(current => current.id === project.id ? structuredClone(project) : current);
        }
    }
    const error = `Synthetic ${entry.command} failure #${entry.id}`;
    entries = entries.map(item => item.id === id ? {
        ...item, status: outcome === 'reject' ? 'rejected' : 'resolved',
        ...(outcome === 'reject' ? { error } : { result }),
    } : item);
    pending.delete(id);
    publish();
    if (outcome === 'reject') operation.reject(new Error(error));
    else operation.resolve(result);
}

window.open = (...args) => deny('window:open', args);
Object.defineProperty(navigator, 'clipboard', {
    configurable: false,
    value: Object.freeze({
        read: () => deny('clipboard:read'), readText: () => deny('clipboard:readText'),
        write: (data: unknown) => deny('clipboard:write', data), writeText: (text: string) => deny('clipboard:writeText', text),
    }),
});
