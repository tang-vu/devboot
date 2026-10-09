import type { LogSnapshot, Project, Settings } from '../../src/types';

export type BridgeEntry = {
    id: number;
    kind: 'invoke' | 'listen' | 'unlisten' | 'denied';
    command: string;
    args: unknown;
    status: 'pending' | 'resolved' | 'rejected' | 'denied';
    result?: unknown;
    error?: string;
};

const settings: Settings = {
    auto_start_with_windows: false, theme: 'dark', minimize_to_tray: false, show_notifications: false,
};
const project: Project = {
    id: 'synthetic-project', name: 'Synthetic project', path: 'C:\\Synthetic\\Project',
    commands: ['echo synthetic'], auto_start: false, restart_on_crash: false,
    enabled: true, env_vars: {},
};
const newerProject: Project = { ...project, id: 'synthetic-newer', name: 'Newer synthetic project' };
const allowedIds = new Set([project.id, newerProject.id]);
let entries: readonly BridgeEntry[] = [];
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

export function deny(command: string, args?: unknown): never {
    record({ kind: 'denied', command, args: args ?? null, status: 'denied' });
    throw new Error(`Read-only project-loading fixture refuses: ${command}`);
}

function validProjectArgs(value: unknown): value is { projectId: string } {
    return value !== null && typeof value === 'object'
        && Object.keys(value).join(',') === 'projectId'
        && allowedIds.has((value as { projectId: string }).projectId);
}

// Every permitted read is synthetic. Nothing imports or forwards a native API.
export async function invoke<T>(command: string, args?: unknown): Promise<T> {
    if (command === 'get_settings' && args === undefined) {
        record({ kind: 'invoke', command, args: null, status: 'resolved', result: settings });
        return structuredClone(settings) as T;
    }
    if (!((command === 'get_projects' && args === undefined)
        || (['get_project_status', 'get_project_log_snapshot'].includes(command) && validProjectArgs(args)))) {
        return deny(command, args);
    }
    const id = record({ kind: 'invoke', command, args: args ?? null, status: 'pending' });
    return new Promise<T>((resolve, reject) => pending.set(id, { resolve: value => resolve(value as T), reject }));
}

export type UnlistenFn = () => void;
export async function listen<T>(event: string, _handler: (event: { payload: T }) => void, options?: unknown): Promise<UnlistenFn> {
    if (!['process-log-v2', 'process-status', 'process-crash'].includes(event) || options !== undefined) {
        return deny(`listen:${event}`, options);
    }
    record({ kind: 'listen', command: event, args: null, status: 'resolved' });
    return () => { record({ kind: 'unlisten', command: event, args: null, status: 'resolved' }); };
}
export async function open(options?: unknown): Promise<never> { return deny('dialog:open', options); }

export function settle(id: number, outcome: 'resolve' | 'reject' | 'reject-long' | 'empty' | 'newer' | 'history-warning') {
    const entry = entries.find(item => item.id === id);
    const operation = pending.get(id);
    if (!entry || !operation || entry.status !== 'pending') throw new Error(`No pending read #${id}`);
    if (outcome === 'history-warning' && entry.command !== 'get_project_log_snapshot') {
        throw new Error('Only a log snapshot supports a synthetic capture warning');
    }
    if (['empty', 'newer', 'reject-long'].includes(outcome) && entry.command !== 'get_projects') {
        throw new Error('Only a project-list read supports alternate synthetic lists');
    }
    const snapshot: LogSnapshot = {
        project_id: (entry.args as { projectId?: string } | null)?.projectId ?? project.id,
        session_id: 'synthetic-session', through_seq: '121', discarded_through: '0',
        records: [
            ...Array.from({ length: 120 }, (_, index) => ({ seq: String(index + 1), log: `Synthetic history row ${index + 1}` })),
            { seq: '121', log: 'Synthetic retained output' },
        ], capture_error: outcome === 'history-warning' ? 'sequence_exhausted' : null,
    };
    const result = entry.command === 'get_projects'
        ? outcome === 'empty' ? [] : [outcome === 'newer' ? newerProject : project]
        : entry.command === 'get_project_status' ? 'running' : snapshot;
    const rejected = outcome === 'reject' || outcome === 'reject-long';
    const error = `Synthetic ${entry.command} failure #${id}${outcome === 'reject-long'
        ? `: ${'synthetic-catalog-detail-without-breaks-'.repeat(80)}` : ''}`;
    entries = entries.map(item => item.id === id ? {
        ...item, status: rejected ? 'rejected' : 'resolved',
        ...(rejected ? { error } : { result }),
    } : item);
    pending.delete(id);
    publish();
    if (rejected) operation.reject(new Error(error));
    else operation.resolve(structuredClone(result));
}

window.open = (...args) => deny('window:open', args);
URL.createObjectURL = (...args) => deny('download:createObjectURL', args);
Object.defineProperty(navigator, 'clipboard', {
    configurable: false,
    value: Object.freeze({
        read: () => deny('clipboard:read'), readText: () => deny('clipboard:readText'),
        write: (data: unknown) => deny('clipboard:write', data), writeText: (text: string) => deny('clipboard:writeText', text),
    }),
});
