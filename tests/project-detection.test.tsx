import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StrictMode } from 'react';
import userEvent from '@testing-library/user-event';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import App from '../src/App';
import type { DetectedProjectInfo, Project } from '../src/types';
import { logSnapshot } from './log-fixtures';

const bridge = vi.hoisted(() => ({ invoke: vi.fn(), open: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: bridge.invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => vi.fn()) }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: bridge.open }));

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
    return { promise, resolve, reject };
}

const original: Project = {
    id: 'fixture-id', name: 'Original', path: 'C:/original/',
    commands: ['echo original'], auto_start: false, restart_on_crash: false,
    enabled: true, env_vars: { FIXTURE: 'kept' },
};
const detection = (name: string): DetectedProjectInfo => ({
    name, project_type: 'fixture', framework: null,
    suggestions: [{ command: `echo ${name}`, description: 'synthetic only', is_recommended: true }],
});
let requests: Array<ReturnType<typeof deferred<DetectedProjectInfo>> & { path: string }>;
let mutations: Array<ReturnType<typeof deferred<unknown>> & { command: string; args: any }>;

beforeEach(() => {
    requests = [];
    mutations = [];
    bridge.invoke.mockReset();
    bridge.open.mockReset();
    bridge.invoke.mockImplementation((command: string, args: any) => {
        if (command === 'get_projects') return Promise.resolve([{ ...original }]);
        if (command === 'get_settings') return Promise.resolve({
            auto_start_with_windows: false, theme: 'dark', minimize_to_tray: false, show_notifications: false,
        });
        if (command === 'get_project_status') return Promise.resolve('stopped');
        if (command === 'get_project_log_snapshot') return Promise.resolve(logSnapshot(args.projectId));
        if (command === 'detect_project_from_path') {
            const request = { ...deferred<DetectedProjectInfo>(), path: args.path };
            requests.push(request);
            return request.promise;
        }
        if (command === 'update_project' || command === 'add_project') {
            const request = { ...deferred<unknown>(), command, args: structuredClone(args) };
            mutations.push(request);
            return request.promise;
        }
        throw new Error(`Forbidden native command: ${command}`);
    });
});

afterEach(() => {
    cleanup();
    vi.useRealTimers();
    expect(bridge.invoke.mock.calls.every(([command]) => [
        'get_projects', 'get_settings', 'get_project_status', 'get_project_log_snapshot',
        'detect_project_from_path', 'update_project', 'add_project',
    ].includes(command))).toBe(true);
});

async function start(mode = 'edit') {
    render(<StrictMode><App /></StrictMode>);
    await screen.findByTitle('Edit project');
    fireEvent.click(mode === 'edit' ? screen.getByTitle('Edit project') : screen.getAllByRole('button', { name: '+ Add Project' })[0]);
}

async function browse(path: string) {
    bridge.open.mockResolvedValueOnce(path);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Browse' })); });
}

async function resolve(index: number, name: string) {
    await act(async () => { requests[index].resolve(detection(name)); });
}

const field = (name: string) => screen.getByLabelText<HTMLInputElement | HTMLTextAreaElement>(name);
const value = (name: string) => field(name).value;
const edit = (name: string, value: string) => fireEvent.change(field(name), { target: { value } });
const submit = () => fireEvent.submit(document.querySelector('.add-project-modal form')!);
const saveButton = () => screen.getByRole<HTMLButtonElement>('button', { name: /^(Save Changes|Add Project)$/ });
const tick = async () => { await act(async () => { vi.advanceTimersByTime(500); }); };
const drop = (path: string) => fireEvent.drop(document.querySelector('.drop-zone')!, {
    dataTransfer: { files: [{ path, name: path }] },
});
async function reject(index: number) {
    await act(async () => { requests[index].reject(new Error('Synthetic detection failure')); });
}

