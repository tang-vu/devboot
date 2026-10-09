import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import App from '../src/App';
import { useProjects } from '../src/hooks/useProjects';
import * as projectHooks from '../src/hooks/useProjects';
import type { Project } from '../src/types';
import { logSnapshot } from './log-fixtures';

const bridge = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: bridge.invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: bridge.listen }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(() => { throw new Error('Native picker forbidden'); }) }));

const project = (id = 'A'): Project => ({
    id, name: `Fixture ${id}`, path: `C:/synthetic/${id}`, commands: ['synthetic command'],
    auto_start: false, restart_on_crash: false, enabled: true, env_vars: {},
});
function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
    return { promise, resolve, reject };
}
let reads: ReturnType<typeof deferred<Project[]>>[];
let statusFails: boolean;
let logsFail: boolean;
const catalogCalls = () => bridge.invoke.mock.calls.filter(([command]) => command === 'get_projects');
async function settle(index: number, result: Project[] | Error) {
    await act(async () => {
        if (result instanceof Error) reads[index].reject(result);
        else reads[index].resolve(result);
        await reads[index].promise.catch(() => {});
    });
}
const retryButton = () => screen.getByRole<HTMLButtonElement>('button', { name: 'Retry projects' });
const errorNotice = () => screen.getByRole('alert', { name: 'Project list unavailable' });

