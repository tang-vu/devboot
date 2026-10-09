import { StrictMode } from 'react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import App from '../src/App';
import type { Settings } from '../src/types';

const bridge = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: bridge.invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: bridge.listen }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: Error) => void;
    const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
    return { promise, resolve, reject };
}

const saved: Settings = {
    auto_start_with_windows: false, theme: 'dark', minimize_to_tray: false, show_notifications: false,
};
type Request = ReturnType<typeof deferred<unknown>> & { command: string; args?: { settings: Settings } };
let requests: Request[];
const calls = (command: string) => requests.filter(request => request.command === command);
const heading = () => screen.queryByRole('heading', { name: 'Settings' });
const openSettings = () => fireEvent.keyDown(window, { key: ',', ctrlKey: true });
const save = () => fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
const mutations = () => requests.filter(request => request.command !== 'get_settings');
const chooseLight = () => fireEvent.click(screen.getByRole('button', { name: 'Light' }));
const expectDraft = (expected: Settings) => {
    expect(screen.getByRole('switch', { name: 'Auto-start with Windows' }).getAttribute('aria-checked')).toBe(String(expected.auto_start_with_windows));
    expect(screen.getByRole('switch', { name: 'Minimize to system tray' }).getAttribute('aria-checked')).toBe(String(expected.minimize_to_tray));
    expect(screen.getByRole('switch', { name: 'Show notifications' }).getAttribute('aria-checked')).toBe(String(expected.show_notifications));
    if (expected.theme === 'dark' || expected.theme === 'light') {
        expect(screen.getByRole('button', { name: expected.theme === 'dark' ? 'Dark' : 'Light' }).className).toContain('active');
    }
};
const dismiss = (method: string) => {
    if (method === 'Escape') fireEvent.keyDown(window, { key: 'Escape' });
    else if (method === 'backdrop') fireEvent.click(document.querySelector('.modal-overlay')!);
    else fireEvent.click(screen.getByRole('button', { name: method }));
};

async function settle(request: Request, value?: unknown, error?: string) {
    await act(async () => {
        if (error) request.reject(new Error(error));
        else request.resolve(value);
        await request.promise.catch(() => {});
    });
}

async function start(load = true, strict = false) {
    render(strict ? <StrictMode><App /></StrictMode> : <App />);
    await screen.findAllByRole('button', { name: '+ Add Project' });
    if (load) await settle(calls('get_settings')[0], { ...saved });
    openSettings();
}

beforeEach(() => {
    requests = [];
    bridge.invoke.mockReset();
    bridge.listen.mockReset().mockResolvedValue(vi.fn());
    vi.spyOn(console, 'error').mockImplementation(() => {});
    bridge.invoke.mockImplementation((command: string, args?: { settings: Settings }) => {
        if (command === 'get_projects') return Promise.resolve([]);
        if (!['get_settings', 'update_settings', 'enable_auto_start', 'disable_auto_start'].includes(command)) {
            throw new Error(`Forbidden native command: ${command}`);
        }
        const request = { ...deferred<unknown>(), command, args };
        requests.push(request);
        return request.promise;
    });
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    expect(bridge.invoke.mock.calls.every(([command]) => [
        'get_projects', 'get_settings', 'update_settings', 'enable_auto_start', 'disable_auto_start',
    ].includes(command))).toBe(true);
});

