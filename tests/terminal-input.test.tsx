import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import App from '../src/App';
import { Terminal } from '../src/components/Terminal';
import type { Project } from '../src/types';
import { logSnapshot } from './log-fixtures';

const bridge = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: bridge.invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: bridge.listen }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));

const projects: Project[] = ['A', 'B'].map(name => ({
    id: `synthetic-${name}`, name: `Fixture ${name}`, path: `C:/synthetic/${name}/`,
    commands: ['synthetic command'], auto_start: false, restart_on_crash: false,
    enabled: true, env_vars: {},
}));

function deferred() {
    let resolve!: () => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
    return { promise, resolve, reject };
}

let sends: ReturnType<typeof deferred>[];
const sendCalls = () => bridge.invoke.mock.calls.filter(([command]) => command === 'send_project_input');
const input = () => screen.getByPlaceholderText<HTMLInputElement>(/Type command|Start the process/);
const sendButton = () => screen.getByRole<HTMLButtonElement>('button', { name: /^Send/ });
const change = (value: string) => fireEvent.change(input(), { target: { value } });
const enter = (options = {}) => fireEvent.keyDown(input(), { key: 'Enter', ...options });

async function settle(index: number, outcome: 'success' | 'failure' = 'success') {
    await act(async () => {
        if (outcome === 'success') sends[index].resolve();
        else sends[index].reject(new Error('Synthetic input failure'));
        await sends[index].promise.catch(() => {});
    });
}

function terminal(isRunning = true) {
    return <Terminal projectId="synthetic-A" projectName="Fixture A" logs={[]}
        onClear={vi.fn()} onStart={vi.fn()} onStop={vi.fn()} onRestart={vi.fn()}
        isRunning={isRunning} />;
}

async function openApp() {
    const view = render(<App />);
    await screen.findByPlaceholderText('Type command and press Enter...');
    return view;
}

function select(name: 'A' | 'B') {
    fireEvent.click(within(screen.getByRole('complementary')).getByText(`Fixture ${name}`));
}

beforeEach(() => {
    sends = [];
    bridge.invoke.mockReset();
    bridge.listen.mockReset();
    bridge.listen.mockResolvedValue(vi.fn());
    bridge.invoke.mockImplementation((command: string, args?: { projectId: string }) => {
        switch (command) {
            case 'get_projects': return Promise.resolve(structuredClone(projects));
            case 'get_settings': return Promise.resolve({
                auto_start_with_windows: false, theme: 'dark',
                minimize_to_tray: true, show_notifications: false,
            });
            case 'get_project_status': return Promise.resolve('running');
            case 'get_project_log_snapshot': return Promise.resolve(logSnapshot(args!.projectId));
            case 'send_project_input': {
                const request = deferred();
                sends.push(request);
                return request.promise;
            }
            default: throw new Error(`Unexpected native command: ${command}`);
        }
    });
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    // Every native call is stubbed; lifecycle or interrupt commands are forbidden here.
    expect(bridge.invoke.mock.calls.every(([command]) => [
        'get_projects', 'get_settings', 'get_project_status', 'get_project_log_snapshot', 'send_project_input',
    ].includes(command))).toBe(true);
});

