import type { Settings } from '../../src/types';

export const loadedSettings: Readonly<Settings> = Object.freeze({
    auto_start_with_windows: false,
    theme: 'dark',
    minimize_to_tray: false,
    show_notifications: false,
});

export type BridgeEntry = {
    id: number;
    kind: 'invoke' | 'listen' | 'unlisten' | 'denied';
    command: string;
    args: unknown;
    status: 'pending' | 'resolved' | 'rejected' | 'denied';
    result?: unknown;
    error?: string;
};

let ledger: readonly BridgeEntry[] = [];
let nextId = 0;
const subscribers = new Set<() => void>();
const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
const publish = () => subscribers.forEach(subscriber => subscriber());
export const getLedger = () => ledger;
export const subscribe = (subscriber: () => void) => {
    subscribers.add(subscriber);
    return () => { subscribers.delete(subscriber); };
};

function record(entry: Omit<BridgeEntry, 'id'>) {
    const recorded = { ...entry, id: ++nextId };
    ledger = [...ledger, recorded];
    publish();
    return recorded.id;
}

export function deny(command: string, args?: unknown): never {
    record({ kind: 'denied', command, args: args ?? null, status: 'denied' });
    throw new Error(`Synthetic Settings fixture refuses native or external action: ${command}`);
}

function isSettingsPayload(args: unknown): args is { settings: Settings } {
    if (!args || typeof args !== 'object' || Object.keys(args).join(',') !== 'settings') return false;
    const value = (args as { settings: unknown }).settings;
    if (!value || typeof value !== 'object') return false;
    const settings = value as Settings;
    return Object.keys(value).sort().join(',') === 'auto_start_with_windows,minimize_to_tray,show_notifications,theme'
        && typeof settings.auto_start_with_windows === 'boolean'
        && typeof settings.minimize_to_tray === 'boolean'
        && typeof settings.show_notifications === 'boolean'
        && (settings.theme === 'dark' || settings.theme === 'light');
}

// This module never imports Tauri, reads backend state, or forwards a call.
// Even expected operations are inert promises settled only by fixture buttons.
export async function invoke<T>(command: string, args?: unknown): Promise<T> {
    if (command === 'get_projects' && args === undefined) {
        record({ kind: 'invoke', command, args: null, status: 'resolved', result: [] });
        return [] as T;
    }
    const allowed = command === 'update_settings'
        ? isSettingsPayload(args)
        : ['get_settings', 'enable_auto_start', 'disable_auto_start'].includes(command) && args === undefined;
    if (!allowed) return deny(command, args);
    const id = record({ kind: 'invoke', command, args: args === undefined ? null : structuredClone(args), status: 'pending' });
    return new Promise<T>((resolve, reject) => {
        pending.set(id, { resolve: value => resolve(value as T), reject });
    });
}

export type UnlistenFn = () => void;
export async function listen<T>(event: string, _handler: (event: { payload: T }) => void, options?: unknown): Promise<UnlistenFn> {
    if (!['process-log-v2', 'process-status', 'process-crash'].includes(event) || options !== undefined) {
        return deny(`listen:${event}`, options);
    }
    record({ kind: 'listen', command: event, args: null, status: 'resolved' });
    // Empty projects; these synthetic subscriptions never emit process events.
    return () => { record({ kind: 'unlisten', command: event, args: null, status: 'resolved' }); };
}

export async function open(options?: unknown): Promise<never> {
    return deny('dialog:open', options);
}

export function settle(id: number, outcome: 'resolve' | 'reject') {
    const entry = ledger.find(item => item.id === id);
    const operation = pending.get(id);
    if (!entry || !operation || entry.status !== 'pending') throw new Error(`No pending synthetic operation #${id}`);
    const result = entry.command === 'get_settings' ? { ...loadedSettings } : null;
    const error = `Synthetic ${entry.command} failure`;
    ledger = ledger.map(item => item.id === id ? {
        ...item,
        status: outcome === 'resolve' ? 'resolved' : 'rejected',
        ...(outcome === 'resolve' ? { result } : { error }),
    } : item);
    pending.delete(id);
    publish();
    if (outcome === 'resolve') operation.resolve(result);
    else operation.reject(new Error(error));
}

// The real About UI is present, but cannot open a URL or access the clipboard.
window.open = (...args) => deny('window:open', args);
Object.defineProperty(navigator, 'clipboard', {
    configurable: false,
    value: Object.freeze({ writeText: (text: string) => deny('clipboard:writeText', text) }),
});
