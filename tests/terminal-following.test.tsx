import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import App from '../src/App';
import { Terminal } from '../src/components/Terminal';
import type { LogEvent, LogRecord, LogSnapshot } from '../src/types';

const bridge = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: bridge.invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: bridge.listen }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));

const records: LogRecord[] = [{ seq: '1', log: 'same text' }, { seq: '2', log: 'same text' }];
const props = {
    projectId: 'A', projectName: 'Fixture A', records, sessionId: 'session-A', isRunning: false,
    onClear: vi.fn(), onRestart: vi.fn(), onStop: vi.fn(), onStart: vi.fn(),
};
let listeners: Map<string, (event: { payload: unknown }) => void>;
let finishClear: ((snapshot: LogSnapshot) => void) | undefined;
const snapshot = (projectId: string, entries = records, through = '2', discarded = '0'): LogSnapshot => ({
    project_id: projectId, session_id: 'session-A', records: entries,
    through_seq: through, discarded_through: discarded, capture_error: null,
});
const emit = (payload: LogEvent) => act(() => listeners.get('process-log-v2')!({ payload }));
const select = (name: string) => fireEvent.click(within(screen.getByRole('complementary')).getByText(`Fixture ${name}`));
const pause = () => fireEvent.click(screen.getByRole('button', { name: 'Pause following' }));
const expectPaused = () => expect(screen.getByRole('button', { name: 'Resume live' })).toBeDefined();

beforeEach(() => {
    listeners = new Map(); finishClear = undefined;
    bridge.invoke.mockReset(); bridge.listen.mockReset();
    bridge.listen.mockImplementation(async (name: string, callback: (event: { payload: unknown }) => void) => {
        listeners.set(name, callback); return () => listeners.delete(name);
    });
    bridge.invoke.mockImplementation((command: string, args?: { projectId: string }) => {
        switch (command) {
            case 'get_projects': return Promise.resolve(['A', 'B'].map(id => ({
                id, name: `Fixture ${id}`, path: `C:/synthetic/${id}`, commands: [],
                enabled: true, auto_start: false, restart_on_crash: false, env_vars: {},
            })));
            case 'get_project_status': return Promise.resolve('stopped');
            case 'get_settings': return Promise.resolve({
                auto_start_with_windows: false, theme: 'dark', minimize_to_tray: true, show_notifications: false,
            });
            case 'get_project_log_snapshot': return Promise.resolve(snapshot(args!.projectId));
            case 'clear_project_log_snapshot': return new Promise<LogSnapshot>(resolve => { finishClear = resolve; });
            default: throw new Error(`Forbidden synthetic command: ${command}`);
        }
    });
});
afterEach(() => {
    cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals();
    expect(bridge.invoke.mock.calls.every(([command]) => [
        'get_projects', 'get_project_status', 'get_settings', 'get_project_log_snapshot', 'clear_project_log_snapshot',
    ].includes(command))).toBe(true);
});

it('keeps explicit pause through repeated records and status changes, then resumes on request', () => {
    const view = render(<StrictMode><Terminal {...props} /></StrictMode>);
    pause();
    for (let index = 0; index < 3; index++) {
        view.rerender(<StrictMode><Terminal {...props} records={[...records, { seq: '3', log: 'new text' }]} isRunning={index % 2 === 0} /></StrictMode>);
        expectPaused();
    }
    expect(screen.getAllByText('same text')).toHaveLength(2);
    expect(screen.getByText('new text')).toBeDefined();
    expect(Array.from(view.container.querySelectorAll('[data-log-id]'), item => item.getAttribute('data-log-id')))
        .toEqual(['session-A:1', 'session-A:2', 'session-A:3']);
    fireEvent.click(screen.getByRole('button', { name: 'Resume live' }));
    expect(screen.getByText('Following output')).toBeDefined();
    expect(bridge.invoke).not.toHaveBeenCalled();
});

it('supports native keyboard activation, focusable output, and scroll-up intent without process input', async () => {
    const user = userEvent.setup();
    render(<Terminal {...props} />);
    const button = screen.getByRole('button', { name: 'Pause following' });
    button.focus();
    await user.keyboard('{Enter}');
    expectPaused();
    expect(document.activeElement).toBe(button);
    await user.keyboard(' ');
    expect(screen.getByText('Following output')).toBeDefined();
    await user.tab();
    const body = screen.getByRole('region', { name: 'Fixture A output' });
    expect(document.activeElement).toBe(body);
    fireEvent.keyDown(body, { key: 'PageUp' });
    expectPaused();
    expect(bridge.invoke).not.toHaveBeenCalled();
});

it('pauses on upward wheel intent and keeps paused through an empty history and new output', () => {
    const view = render(<Terminal {...props} records={[]} />);
    fireEvent.wheel(screen.getByRole('region'), { deltaY: -100 });
    expectPaused();
    view.rerender(<Terminal {...props} />);
    expectPaused();
    view.rerender(<Terminal {...props} records={[]} />);
    expect(screen.getByText('No logs yet')).toBeDefined();
    expectPaused();
    view.rerender(<Terminal {...props} records={[{ seq: '4', log: 'after clear' }]} />);
    expect(screen.getByText('after clear')).toBeDefined();
    expectPaused();
});

it('starts fresh following state on A to B to A and closed-view lifetimes', async () => {
    const view = render(<App />);
    await screen.findByRole('button', { name: 'Pause following' });
    pause(); select('B');
    expect(screen.getByText('Following output')).toBeDefined();
    pause(); select('A');
    expect(screen.getByText('Following output')).toBeDefined();
    pause(); view.unmount();
    render(<App />);
    await screen.findByRole('button', { name: 'Pause following' });
});