describe('terminal log notices', () => {
    const originalScrollIntoView = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView');
    beforeEach(() => {
        // JSDOM does not implement scrolling; the real Terminal renders retained logs here.
        Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
    });
    afterEach(() => {
        if (originalScrollIntoView) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', originalScrollIntoView);
        else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
    });

    it.each([
        'Log capture stopped because its sequence limit was reached. Relaunch DevBoot to resume capture.',
        'Live log updates are unavailable. Reopen DevBoot to reconnect; refresh can reload retained history.',
    ])('shows the log notice with retained output: %s', notice => {
        render(<Terminal projectId="synthetic-A" projectName="Fixture A" logs={['retained output']}
            logError={notice} onClear={vi.fn()} onStart={vi.fn()} onStop={vi.fn()}
            onRestart={vi.fn()} isRunning />);
        expect(screen.getByRole('alert').textContent).toBe(notice);
        expect(screen.getByText('retained output')).toBeDefined();
        expect(input().disabled).toBe(false);
        expect(sendCalls()).toEqual([]);
    });

    it('routes a captured sequence exhaustion notice through App for the selected project', async () => {
        const originalImplementation = bridge.invoke.getMockImplementation()!;
        bridge.invoke.mockImplementation((command: string, args?: { projectId: string }) => {
            if (command === 'get_project_log_snapshot' && args?.projectId === 'synthetic-A') {
                return Promise.resolve(logSnapshot(args.projectId, ['last captured A line'], { capture_error: 'sequence_exhausted' }));
            }
            return originalImplementation(command, args);
        });
        await openApp();
        expect((await screen.findByRole('alert')).textContent).toContain('sequence limit');
        expect(screen.getByText('last captured A line')).toBeDefined();
        select('B');
        expect(screen.queryByRole('alert')).toBeNull();
        select('A');
        expect(screen.getByRole('alert').textContent).toContain('Relaunch DevBoot');
    });

    it('shows listener failure and usable snapshot history through the real App', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        bridge.listen.mockRejectedValueOnce(new Error('Synthetic log listener failure'));
        const originalImplementation = bridge.invoke.getMockImplementation()!;
        bridge.invoke.mockImplementation((command: string, args?: { projectId: string }) => {
            if (command === 'get_project_log_snapshot') return Promise.resolve(logSnapshot(args!.projectId, ['fallback history']));
            return originalImplementation(command, args);
        });
        await openApp();
        expect((await screen.findByRole('alert')).textContent).toContain('Live log updates are unavailable');
        expect(await screen.findByText('fallback history')).toBeDefined();
        expect(input().disabled).toBe(false);
        expect(console.error).toHaveBeenCalledWith('Failed to set up project listeners:', expect.any(Error));
    });

    it('reloads failed log history through the App notice using read-only commands', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const originalImplementation = bridge.invoke.getMockImplementation()!;
        let attempts = 0;
        bridge.invoke.mockImplementation((command: string, args?: { projectId: string }) => {
            if (command === 'get_project_log_snapshot' && args?.projectId === 'synthetic-A') {
                attempts++;
                return attempts === 1
                    ? Promise.reject(new Error('Synthetic log read failure'))
                    : Promise.resolve(logSnapshot(args.projectId, ['recovered log history']));
            }
            return originalImplementation(command, args);
        });
        await openApp();
        expect((await screen.findByRole('alert')).textContent).toContain('Log history could not be loaded');
        expect(attempts).toBe(1);
        fireEvent.click(screen.getByRole('button', { name: 'Reload logs' }));
        expect(await screen.findByText('recovered log history')).toBeDefined();
        expect(screen.queryByRole('alert')).toBeNull();
        expect(attempts).toBe(2);
        expect(bridge.invoke.mock.calls.filter(([command]) => command === 'get_projects')).toHaveLength(2);
        expect(bridge.invoke.mock.calls.every(([command]) => [
            'get_projects', 'get_project_status', 'get_project_log_snapshot', 'get_settings',
        ].includes(command))).toBe(true);
    });
});