beforeEach(() => {
    reads = [];
    statusFails = false;
    logsFail = false;
    bridge.invoke.mockReset();
    bridge.listen.mockReset();
    bridge.listen.mockResolvedValue(vi.fn());
    bridge.invoke.mockImplementation((command: string, args?: { projectId: string }) => {
        switch (command) {
            case 'get_projects': {
                const request = deferred<Project[]>();
                reads.push(request);
                return request.promise;
            }
            case 'get_settings': return Promise.resolve({
                auto_start_with_windows: false, theme: 'dark', minimize_to_tray: true, show_notifications: false,
            });
            case 'get_project_status': return statusFails
                ? Promise.reject(new Error('Synthetic status failure')) : Promise.resolve('running');
            case 'get_project_log_snapshot': return logsFail
                ? Promise.reject(new Error('Synthetic log failure')) : Promise.resolve(logSnapshot(args!.projectId, ['retained output']));
            default: throw new Error(`Forbidden native command: ${command}`);
        }
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
    cleanup();
    expect(bridge.invoke.mock.calls.every(([command]) => [
        'get_projects', 'get_settings', 'get_project_status', 'get_project_log_snapshot',
    ].includes(command))).toBe(true);
    vi.restoreAllMocks();
});

describe('project catalog recovery in App', () => {
    it('distinguishes a failed read from a confirmed empty catalog and retries to populated data', async () => {
        render(<App />);
        expect(screen.getByText('Loading DevBoot...')).toBeDefined();
        await settle(0, new Error('Synthetic catalog unavailable'));
        expect(errorNotice().textContent).toContain('Project list could not be loaded');
        expect(screen.queryByText('No Projects Yet')).toBeNull();
        expect(retryButton().disabled).toBe(false);
        act(() => { retryButton().click(); retryButton().click(); });
        expect(catalogCalls()).toHaveLength(2);
        expect(retryButton().disabled).toBe(true);
        expect(errorNotice().getAttribute('aria-busy')).toBe('true');
        await settle(1, [project()]);
        expect(screen.queryByRole('alert', { name: 'Project list unavailable' })).toBeNull();
        expect(screen.getByRole('region', { name: 'Fixture A output' })).toBeDefined();
        expect(screen.queryByText('No Projects Yet')).toBeNull();
    });

    it('keeps a failed retry recoverable, then shows an honestly empty catalog', async () => {
        render(<App />);
        await settle(0, new Error('First synthetic failure'));
        fireEvent.click(retryButton());
        await settle(1, new Error('Second synthetic failure'));
        expect(errorNotice().textContent).toContain('Second synthetic failure');
        expect(retryButton().disabled).toBe(false);
        expect(screen.queryByText('No Projects Yet')).toBeNull();
        fireEvent.click(retryButton());
        await settle(2, []);
        expect(screen.getByRole('heading', { name: 'No Projects Yet' })).toBeDefined();
        expect(screen.queryByRole('alert', { name: 'Project list unavailable' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Retry projects' })).toBeNull();
    });

    it('does not show a catalog error for a successful empty initial read', async () => {
        render(<App />);
        await settle(0, []);
        expect(screen.getByRole('heading', { name: 'No Projects Yet' })).toBeDefined();
        expect(screen.queryByRole('alert', { name: 'Project list unavailable' })).toBeNull();
    });

    it('keeps a successfully read catalog when a later status read fails', async () => {
        statusFails = true;
        render(<App />);
        await settle(0, [project()]);
        expect(screen.getByRole('region', { name: 'Fixture A output' })).toBeDefined();
        expect(screen.getByText('retained output')).toBeDefined();
        expect(screen.queryByRole('alert', { name: 'Project list unavailable' })).toBeNull();
        expect(screen.queryByText('No Projects Yet')).toBeNull();
        expect(console.error).toHaveBeenCalledWith('Failed to load project statuses:', expect.any(Error));
    });

    it('preserves selected output and input through a failed refresh and successful retry', async () => {
        logsFail = true;
        render(<App />);
        await settle(0, [project()]);
        const input = screen.getByRole<HTMLInputElement>('textbox', { name: 'Terminal input' });
        fireEvent.change(input, { target: { value: 'keep my draft' } });
        const output = screen.getByRole('region', { name: 'Fixture A output' });
        expect(screen.getByText('Log history could not be loaded. Reload logs to try again.')).toBeDefined();
        expect(screen.queryByRole('alert', { name: 'Project list unavailable' })).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Reload logs' }));
        await settle(1, new Error('Synthetic refresh unavailable'));
        expect(errorNotice().textContent).toContain('Showing the last loaded project list');
        expect(screen.getByRole('region', { name: 'Fixture A output' })).toBe(output);
        expect(input.value).toBe('keep my draft');
        logsFail = false;
        fireEvent.click(retryButton());
        await settle(2, [project()]);
        expect(screen.getByRole('region', { name: 'Fixture A output' })).toBe(output);
        expect(input.value).toBe('keep my draft');
        expect(screen.getByText('retained output')).toBeDefined();
        expect(screen.queryByRole('alert', { name: 'Project list unavailable' })).toBeNull();
    });

    it('keeps an open settings draft mounted when a refresh fails', async () => {
        logsFail = true;
        render(<App />);
        await settle(0, [project()]);
        fireEvent.click(screen.getByRole('button', { name: 'Reload logs' }));
        fireEvent.click(screen.getByRole('button', { name: /Settings$/ }));
        const dialog = screen.getByRole('dialog', { name: 'Settings' });
        const notifications = screen.getByRole('switch', { name: 'Show notifications' });
        fireEvent.click(notifications);
        await settle(1, new Error('Refresh failed with settings open'));
        expect(screen.getByRole('dialog', { name: 'Settings' })).toBe(dialog);
        expect(notifications.getAttribute('aria-checked')).toBe('true');
        expect(errorNotice()).toBeDefined();
    });

    it('selects a remaining project when a successful retry no longer contains the selected one', async () => {
        logsFail = true;
        render(<App />);
        await settle(0, [project('A')]);
        fireEvent.click(screen.getByRole('button', { name: 'Reload logs' }));
        await settle(1, new Error('Refresh failed'));
        fireEvent.click(retryButton());
        await settle(2, [project('B')]);
        expect(screen.getByRole('region', { name: 'Fixture B output' })).toBeDefined();
        expect(screen.queryByText('No Projects Yet')).toBeNull();
    });

    it('keeps a still-present selected project when retry reorders the catalog', async () => {
        logsFail = true;
        render(<App />);
        await settle(0, [project('A'), project('B')]);
        const output = screen.getByRole('region', { name: 'Fixture A output' });
        fireEvent.click(screen.getByRole('button', { name: 'Reload logs' }));
        await settle(1, new Error('Refresh failed'));
        expect(screen.getByRole('region', { name: 'Fixture A output' })).toBe(output);
        fireEvent.click(retryButton());
        await settle(2, [project('B'), project('A')]);
        expect(screen.getByRole('region', { name: 'Fixture A output' })).toBe(output);
    });

    it('selects the first project when a confirmed empty catalog later becomes populated', async () => {
        const originalHook = projectHooks.useProjects;
        let refresh!: () => Promise<void>;
        vi.spyOn(projectHooks, 'useProjects').mockImplementation(() => {
            const value = originalHook();
            refresh = value.refreshProjects;
            return value;
        });
        render(<App />);
        await settle(0, [project('A')]);
        act(() => { void refresh(); });
        await settle(1, []);
        expect(screen.getByRole('heading', { name: 'No Projects Yet' })).toBeDefined();
        act(() => { void refresh(); });
        await settle(2, [project('B')]);
        expect(screen.getByRole('region', { name: 'Fixture B output' })).toBeDefined();
        expect(screen.queryByText('No Projects Yet')).toBeNull();
    });

    it('keeps an open project-edit draft mounted when a refresh fails', async () => {
        logsFail = true;
        render(<App />);
        await settle(0, [project()]);
        fireEvent.click(screen.getByRole('button', { name: 'Reload logs' }));
        fireEvent.click(screen.getByTitle('Edit project'));
        const name = screen.getByLabelText<HTMLInputElement>('Project Name');
        fireEvent.change(name, { target: { value: 'Unsaved project name' } });
        await settle(1, new Error('Refresh failed with edit open'));
        expect(screen.getByLabelText('Project Name')).toBe(name);
        expect(name.value).toBe('Unsaved project name');
        expect(errorNotice()).toBeDefined();
    });
});

describe('project catalog request ownership', () => {
    it('does not let an older success erase a newer catalog error', async () => {
        const view = renderHook(useProjects);
        act(() => { void view.result.current.refreshProjects(); });
        await settle(1, new Error('Current failure'));
        await settle(0, [project('old')]);
        expect(view.result.current.projects).toEqual([]);
        expect(view.result.current.projectLoadError).toContain('Current failure');
        expect(view.result.current.refreshingProjects).toBe(false);
    });

    it('does not let an older failure replace a newer successful catalog', async () => {
        const view = renderHook(useProjects);
        act(() => { void view.result.current.refreshProjects(); });
        await settle(1, [project('new')]);
        await settle(0, new Error('Stale failure'));
        expect(view.result.current.projects.map(item => item.id)).toEqual(['new']);
        expect(view.result.current.projectLoadError).toBeNull();
        expect(view.result.current.refreshingProjects).toBe(false);
        expect(console.error).not.toHaveBeenCalled();
    });

    it('keeps the current retry pending when an older read completes', async () => {
        const view = renderHook(useProjects);
        act(() => { void view.result.current.refreshProjects(); });
        await settle(0, new Error('Stale failure'));
        expect(view.result.current.loading).toBe(true);
        expect(view.result.current.refreshingProjects).toBe(true);
        expect(view.result.current.projectLoadError).toBeNull();
        await settle(1, []);
        expect(view.result.current.loading).toBe(false);
        expect(view.result.current.refreshingProjects).toBe(false);
    });

    it('suppresses repeated explicit retries before React renders', async () => {
        const view = renderHook(useProjects);
        await settle(0, new Error('Initial failure'));
        act(() => { void view.result.current.retryProjects(); void view.result.current.retryProjects(); });
        expect(catalogCalls()).toHaveLength(2);
        await settle(1, []);
        expect(view.result.current.projectLoadError).toBeNull();
    });

    it('preserves last loaded projects on refresh failure, including a confirmed empty list', async () => {
        const view = renderHook(useProjects);
        await settle(0, [project()]);
        act(() => { void view.result.current.refreshProjects(); });
        await settle(1, new Error('Refresh failed'));
        expect(view.result.current.projects.map(item => item.id)).toEqual(['A']);
        expect(view.result.current.projectLoadError).toContain('Refresh failed');
        act(() => { void view.result.current.retryProjects(); });
        await settle(2, []);
        expect(view.result.current.projects).toEqual([]);
        expect(view.result.current.projectLoadError).toBeNull();
    });

    it('ignores failure from a closed hook after a fresh hook loads', async () => {
        const old = renderHook(useProjects);
        old.unmount();
        const current = renderHook(useProjects);
        await settle(1, [project('new')]);
        await settle(0, new Error('Closed failure'));
        expect(current.result.current.projects.map(item => item.id)).toEqual(['new']);
        expect(current.result.current.projectLoadError).toBeNull();
        expect(console.error).not.toHaveBeenCalled();
    });

    it('lets the active StrictMode generation own error and loading', async () => {
        const view = renderHook(useProjects, { reactStrictMode: true });
        await waitFor(() => expect(reads).toHaveLength(2));
        await settle(1, [project('new')]);
        await settle(0, new Error('Retired StrictMode failure'));
        expect(view.result.current.projects.map(item => item.id)).toEqual(['new']);
        expect(view.result.current.projectLoadError).toBeNull();
        expect(view.result.current.refreshingProjects).toBe(false);
        expect(console.error).not.toHaveBeenCalled();
    });
});
