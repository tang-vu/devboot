import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useProjects } from '../src/hooks/useProjects';
import type { Project } from '../src/types';

const bridge = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: bridge.invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: bridge.listen }));

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
    return { promise, resolve, reject };
}

type Listener = ReturnType<typeof deferred<() => void>> & {
    name: string; callback: (event: { payload: unknown }) => void;
    active: boolean; settled: boolean; unlisten: ReturnType<typeof vi.fn>;
};
type Read = ReturnType<typeof deferred<unknown>> & { command: string; args?: { projectId: string } };
let listeners: Listener[];
let reads: Read[];
const project = (name = 'Current fixture', id = 'synthetic-ownership-A'): Project => ({
    id, name, path: 'C:/synthetic/ownership', commands: ['synthetic-only'],
    auto_start: false, restart_on_crash: false, enabled: true, env_vars: {},
});
const pid = project().id;
const active = () => listeners.filter(listener => listener.active);
const calls = (command: string) => reads.filter(read => read.command === command);

async function settleRead(read: Read, value: unknown) {
    await act(async () => { read.resolve(value); await read.promise; });
}
async function settleListener(listener: Listener) {
    await act(async () => {
        listener.active = true;
        listener.settled = true;
        listener.resolve(listener.unlisten);
        await listener.promise;
    });
}
async function settleAllListeners() {
    while (listeners.some(listener => !listener.settled)) {
        for (const listener of listeners.filter(listener => !listener.settled)) await settleListener(listener);
    }
}
function emit(name: string, payload: unknown) {
    act(() => { for (const listener of active().filter(listener => listener.name === name)) listener.callback({ payload }); });
}
async function finishLoad(projectRead: Read, name: string, status: string, logs: string[]) {
    const statusIndex = calls('get_project_status').length;
    await settleRead(projectRead, [project(name)]);
    const logIndex = calls('get_project_logs').length;
    await settleRead(calls('get_project_status')[statusIndex], status);
    await settleRead(calls('get_project_logs')[logIndex], logs);
}

beforeEach(() => {
    listeners = []; reads = [];
    bridge.invoke.mockReset(); bridge.listen.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    bridge.invoke.mockImplementation((command: string, args?: { projectId: string }) => {
        if (!['get_projects', 'get_project_status', 'get_project_logs'].includes(command)) {
            throw new Error(`Forbidden native command in synthetic investigation: ${command}`);
        }
        if (args && !args.projectId.startsWith('synthetic-')) throw new Error('Non-synthetic project ID');
        const read: Read = { ...deferred<unknown>(), command, args };
        reads.push(read); return read.promise;
    });
    bridge.listen.mockImplementation((name: string, callback: Listener['callback']) => {
        const listener: Listener = {
            ...deferred<() => void>(), name, callback, active: false, settled: false,
            unlisten: vi.fn(),
        };
        listener.unlisten.mockImplementation(() => { listener.active = false; });
        listeners.push(listener); return listener.promise;
    });
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    // Fixture-only teardown, after assertions: never invoke native process commands.
    for (const listener of active()) listener.active = false;
    expect(bridge.invoke.mock.calls.every(([command]) =>
        ['get_projects', 'get_project_status', 'get_project_logs'].includes(command))).toBe(true);
});