describe('terminal input request ownership', () => {
    it('sends the exact draft only when requested, then clears an unchanged draft', async () => {
        render(<StrictMode>{terminal()}</StrictMode>);
        const literal = '  quotes "value" $VARIABLE $(literal) & café  ';
        change(literal);
        expect(sendCalls()).toEqual([]);
        enter();
        expect(sendCalls()).toEqual([['send_project_input', { projectId: 'synthetic-A', input: literal }]]);
        expect(input().value).toBe(literal);
        await settle(0);
        expect(input().value).toBe('');
    });

    it.each(['new draft', 'original'])('preserves edits made while sending, even if changed back to %s', async value => {
        render(terminal());
        change('original');
        enter();
        change('intermediate edit');
        change(value);
        await settle(0);
        expect(input().value).toBe(value);
        expect(sendCalls()).toHaveLength(1);
    });

    it('blocks repeated Enter and clicks synchronously while leaving the draft editable', async () => {
        render(terminal());
        change('first draft');
        act(() => {
            enter();
            enter();
            fireEvent.click(sendButton());
            fireEvent.click(sendButton());
        });
        expect(sendCalls()).toHaveLength(1);
        expect(sendButton().disabled).toBe(true);
        expect(input().disabled).toBe(false);
        change('next draft');
        enter();
        expect(sendCalls()).toHaveLength(1);
        await settle(0);
        expect(sendButton().disabled).toBe(false);
        fireEvent.click(sendButton());
        expect(sendCalls()[1][1]).toEqual({ projectId: 'synthetic-A', input: 'next draft' });
        await settle(1);
    });

    it.each([false, true])('keeps text and reports a rejected request for retry (edited: %s)', async edited => {
        render(terminal());
        change('failed draft');
        enter();
        if (edited) change('newer draft');
        await settle(0, 'failure');
        expect(screen.getByRole('alert').textContent).toContain('Failed to send input');
        expect(input().value).toBe(edited ? 'newer draft' : 'failed draft');
        expect(sendButton().disabled).toBe(false);
        fireEvent.click(sendButton());
        expect(screen.queryByRole('alert')).toBeNull();
        expect(sendCalls()[1][1].input).toBe(edited ? 'newer draft' : 'failed draft');
        await settle(1);
        expect(input().value).toBe('');
    });

    it.each(['success', 'failure'] as const)('does not affect a reopened terminal when an unmounted request ends in %s', async outcome => {
        const view = render(terminal());
        change('old draft');
        enter();
        view.unmount();
        render(terminal());
        expect(input().value).toBe('');
        change('reopened draft');
        enter();
        await settle(0, outcome);
        expect(input().value).toBe('reopened draft');
        expect(screen.queryByRole('alert')).toBeNull();
        expect(sendButton().disabled).toBe(true);
        await settle(1);
        expect(input().value).toBe('');
    });

    it('retains a stopped draft and never sends automatically when running resumes', async () => {
        const view = render(terminal());
        change('pending draft');
        enter();
        change('next draft');
        view.rerender(terminal(false));
        expect(input().disabled).toBe(true);
        enter();
        expect(sendCalls()).toHaveLength(1);
        await settle(0);
        expect(input().value).toBe('next draft');
        expect(sendButton().disabled).toBe(true);
        view.rerender(terminal());
        expect(input().value).toBe('next draft');
        expect(sendCalls()).toHaveLength(1);
        enter();
        await settle(1);
    });

    it('keeps a pending send locked across stopped/running transitions and permits a failed retry', async () => {
        const view = render(terminal(false));
        expect(input().disabled).toBe(true);
        enter();
        expect(sendCalls()).toEqual([]);
        view.rerender(terminal());
        change('retry after stop');
        enter();
        view.rerender(terminal(false));
        view.rerender(terminal());
        enter();
        expect(sendCalls()).toHaveLength(1);
        expect(sendButton().disabled).toBe(true);
        await settle(0, 'failure');
        expect(input().value).toBe('retry after stop');
        expect(screen.getByRole('alert').textContent).toContain('Failed to send input');
        enter();
        await settle(1);
        expect(input().value).toBe('');
    });

    it('does not submit blank input, Shift+Enter, IME confirmation, or held Enter', async () => {
        render(terminal());
        change('   ');
        enter();
        expect(sendCalls()).toEqual([]);
        change('入力');
        expect(enter({ shiftKey: true })).toBe(true);
        expect(enter({ isComposing: true })).toBe(true);
        expect(enter({ keyCode: 229 })).toBe(true);
        expect(enter({ repeat: true })).toBe(true);
        expect(sendCalls()).toEqual([]);
        expect(input().value).toBe('入力');
        expect(enter()).toBe(false);
        expect(sendCalls()).toHaveLength(1);
        await settle(0);
    });
});

describe('terminal selection through the real App and project hook', () => {
    it('discards drafts on project switches, including A to B to A', async () => {
        await openApp();
        change('A draft');
        select('B');
        expect(input().value).toBe('');
        change('B draft');
        select('A');
        expect(input().value).toBe('');
        expect(sendCalls()).toEqual([]);
    });

    it.each(['success', 'failure'] as const)('keeps B draft and pending send when A completes with %s', async outcome => {
        await openApp();
        change('A draft');
        enter();
        select('B');
        change('B draft');
        enter();
        expect(sendCalls().map(([, args]) => args)).toEqual([
            { projectId: 'synthetic-A', input: 'A draft' },
            { projectId: 'synthetic-B', input: 'B draft' },
        ]);
        await settle(0, outcome);
        expect(input().value).toBe('B draft');
        expect(screen.queryByRole('alert')).toBeNull();
        expect(sendButton().disabled).toBe(true);
        await settle(1);
        expect(input().value).toBe('');
    });

    it.each(['success', 'failure'] as const)('ignores the first A request after A to B to A (%s)', async outcome => {
        await openApp();
        change('old A draft');
        enter();
        select('B');
        select('A');
        change('new A draft');
        enter();
        await settle(0, outcome);
        expect(input().value).toBe('new A draft');
        expect(screen.queryByRole('alert')).toBeNull();
        expect(sendButton().disabled).toBe(true);
        await settle(1);
        expect(input().value).toBe('');
    });
});