describe('project detection ownership with the real App and a synthetic bridge', () => {
    it('keeps the last chosen folder after older detection completes and saves that folder', async () => {
        await start();
        await browse('C:/first');
        await browse('C:/second');
        expect(requests.map(request => request.path)).toEqual(['C:/first', 'C:/second']);
        await resolve(1, 'Second');
        expect(screen.getByLabelText<HTMLInputElement>('Project Path').value).toBe('C:/second');
        await resolve(0, 'First');
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save Changes' })); });
        const mutation = bridge.invoke.mock.calls.find(([command]) => command === 'update_project');
        expect(mutation?.[1].project).toEqual({
            ...original, name: 'Second', path: 'C:/second', commands: ['echo Second'],
        });
    });

    it('preserves a newer manual name and command draft while detection is pending', async () => {
        await start();
        await browse('C:/second');
        fireEvent.change(screen.getByLabelText('Project Name'), { target: { value: 'My chosen name' } });
        fireEvent.change(screen.getByLabelText('Startup Commands'), { target: { value: 'echo my chosen command' } });
        await resolve(0, 'Second');
        expect({
            name: screen.getByLabelText<HTMLInputElement>('Project Name').value,
            commands: screen.getByLabelText<HTMLTextAreaElement>('Startup Commands').value,
        }).toEqual({ name: 'My chosen name', commands: 'echo my chosen command' });
    });

    it('cancels queued path detection when an editor is dismissed', async () => {
        await start();
        vi.useFakeTimers();
        fireEvent.change(screen.getByLabelText('Project Path'), { target: { value: 'C:/original/child' } });
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        await act(async () => { vi.advanceTimersByTime(500); });
        expect(requests).toHaveLength(0);
    });

    it.each(['add', 'edit'])('submits the exact latest %s snapshot without changing options or environment', async mode => {
        await start(mode);
        await browse('C:/first');
        await browse('C:/second');
        await resolve(1, 'Second');
        await reject(0);
        expect(screen.queryByText(/Synthetic detection failure/)).toBeNull();
        submit();
        expect(mutations).toHaveLength(1);
        expect(mutations[0].command).toBe(mode === 'add' ? 'add_project' : 'update_project');
        expect(mutations[0].args).toEqual(mode === 'add' ? {
            name: 'Second', path: 'C:/second', commands: ['echo Second'],
            autoStart: true, restartOnCrash: true, envVars: {},
        } : { project: { ...original, name: 'Second', path: 'C:/second', commands: ['echo Second'] } });
    });

    it.each(['success', 'failure'])('ignores an old %s while a newer detection is still pending', async outcome => {
        await start();
        await browse('C:/first');
        await browse('C:/second');
        if (outcome === 'success') await resolve(0, 'First');
        else await reject(0);
        expect(saveButton().disabled).toBe(true);
        expect(screen.getByText('Detecting project type...').getAttribute('role')).toBe('status');
        expect(screen.queryByText(/Synthetic detection failure/)).toBeNull();
        expect(value('Project Path')).toBe('C:/second');
        await resolve(1, 'Second');
        expect(saveButton().disabled).toBe(false);
    });

    it.each([
        [0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0],
    ])('owns A to B to A results in completion order %i, %i, %i', async (...order) => {
        await start();
        await browse('C:/first');
        await browse('C:/second');
        await browse('C:/first');
        for (const index of order) await resolve(index, ['Obsolete first', 'Second', 'Newest first'][index]);
        expect(value('Project Name')).toBe('Newest first');
        expect(value('Startup Commands')).toBe('echo Newest first');
        submit();
        expect(mutations[0].args.project.path).toBe('C:/first');
        expect(mutations[0].args.project.name).toBe('Newest first');
    });

    it('keeps a current failure blocked after stale success, including picker cancellation', async () => {
        await start();
        await browse('C:/first');
        await browse('C:/second');
        await reject(1);
        await resolve(0, 'Obsolete');
        bridge.open.mockResolvedValueOnce(null);
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Browse' })); });
        expect(saveButton().disabled).toBe(true);
        expect(screen.getByRole('alert').textContent).toContain('Synthetic detection failure');
        expect(value('Project Path')).toBe('C:/second');
        submit();
        expect(mutations).toHaveLength(0);
    });

    it('invalidates detection when the path is cleared and preserves intentional empty edits', async () => {
        await start();
        await browse('C:/first');
        edit('Project Name', '');
        edit('Startup Commands', '');
        edit('Project Path', '');
        await resolve(0, 'Obsolete');
        expect(value('Project Path')).toBe('');
        await browse('C:/second');
        await resolve(1, 'Second');
        expect(value('Project Name')).toBe('');
        expect(value('Startup Commands')).toBe('');
        submit();
        expect(mutations).toHaveLength(0);
    });

    it('debounces edits, including shorter paths and trailing slashes, and blocks immediate submit', async () => {
        await start();
        vi.useFakeTimers();
        edit('Project Path', 'C:/longer/new/path');
        edit('Project Path', 'C:/a/');
        submit();
        expect(saveButton().disabled).toBe(true);
        expect(mutations).toHaveLength(0);
        await tick();
        expect(requests.map(request => request.path)).toEqual(['C:/a/']);
        await resolve(0, 'Short');
        expect(value('Project Path')).toBe('C:/a/');
    });

    it.each(['browse', 'drop'])('lets %s supersede queued typing without a leftover request', async method => {
        await start();
        vi.useFakeTimers();
        edit('Project Path', 'C:/typed');
        if (method === 'browse') await browse('C:/chosen');
        else drop('C:/chosen');
        await tick();
        expect(requests.map(request => request.path)).toEqual(['C:/chosen']);
        await resolve(0, 'Chosen');
        expect(value('Project Path')).toBe('C:/chosen');
    });

    it.each(['browse', 'drop'])('lets typing supersede a pending %s detection', async method => {
        await start();
        if (method === 'browse') await browse('C:/chosen');
        else drop('C:/chosen');
        vi.useFakeTimers();
        edit('Project Path', 'C:/typed');
        await tick();
        await resolve(1, 'Typed');
        await resolve(0, 'Chosen');
        expect(value('Project Path')).toBe('C:/typed');
        expect(value('Startup Commands')).toBe('echo Typed');
    });

    it.each(['success', 'failure'])('ignores a superseded native picker %s after typing', async outcome => {
        await start();
        const picker = deferred<string | null>();
        bridge.open.mockReturnValueOnce(picker.promise);
        fireEvent.click(screen.getByRole('button', { name: 'Browse' }));
        expect(saveButton().disabled).toBe(true);
        vi.useFakeTimers();
        edit('Project Path', 'C:/typed');
        await tick();
        await resolve(0, 'Typed');
        await act(async () => {
            if (outcome === 'success') picker.resolve('C:/obsolete');
            else picker.reject(new Error('Obsolete picker failure'));
        });
        expect(requests).toHaveLength(1);
        expect(value('Project Path')).toBe('C:/typed');
        expect(screen.queryByText(/Obsolete picker failure/)).toBeNull();
    });

    it.each(['cancel', 'failure'])('restores the prior usable draft after picker %s', async outcome => {
        await start();
        if (outcome === 'cancel') bridge.open.mockResolvedValueOnce(null);
        else bridge.open.mockRejectedValueOnce(new Error('Synthetic picker failure'));
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Browse' })); });
        expect(saveButton().disabled).toBe(false);
        expect(value('Project Name')).toBe(original.name);
        expect(value('Project Path')).toBe(original.path);
        expect(value('Startup Commands')).toBe(original.commands.join('\n'));
        submit();
        expect(mutations[0].args).toEqual({ project: original });
        if (outcome === 'failure') expect(screen.getByRole('alert').textContent).toContain('try Browse again');
    });

    it('restarts a pending lookup after cancelling the picker, keeping manual edits', async () => {
        await start();
        await browse('C:/first');
        edit('Startup Commands', 'echo chosen');
        bridge.open.mockResolvedValueOnce(null);
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Browse' })); });
        expect(requests.map(request => request.path)).toEqual(['C:/first', 'C:/first']);
        await resolve(0, 'Obsolete');
        expect(saveButton().disabled).toBe(true);
        await resolve(1, 'Current');
        expect(value('Startup Commands')).toBe('echo chosen');
        expect(saveButton().disabled).toBe(false);
    });

    it.each(['Cancel', 'x', 'Escape', 'backdrop'])('retires queued detection on %s and starts a fresh reopened editor', async method => {
        await start();
        vi.useFakeTimers();
        edit('Project Path', 'C:/typed');
        if (method === 'Escape') fireEvent.keyDown(window, { key: 'Escape' });
        else if (method === 'backdrop') fireEvent.click(document.querySelector('.modal-overlay')!);
        else fireEvent.click(screen.getByRole('button', { name: method }));
        fireEvent.click(screen.getByTitle('Edit project'));
        await tick();
        expect(requests).toHaveLength(0);
        expect(value('Project Path')).toBe(original.path);
        expect(saveButton().disabled).toBe(false);
    });

    it.each(['success', 'failure'])('ignores dismissed detection %s after reopening', async outcome => {
        await start();
        await browse('C:/first');
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        fireEvent.click(screen.getByTitle('Edit project'));
        if (outcome === 'success') await resolve(0, 'Obsolete');
        else await reject(0);
        expect(value('Project Path')).toBe(original.path);
        expect(value('Project Name')).toBe(original.name);
        expect(saveButton().disabled).toBe(false);
        expect(screen.queryByRole('alert')).toBeNull();
    });

    it.each(['success', 'failure'])('ignores a dismissed picker %s after reopening', async outcome => {
        await start();
        const picker = deferred<string | null>();
        bridge.open.mockReturnValueOnce(picker.promise);
        fireEvent.click(screen.getByRole('button', { name: 'Browse' }));
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        fireEvent.click(screen.getByTitle('Edit project'));
        await act(async () => {
            if (outcome === 'success') picker.resolve('C:/obsolete');
            else picker.reject(new Error('Dismissed picker failure'));
        });
        expect(requests).toHaveLength(0);
        expect(value('Project Path')).toBe(original.path);
        expect(saveButton().disabled).toBe(false);
        expect(screen.queryByRole('alert')).toBeNull();
    });

    it('offers keyboard-accessible retry and explicit manual recovery after detection failure', async () => {
        const user = userEvent.setup();
        await start();
        await browse('C:/first');
        edit('Project Name', 'Manual name');
        edit('Startup Commands', 'echo manual');
        await reject(0);
        expect(saveButton().disabled).toBe(true);
        submit();
        expect(mutations).toHaveLength(0);
        screen.getByRole('button', { name: 'Retry detection' }).focus();
        await user.keyboard('{Enter}');
        expect(requests).toHaveLength(2);
        await reject(1);
        screen.getByRole('button', { name: 'Continue manually' }).focus();
        await user.keyboard(' ');
        expect(saveButton().disabled).toBe(false);
        submit();
        expect(mutations[0].args).toEqual({ project: {
            ...original, path: 'C:/first', name: 'Manual name', commands: ['echo manual'],
        } });
    });

    it('preserves manual commands and template environment across late detection, with explicit suggestion selection still usable', async () => {
        await start();
        await browse('C:/first');
        fireEvent.change(screen.getByRole('combobox'), { target: { value: 'node-api' } });
        await resolve(0, 'First');
        expect(value('Startup Commands')).toBe('npm install\nnpm run dev');
        const suggestion = screen.getByRole<HTMLInputElement>('checkbox', { name: /echo First/ });
        expect(suggestion.checked).toBe(false);
        fireEvent.click(suggestion);
        expect(value('Startup Commands')).toBe('echo First');
        edit('Startup Commands', 'echo manual');
        expect(suggestion.checked).toBe(false);
        fireEvent.click(suggestion);
        expect(value('Startup Commands')).toBe('echo First');
        submit();
        expect(mutations[0].args.project.env_vars).toEqual({ NODE_ENV: 'development' });
    });

    it('clears old automatic commands when the new folder has no suggestions', async () => {
        await start();
        await browse('C:/first');
        await resolve(0, 'First');
        await browse('C:/empty');
        await act(async () => { requests[1].resolve({ ...detection('Empty'), suggestions: [] }); });
        expect(value('Startup Commands')).toBe('');
        expect(screen.queryByText('Suggested Commands')).toBeNull();
    });

    it('keeps save failures retryable with the submitted snapshot while detection is retired', async () => {
        await start();
        await browse('C:/first');
        await browse('C:/second');
        await resolve(1, 'Second');
        submit();
        submit();
        expect(mutations).toHaveLength(1);
        await resolve(0, 'Obsolete');
        await act(async () => { mutations[0].reject(new Error('Synthetic save failure')); });
        expect(value('Project Name')).toBe('Second');
        expect(saveButton().disabled).toBe(false);
        submit();
        expect(mutations).toHaveLength(2);
        expect(mutations[1].args).toEqual(mutations[0].args);
    });
});