describe('Settings lifecycle with a synthetic bridge', () => {
    it('keeps a failed save open with the edited draft for retry', async () => {
        await start();
        fireEvent.click(screen.getByRole('button', { name: 'Light' }));
        save();
        expect(calls('update_settings')[0].args).toEqual({ settings: { ...saved, theme: 'light' } });
        await settle(calls('update_settings')[0], undefined, 'Synthetic config write failure');
        expect(heading()).not.toBeNull();
        expect(screen.getByRole('button', { name: 'Light' }).className).toContain('active');
        expect(calls('disable_auto_start')).toHaveLength(0);
    });

    it('does not let an older successful save close a reopened dialog', async () => {
        await start();
        fireEvent.click(screen.getByRole('button', { name: 'Light' }));
        save();
        if (heading()) fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        openSettings();
        await settle(calls('update_settings')[0]);
        await settle(calls('disable_auto_start')[0]);
        expect(heading()).not.toBeNull();
    });

    it('cannot submit fallback defaults while initial settings are pending', async () => {
        await start(false);
        const button = screen.queryByRole<HTMLButtonElement>('button', { name: 'Save Changes' });
        if (button) fireEvent.click(button);
        expect(calls('update_settings')).toHaveLength(0);
    });

    it('shows a recoverable load failure instead of saveable defaults', async () => {
        await start(false);
        await settle(calls('get_settings')[0], undefined, 'Synthetic settings read failure');
        expect(screen.getByRole('alert').textContent).toContain('Settings could not be loaded');
        expect(screen.queryByRole('button', { name: /Retry/ })).not.toBeNull();
        const button = screen.queryByRole<HTMLButtonElement>('button', { name: 'Save Changes' });
        if (button) fireEvent.click(button);
        expect(calls('update_settings')).toHaveLength(0);
    });


    it('shows the delayed stored preferences and preserves untouched fields when saving', async () => {
        await start(false);
        expect(screen.queryAllByRole('switch')).toHaveLength(0);
        expect(screen.getByRole('status').textContent).toContain('Loading settings');
        const loaded = { ...saved, theme: 'custom-existing-theme', minimize_to_tray: true };
        await settle(calls('get_settings')[0], loaded);
        expectDraft(loaded);
        fireEvent.click(screen.getByRole('switch', { name: 'Show notifications' }));
        save();
        expect(calls('update_settings')[0].args).toEqual({ settings: { ...loaded, show_notifications: true } });
    });

    it('retries a failed read only on request and then enables editing', async () => {
        await start(false);
        await settle(calls('get_settings')[0], undefined, 'Read failed');
        expect(calls('get_settings')).toHaveLength(1);
        fireEvent.click(screen.getByRole('button', { name: 'Retry loading settings' }));
        expect(calls('get_settings')).toHaveLength(2);
        expect(screen.queryAllByRole('switch')).toHaveLength(0);
        expect(mutations()).toHaveLength(0);
        await settle(calls('get_settings')[1], { ...saved, theme: 'light' });
        expectDraft({ ...saved, theme: 'light' });
        expect(screen.queryByRole('alert')).toBeNull();
    });

    it.each(['success', 'failure'])('ignores a superseded StrictMode read %s after the current read and a save', async outcome => {
        await start(false, true);
        expect(calls('get_settings')).toHaveLength(2);
        await settle(calls('get_settings')[1], { ...saved });
        chooseLight();
        save();
        await settle(calls('update_settings')[0]);
        await settle(calls('disable_auto_start')[0]);
        expect(heading()).toBeNull();
        await settle(calls('get_settings')[0], { ...saved, auto_start_with_windows: true }, outcome === 'failure' ? 'Stale failure' : undefined);
        openSettings();
        expectDraft({ ...saved, theme: 'light' });
        expect(screen.queryByRole('alert')).toBeNull();
    });

    it.each(['Cancel', 'Close Settings', 'Escape', 'backdrop'])('discards an unsaved draft through %s without a mutation', async method => {
        await start();
        chooseLight();
        fireEvent.click(screen.getByRole('switch', { name: 'Auto-start with Windows' }));
        dismiss(method);
        expect(heading()).toBeNull();
        openSettings();
        expectDraft(saved);
        expect(mutations()).toHaveLength(0);
    });

    it('locks repeat submissions and edits across closing/reopening and both save stages', async () => {
        const user = userEvent.setup();
        await start();
        chooseLight();
        save();
        save();
        await user.click(screen.getByRole('button', { name: 'Dark' }));
        await user.click(screen.getByRole('switch', { name: 'Auto-start with Windows' }));
        expectDraft({ ...saved, theme: 'light' });
        expect(calls('update_settings')).toHaveLength(1);
        dismiss('Cancel');
        openSettings();
        expectDraft({ ...saved, theme: 'light' });
        save();
        expect(calls('update_settings')).toHaveLength(1);
        await settle(calls('update_settings')[0]);
        expect(screen.queryByText('Settings saved')).toBeNull();
        save();
        expect(calls('update_settings')).toHaveLength(1);
        expect(screen.getByRole('button', { name: 'Save Changes' }).matches(':disabled')).toBe(true);
        await settle(calls('disable_auto_start')[0]);
        expect(heading()).not.toBeNull();
        expect(screen.getByRole('button', { name: 'Save Changes' }).matches(':disabled')).toBe(false);
        expectDraft({ ...saved, theme: 'light' });
        await user.click(screen.getByRole('button', { name: 'Dark' }));
        expectDraft(saved);
    });

    it.each([false, true])('reports partial startup failure for auto-start=%s and retries the exact draft deliberately', async autoStart => {
        await start();
        chooseLight();
        if (autoStart) fireEvent.click(screen.getByRole('switch', { name: 'Auto-start with Windows' }));
        const submitted = { ...saved, theme: 'light', auto_start_with_windows: autoStart };
        const command = autoStart ? 'enable_auto_start' : 'disable_auto_start';
        save();
        await settle(calls('update_settings')[0]);
        await settle(calls(command)[0], undefined, 'Synthetic startup failure');
        expect(heading()).not.toBeNull();
        expectDraft(submitted);
        expect(within(screen.getByRole('dialog')).getByRole('alert').textContent).toContain('Preferences were saved, but the Windows startup update was not confirmed');
        expect(screen.queryByText('Settings saved')).toBeNull();
        expect(mutations().map(request => request.command)).toEqual(['update_settings', command]);
        save();
        expect(calls('update_settings')[1].args).toEqual({ settings: submitted });
        await settle(calls('update_settings')[1]);
        await settle(calls(command)[1]);
        expect(heading()).toBeNull();
        openSettings();
        expectDraft(submitted);
        expect(within(screen.getByRole('dialog')).queryByRole('alert')).toBeNull();
        expect(mutations().map(request => request.command)).toEqual(['update_settings', command, 'update_settings', command]);
    });

    it.each(['Cancel', 'Close Settings', 'Escape', 'backdrop'])('recovers a failed submitted draft, then discards it through %s', async method => {
        await start();
        chooseLight();
        save();
        dismiss('Escape');
        await settle(calls('update_settings')[0], undefined, 'Late write failure');
        expect(heading()).toBeNull();
        fireEvent.keyDown(window, { key: 'Escape' }); // A different view must not discard hidden recovery.
        openSettings();
        expectDraft({ ...saved, theme: 'light' });
        expect(within(screen.getByRole('dialog')).getByRole('alert').textContent).toContain('attempted changes');
        dismiss(method);
        openSettings();
        expectDraft(saved);
        expect(within(screen.getByRole('dialog')).queryByRole('alert')).toBeNull();
    });

    it.each(['Cancel', 'Close Settings', 'Escape', 'backdrop'])('keeps persisted preferences and the partial failure notice after %s', async method => {
        await start();
        chooseLight();
        save();
        await settle(calls('update_settings')[0]);
        await settle(calls('disable_auto_start')[0], undefined, 'Startup failed');
        fireEvent.click(screen.getByRole('switch', { name: 'Show notifications' }));
        dismiss(method);
        openSettings();
        expectDraft({ ...saved, theme: 'light' });
        expect(within(screen.getByRole('dialog')).getByRole('alert').textContent).toContain('Preferences were saved');
        expect(mutations()).toHaveLength(2);
    });

    it('retains an unresolved startup failure if the next preference write fails', async () => {
        await start();
        chooseLight();
        save();
        await settle(calls('update_settings')[0]);
        await settle(calls('disable_auto_start')[0], undefined, 'Startup failed');
        fireEvent.click(screen.getByRole('switch', { name: 'Show notifications' }));
        save();
        await settle(calls('update_settings')[1], undefined, 'Second config write failed');
        expect(within(screen.getByRole('dialog')).getAllByRole('alert')).toHaveLength(2);
        dismiss('Cancel');
        openSettings();
        expectDraft({ ...saved, theme: 'light' });
        expect(within(screen.getByRole('dialog')).getByRole('alert').textContent).toContain('Preferences were saved');
        expect(calls('disable_auto_start')).toHaveLength(1);
    });

    it('keeps new draft edits after an earlier failed save and sends the new values on retry', async () => {
        await start();
        chooseLight();
        save();
        await settle(calls('update_settings')[0], undefined, 'Write failure');
        fireEvent.click(screen.getByRole('switch', { name: 'Show notifications' }));
        save();
        expect(calls('update_settings')[1].args).toEqual({ settings: { ...saved, theme: 'light', show_notifications: true } });
        await settle(calls('update_settings')[1]);
        await settle(calls('disable_auto_start')[0]);
        expect(heading()).toBeNull();
    });

    const combinations = [false, true].flatMap(auto_start_with_windows => [false, true].flatMap(minimize_to_tray =>
        [false, true].flatMap(show_notifications => ['dark', 'light'].map(theme =>
            ({ auto_start_with_windows, minimize_to_tray, show_notifications, theme })))));
    it.each(combinations)('preserves all chosen values and action targets: %j', async expected => {
        await start();
        for (const [key, label] of [
            ['auto_start_with_windows', 'Auto-start with Windows'],
            ['minimize_to_tray', 'Minimize to system tray'],
            ['show_notifications', 'Show notifications'],
        ] as const) {
            if (expected[key] !== saved[key]) fireEvent.click(screen.getByRole('switch', { name: label }));
        }
        if (expected.theme === 'light') chooseLight();
        save();
        expect(mutations()).toHaveLength(1);
        expect(calls('update_settings')[0].args).toEqual({ settings: expected });
        await settle(calls('update_settings')[0]);
        const command = expected.auto_start_with_windows ? 'enable_auto_start' : 'disable_auto_start';
        expect(mutations().map(request => request.command)).toEqual(['update_settings', command]);
        expect(calls(command)[0].args).toBeUndefined();
        expect(heading()).not.toBeNull();
        await settle(calls(command)[0]);
        expect(heading()).toBeNull();
        openSettings();
        expectDraft(expected);
    });
});