describe('listener ownership acceptance', () => {
    it('cleans all listeners when registration finishes before unmount (control)', async () => {
        const view = renderHook(useProjects);
        await settleAllListeners();
        expect(active()).toHaveLength(3);
        view.unmount();
        expect(active()).toHaveLength(0);
        for (const listener of listeners) expect(listener.unlisten).toHaveBeenCalledTimes(1);
    });

    it.each([0, 1, 2])('unmount while registration %i is pending releases acquired and late handles', async completed => {
        const view = renderHook(useProjects);
        for (let index = 0; index < completed; index++) await settleListener(listeners[index]);
        view.unmount();
        expect.soft(active()).toHaveLength(0);
        await settleAllListeners();
        expect(active()).toHaveLength(0);
        for (const listener of listeners) expect(listener.unlisten).toHaveBeenCalledTimes(1);
    });

    it('StrictMode setup/cleanup replay owns one listener set and one copy of a log', async () => {
        const view = renderHook(useProjects, { reactStrictMode: true });
        expect(listeners).toHaveLength(2); // Both effect generations await their first listen.
        await settleAllListeners();
        expect.soft(active()).toHaveLength(3);
        emit('process-log', { project_id: pid, log: 'one synthetic event' });
        expect.soft(view.result.current.logs[pid]).toEqual(['one synthetic event']);
        view.unmount();
        expect(active()).toHaveLength(0);
        for (const listener of listeners) expect(listener.unlisten).toHaveBeenCalledTimes(1);
    });

    it('ignores a queued callback belonging to the retired StrictMode generation', async () => {
        const view = renderHook(useProjects, { reactStrictMode: true });
        const retiredLogCallback = listeners[0].callback;
        await settleAllListeners();
        act(() => retiredLogCallback({ payload: { project_id: pid, log: 'retired callback' } }));
        expect(view.result.current.logs[pid] ?? []).toEqual([]);
    });

    it('ignores queued crash callbacks after cleanup', async () => {
        const view = renderHook(useProjects);
        await settleAllListeners();
        const crash = listeners.find(listener => listener.name === 'process-crash')!;
        const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
        view.unmount();
        act(() => crash.callback({ payload: { project_id: pid, restart_count: 3, will_restart: false } }));
        expect(consoleLog).not.toHaveBeenCalled();
    });

    it.each([0, 1, 2].flatMap(stage => [false, true].map(unmountFirst => ({ stage, unmountFirst })) ))(
        'handles registration rejection at $stage (already unmounted: $unmountFirst)',
        async ({ stage, unmountFirst }) => {
            const view = renderHook(useProjects);
            for (let index = 0; index < stage; index++) await settleListener(listeners[index]);
            const pending = listeners[stage];
            if (unmountFirst) view.unmount();
            pending.settled = true;
            await act(async () => {
                pending.reject(new Error(`Synthetic registration failure at ${stage}`));
                await pending.promise.catch(() => {});
            });
            expect(active()).toHaveLength(0);
            expect(listeners).toHaveLength(stage + 1);
            expect(console.error).toHaveBeenCalledTimes(unmountFirst ? 0 : 1);
            if (!unmountFirst) {
                await finishLoad(calls('get_projects')[0], 'Available snapshot', 'stopped', ['prior history']);
                expect(view.result.current.loading).toBe(false);
                expect(view.result.current.logs[pid]).toEqual(['prior history']);
            }
            view.unmount();
            for (const listener of listeners.slice(0, stage)) expect(listener.unlisten).toHaveBeenCalledTimes(1);
            expect(pending.unlisten).not.toHaveBeenCalled();
        },
    );

    it('continues releasing other listeners if one disposer throws', async () => {
        const view = renderHook(useProjects);
        await settleAllListeners();
        listeners[0].unlisten.mockImplementationOnce(() => { throw new Error('Synthetic cleanup failure'); });
        view.unmount();
        for (const listener of listeners) expect(listener.unlisten).toHaveBeenCalledTimes(1);
        expect(console.error).toHaveBeenCalledTimes(1);
    });

    it.each(['normal unmount', 'late acquired handle', 'registration rollback'])(
        'reports an async disposer rejection during %s without retrying or an unhandled rejection', async mode => {
            const view = renderHook(useProjects);
            const failure = new Error('Synthetic async unlisten failure');
            // A rejected disposer does not confirm native release. Assert its attempt and error reporting.
            listeners[0].unlisten.mockImplementation(() => Promise.reject(failure));
            if (mode === 'normal unmount') {
                await settleAllListeners();
                view.unmount();
            } else if (mode === 'late acquired handle') {
                view.unmount();
                await settleListener(listeners[0]);
            } else {
                await settleListener(listeners[0]);
                const pending = listeners[1];
                pending.settled = true;
                await act(async () => {
                    pending.reject(new Error('Synthetic registration rollback'));
                    await pending.promise.catch(() => {});
                });
            }
            // Flush the runtime's unhandled-rejection boundary, which Vitest reports as an error.
            await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
            expect(listeners[0].unlisten).toHaveBeenCalledTimes(1);
            expect(console.error).toHaveBeenCalledWith('Failed to remove project listener:', failure);
            if (mode === 'normal unmount') {
                expect(listeners[1].unlisten).toHaveBeenCalledTimes(1);
                expect(listeners[2].unlisten).toHaveBeenCalledTimes(1);
            }
            view.unmount();
            expect(listeners[0].unlisten).toHaveBeenCalledTimes(1);
        },
    );

    it('finishes a pending status read after listener setup fails', async () => {
        const view = renderHook(useProjects);
        await settleRead(calls('get_projects')[0], [project()]);
        await settleListener(listeners[0]);
        const pending = listeners[1];
        pending.settled = true;
        await act(async () => {
            pending.reject(new Error('Synthetic listener failure during status read'));
            await pending.promise.catch(() => {});
        });
        expect(active()).toHaveLength(0);
        expect(view.result.current.loading).toBe(true);
        await settleRead(calls('get_project_status')[0], 'running');
        await settleRead(calls('get_project_logs')[0], ['prior history']);
        expect(view.result.current.statuses[pid]).toBe('running');
        expect(view.result.current.logs[pid]).toEqual(['prior history']);
        expect(view.result.current.loading).toBe(false);
        view.unmount();
        expect(listeners[0].unlisten).toHaveBeenCalledTimes(1);
        expect(pending.unlisten).not.toHaveBeenCalled();
    });

});

