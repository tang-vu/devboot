import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { emptyProjectLogs, receiveLogEvent, receiveLogSnapshot } from '../src/hooks/projectLogs';
import { useProjects } from '../src/hooks/useProjects';
import type { LogEvent, LogSnapshot } from '../src/types';

const bridge = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: bridge.invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: bridge.listen }));
const pid = 'synthetic-buffer-cap';
const snapshot = (session = 'A', through = '0', text?: string): LogSnapshot => ({
    session_id: session, project_id: pid, through_seq: through, discarded_through: '0',
    records: text ? [{ seq: through, log: text }] : [], capture_error: null,
});
const event = (session = 'A', seq = '1', log = 'live'): LogEvent => ({
    kind: 'append', session_id: session, project_id: pid,
    record: { seq, log }, discarded_through: '0',
});

it('bounds unknown-session buckets and their individual histories', () => {
    let state = emptyProjectLogs();
    for (const session of ['A', 'B', 'C', 'D', 'E']) {
        for (let i = 1; i <= 1005; i++) state = receiveLogEvent(state, event(session, String(i)));
    }
    expect(state.pending.size).toBe(2);
    expect([...state.pending.values()].map(stream => stream.records.length)).toEqual([1000, 1000]);
    expect(state.pendingOverflow).toBe(true);
    expect(state.sessionId).toBeNull();
    expect(state.records).toEqual([]);
});

it('marks evicted bootstrap events for one authoritative recovery read', () => {
    let state = emptyProjectLogs();
    for (const session of ['A', 'B', 'C']) state = receiveLogEvent(state, event(session));
    state = receiveLogSnapshot(state, snapshot('A'));
    expect(state.needsSnapshot).toBe(true);
    expect(state.pending.size).toBe(0);
    state = receiveLogEvent(state, event('A', '2', 'during recovery'));
    state = receiveLogSnapshot(state, snapshot('A', '1', 'recovered'));
    expect(state.records.map(record => record.log)).toEqual(['recovered', 'during recovery']);
    expect(state.needsSnapshot).toBe(false);
});

it('does not allocate a pending bucket for a retired session after an empty replacement', () => {
    let state = receiveLogSnapshot(emptyProjectLogs(), snapshot('A', '1', 'old'));
    state = receiveLogSnapshot(state, snapshot('B'));
    for (let i = 0; i < 1005; i++) state = receiveLogEvent(state, event('A', String(i + 2)));
    expect(state.sessionId).toBe('B');
    expect(state.records).toEqual([]);
    expect(state.pending.size).toBe(0);
    expect(state.pendingOverflow).toBe(false);
});

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
    return { promise, resolve, reject };
}
let reads: ReturnType<typeof deferred<LogSnapshot>>[];
let listeners: Map<string, (event: { payload: unknown }) => void>;
beforeEach(() => {
    reads = []; listeners = new Map();
    bridge.invoke.mockReset(); bridge.listen.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    bridge.listen.mockImplementation(async (name: string, callback: (event: { payload: unknown }) => void) => {
        listeners.set(name, callback); return () => { listeners.delete(name); };
    });
    bridge.invoke.mockImplementation((command: string) => {
        switch (command) {
            case 'get_projects': return Promise.resolve([{ id: pid, name: 'Synthetic', path: 'C:/synthetic', commands: [], auto_start: false, restart_on_crash: false, enabled: true, env_vars: {} }]);
            case 'get_project_status': return Promise.resolve('running');
            case 'get_project_log_snapshot': { const read = deferred<LogSnapshot>(); reads.push(read); return read.promise; }
            default: throw new Error(`Forbidden synthetic command: ${command}`);
        }
    });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
function emit(payload: LogEvent) { act(() => listeners.get('process-log-v2')!({ payload })); }
async function overflow() {
    const view = renderHook(useProjects);
    await act(async () => {});
    for (const session of ['A', 'B', 'C']) emit(event(session));
    await act(async () => reads[0].resolve(snapshot('A')));
    return view;
}

it('recovers an evicted session interval once while accepting live output during recovery', async () => {
    const view = await overflow();
    expect(reads).toHaveLength(2);
    emit(event('A', '2', 'during recovery'));
    await act(async () => reads[1].resolve(snapshot('A', '1', 'recovered')));
    expect(view.result.current.logs[pid]).toEqual(['recovered', 'during recovery']);
    expect(view.result.current.logErrors[pid]).toBeNull();
    expect(reads).toHaveLength(2);
});

it('reports failed recovery without polling, and an explicit refresh can repair it', async () => {
    const view = await overflow();
    await act(async () => reads[1].reject(new Error('Synthetic recovery failure')));
    expect(view.result.current.logErrors[pid]).toContain('could not be reconciled');
    expect(view.result.current.loading).toBe(false);
    expect(reads).toHaveLength(2);
    await act(async () => { void view.result.current.refreshProjects(); });
    await act(async () => reads[2].resolve(snapshot('A', '1', 'recovered')));
    expect(view.result.current.logs[pid]).toEqual(['recovered']);
    expect(view.result.current.logErrors[pid]).toBeNull();
    expect(reads).toHaveLength(3);
});

it('retires an outstanding recovery read on unmount', async () => {
    const view = await overflow();
    view.unmount();
    await act(async () => reads[1].resolve(snapshot('A', '1', 'late')));
    expect(reads).toHaveLength(2);
    expect(listeners.size).toBe(0);
    expect(console.error).not.toHaveBeenCalled();
});