it('keeps paused state through other-project and repeated live events in the real App', async () => {
    render(<App />);
    await screen.findByRole('button', { name: 'Pause following' });
    pause();
    const event: LogEvent = {
        kind: 'append', session_id: 'session-A', project_id: 'B',
        record: { seq: '3', log: 'B only' }, discarded_through: '0',
    };
    emit(event); emit(event);
    expectPaused();
    expect(screen.queryByText('B only')).toBeNull();
    emit({ ...event, project_id: 'A', record: { seq: '3', log: 'same text' } });
    expect(screen.getAllByText('same text')).toHaveLength(3);
    expectPaused();
});

it.each(['button', 'keyboard'])('preserves pause and post-boundary output when clear finishes (%s)', async method => {
    render(<App />);
    await screen.findByRole('button', { name: 'Pause following' });
    pause();
    if (method === 'button') fireEvent.click(screen.getByRole('button', { name: /Clear$/ }));
    else fireEvent.keyDown(screen.getByRole('region'), { key: 'l', ctrlKey: true });
    expect(finishClear).toBeTypeOf('function');
    const cleared = snapshot('A', [], '2', '2');
    emit({ kind: 'clear', snapshot: cleared });
    expect(screen.getByText('No logs yet')).toBeDefined();
    expectPaused();
    emit({ kind: 'append', project_id: 'A', session_id: 'session-A', record: { seq: '3', log: 'after clear' }, discarded_through: '2' });
    await act(async () => finishClear!(cleared));
    expect(screen.getByText('after clear')).toBeDefined();
    expect(screen.queryByText('same text')).toBeNull();
    expectPaused();
});

it('keeps capture and read notices independent from paused mode and reload callbacks', () => {
    const reload = vi.fn();
    render(<Terminal {...props} logError="Log history could not be loaded." onReloadLogs={reload} />);
    pause();
    fireEvent.click(screen.getByRole('button', { name: 'Reload logs' }));
    expect(reload).toHaveBeenCalledOnce();
    expect(screen.getByRole('alert').textContent).toContain('Log history could not be loaded.');
    expectPaused();
});

// Model the browser event ordering and integer scrollTop observed in hosted
// Chromium. These regressions supplement, rather than replace, real layout QA.
function layoutFixture() {
    let deliverResize = () => {};
    vi.stubGlobal('ResizeObserver', class {
        constructor(callback: () => void) { deliverResize = callback; }
        observe() {}
        disconnect() {}
    });
    const view = render(<Terminal {...props} />);
    const body = screen.getByRole('region');
    const layout = { height: 1000, width: 600, viewport: 200, top: 800, starts: [700, 800], rowHeight: 80 };
    const writes = vi.fn();
    Object.defineProperties(body, {
        scrollHeight: { configurable: true, get: () => layout.height },
        clientWidth: { configurable: true, get: () => layout.width },
        clientHeight: { configurable: true, get: () => layout.viewport },
        scrollTop: { configurable: true, get: () => layout.top, set: (value: number) => {
            writes(value);
            layout.top = Math.round(Math.max(0, Math.min(layout.height - layout.viewport, value)));
        } },
    });
    const rect = (top: number, height: number) => ({ top, bottom: top + height, height, left: 0, right: layout.width, width: layout.width, x: 0, y: top, toJSON() {} });
    vi.spyOn(body, 'getBoundingClientRect').mockImplementation(() => rect(0, layout.viewport));
    body.querySelectorAll<HTMLElement>('[data-log-id]').forEach((line, index) => {
        vi.spyOn(line, 'getBoundingClientRect').mockImplementation(() => rect(layout.starts[index] - layout.top, layout.rowHeight));
    });
    const resize = () => act(() => deliverResize());
    resize(); writes.mockClear();
    return { view, body, layout, writes, resize };
}

it.each(['observer first', 'scroll first'])('does not replay consumed resize over native PageUp (%s)', order => {
    const fixture = layoutFixture();
    fixture.layout.width = 700;
    fireEvent.keyDown(fixture.body, { key: 'PageUp' });
    expectPaused();
    // The browser performs its default keyboard scroll after keydown.
    fixture.layout.top = 600;
    if (order === 'observer first') fixture.resize();
    fireEvent.scroll(fixture.body);
    fixture.resize();
    expect(fixture.layout.top).toBe(600);
    expect(fixture.writes).not.toHaveBeenCalled();
});

it('still restores retained reading position for a resize without native input', () => {
    const fixture = layoutFixture();
    pause();
    fixture.layout.width = 700;
    fixture.layout.height = 1100;
    fixture.layout.starts = [800, 900];
    fixture.resize();
    expect(fixture.layout.top).toBe(900);
    expectPaused();
    fixture.writes.mockClear();
    fixture.resize();
    fixture.view.rerender(<Terminal {...props} records={[...records]} />);
    expect(fixture.writes).not.toHaveBeenCalled();
});

it('keeps a fractionally visible retained row when Chromium rounds the restoration', () => {
    const fixture = layoutFixture();
    Object.assign(fixture.layout, {
        height: 30000, viewport: 500, top: 25829, starts: [25803.5, 25829.25], rowHeight: 25.75,
    });
    pause();
    fixture.layout.height = 21079;
    fixture.layout.starts = [16882.25, 16908];
    fixture.view.rerender(<Terminal {...props} records={[...records]} />);
    expect(fixture.layout.top).toBe(16907);
    const first = Array.from(fixture.body.querySelectorAll<HTMLElement>('[data-log-id]'))
        .find(line => line.getBoundingClientRect().bottom > 0)!;
    expect(first.dataset.logId).toBe('session-A:1');
    expect(Math.abs(first.getBoundingClientRect().top - -25.5)).toBeLessThanOrEqual(1);
    expectPaused();
});