describe('read ownership acceptance', () => {
    it('keeps initial hydration independent of a pending listener registration', async () => {
        const view = renderHook(useProjects);
        await finishLoad(calls('get_projects')[0], 'Available snapshot', 'stopped', ['prior history']);
        expect(listeners).toHaveLength(1);
        expect(listeners[0].settled).toBe(false);
        expect(view.result.current.loading).toBe(false);
        expect(view.result.current.logs[pid]).toEqual(['prior history']);
    });

    it('a retired StrictMode load cannot overwrite the current setup results', async () => {
        const view = renderHook(useProjects, { reactStrictMode: true });
        await settleAllListeners();
        expect(calls('get_projects')).toHaveLength(2);
        await finishLoad(calls('get_projects')[1], 'Current setup', 'running', ['current history']);
        const count = reads.length;
        await settleRead(calls('get_projects')[0], [project('Retired setup')]);
        expect(reads).toHaveLength(count);
        expect.soft(view.result.current.projects[0].name).toBe('Current setup');
        expect.soft(view.result.current.statuses[pid]).toBe('running');
        expect(view.result.current.logs[pid]).toEqual(['current history']);
    });

    it.each(['get_projects', 'get_project_status', 'get_project_logs'])('unmount during %s prevents further read work', async phase => {
        let renders = 0;
        const view = renderHook(() => { renders++; return useProjects(); });
        await settleAllListeners();
        let pending = calls('get_projects')[0];
        if (phase !== 'get_projects') {
            await settleRead(pending, [project()]);
            pending = calls('get_project_status')[0];
        }
        if (phase === 'get_project_logs') {
            await settleRead(pending, 'running');
            pending = calls('get_project_logs')[0];
        }
        view.unmount();
        const count = reads.length;
        const renderCount = renders;
        await settleRead(pending, phase === 'get_projects' ? [project()] : phase === 'get_project_status' ? 'running' : ['late']);
        expect.soft(reads).toHaveLength(count);
        expect(renders).toBe(renderCount);
        expect(active()).toHaveLength(0);
    });

    it('an older refresh finishing last cannot replace a newer complete refresh', async () => {
        const view = renderHook(useProjects);
        await settleAllListeners();
        await finishLoad(calls('get_projects')[0], 'Initial', 'stopped', ['initial']);
        act(() => { void view.result.current.refreshProjects(); void view.result.current.refreshProjects(); });
        await finishLoad(calls('get_projects')[2], 'Newest', 'running', ['newest']);
        const count = reads.length;
        await settleRead(calls('get_projects')[1], [project('Older')]);
        expect(reads).toHaveLength(count);
        expect.soft(view.result.current.projects[0].name).toBe('Newest');
        expect.soft(view.result.current.statuses[pid]).toBe('running');
        expect(view.result.current.logs[pid]).toEqual(['newest']);
    });

    it.each(['status', 'logs'])('an older refresh paused at %s cannot overwrite a newer refresh', async phase => {
        const view = renderHook(useProjects);
        await settleAllListeners();
        await settleRead(calls('get_projects')[0], [project('Initial'), project('Other', 'synthetic-ownership-B')]);
        let pending = calls('get_project_status')[0];
        if (phase === 'logs') {
            await settleRead(pending, 'stopped');
            pending = calls('get_project_logs')[0];
        }
        act(() => { void view.result.current.refreshProjects(); });
        await finishLoad(calls('get_projects')[1], 'Newer', 'running', ['newer history']);
        const count = reads.length;
        await settleRead(pending, phase === 'status' ? 'error' : ['older history']);
        expect.soft(view.result.current.statuses[pid]).toBe('running');
        expect.soft(view.result.current.logs[pid]).toEqual(['newer history']);
        expect(reads).toHaveLength(count);
    });

    it.each(['get_projects', 'get_project_status', 'get_project_logs'])('ignores a superseded %s rejection while the current load is pending', async phase => {
        const view = renderHook(useProjects);
        await settleAllListeners();
        let pending = calls('get_projects')[0];
        if (phase !== 'get_projects') {
            await settleRead(pending, [project()]);
            pending = calls('get_project_status')[0];
        }
        if (phase === 'get_project_logs') {
            await settleRead(pending, 'stopped');
            pending = calls('get_project_logs')[0];
        }
        act(() => { void view.result.current.refreshProjects(); });
        const count = reads.length;
        await act(async () => {
            pending.reject(new Error('Synthetic superseded read failure'));
            await pending.promise.catch(() => {});
        });
        expect(reads).toHaveLength(count);
        expect(view.result.current.loading).toBe(true);
        expect(console.error).not.toHaveBeenCalled();
        await finishLoad(calls('get_projects')[1], 'Current', 'running', []);
        expect(view.result.current.loading).toBe(false);
    });

    it('ignores read rejection and refresh calls after unmount', async () => {
        const view = renderHook(useProjects);
        const refresh = view.result.current.refreshProjects;
        const pending = calls('get_projects')[0];
        view.unmount();
        await act(async () => {
            pending.reject(new Error('Synthetic unmounted read failure'));
            await pending.promise.catch(() => {});
            void refresh();
        });
        expect(reads).toHaveLength(1);
        expect(console.error).not.toHaveBeenCalled();
    });

    it('reports a current read failure and finishes its initial loading', async () => {
        const view = renderHook(useProjects);
        const pending = calls('get_projects')[0];
        await act(async () => {
            pending.reject(new Error('Synthetic current read failure'));
            await pending.promise.catch(() => {});
        });
        expect(view.result.current.loading).toBe(false);
        expect(console.error).toHaveBeenCalledWith('Failed to load projects:', expect.any(Error));
    });

    it('a stale load cannot finish loading while the current load remains pending', async () => {
        const view = renderHook(useProjects, { reactStrictMode: true });
        await settleAllListeners();
        await settleRead(calls('get_projects')[0], []);
        expect(view.result.current.loading).toBe(true);
        await finishLoad(calls('get_projects')[1], 'Current setup', 'running', []);
        expect(view.result.current.loading).toBe(false);
    });

    it('a status event arriving during its pending read wins over the older response', async () => {
        const view = renderHook(useProjects);
        await settleAllListeners();
        await settleRead(calls('get_projects')[0], [project()]);
        emit('process-status', { project_id: pid, status: 'running' });
        expect(view.result.current.statuses[pid]).toBe('running');
        await settleRead(calls('get_project_status')[0], 'stopped');
        expect(view.result.current.statuses[pid]).toBe('running');
    });

    it('a status read started after an earlier event can provide a newer value (control)', async () => {
        const view = renderHook(useProjects);
        await settleAllListeners();
        emit('process-status', { project_id: pid, status: 'running' });
        await settleRead(calls('get_projects')[0], [project()]);
        await settleRead(calls('get_project_status')[0], 'stopped');
        expect(view.result.current.statuses[pid]).toBe('stopped');
    });

    it('a status event after a completed read becomes current (control)', async () => {
        const view = renderHook(useProjects);
        await settleAllListeners();
        await settleRead(calls('get_projects')[0], [project()]);
        await settleRead(calls('get_project_status')[0], 'stopped');
        emit('process-status', { project_id: pid, status: 'running' });
        expect(view.result.current.statuses[pid]).toBe('running');
    });

    it('an event for another project must not invalidate this project status read (control)', async () => {
        const view = renderHook(useProjects);
        await settleAllListeners();
        await settleRead(calls('get_projects')[0], [project()]);
        emit('process-status', { project_id: 'synthetic-ownership-B', status: 'running' });
        await settleRead(calls('get_project_status')[0], 'stopped');
        expect(view.result.current.statuses[pid]).toBe('stopped');
    });
});

describe('current log data', () => {
    it('keeps the full current snapshot and subsequent exact repeated lines', async () => {
        const view = renderHook(useProjects);
        await settleAllListeners();
        await finishLoad(calls('get_projects')[0], 'Fixture', 'running', ['prior history', 'identical line', 'identical line']);
        expect(view.result.current.logs[pid]).toEqual(['prior history', 'identical line', 'identical line']);
        emit('process-log', { project_id: pid, log: 'identical line' });
        emit('process-log', { project_id: pid, log: 'identical line' });
        expect(view.result.current.logs[pid]).toEqual(['prior history', 'identical line', 'identical line', 'identical line', 'identical line']);
    });
});
