import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../src/App';
import type { Project } from '../src/types';
import { logSnapshot } from './log-fixtures';

const bridge = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: bridge.invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => vi.fn()) }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));

const combinations = [
    { autoStart: false, restartOnCrash: false },
    { autoStart: false, restartOnCrash: true },
    { autoStart: true, restartOnCrash: false },
    { autoStart: true, restartOnCrash: true },
];
const original: Project = {
    id: 'synthetic-project',
    name: 'Fixture project',
    path: 'C:/synthetic/project/',
    commands: ['echo fixture', 'echo second'],
    auto_start: true,
    restart_on_crash: true,
    enabled: false,
    env_vars: { FIXTURE: 'preserved' },
};
let storedProjects: Project[];

type User = ReturnType<typeof userEvent.setup>;

beforeEach(() => {
    storedProjects = [];
    bridge.invoke.mockReset();
    bridge.invoke.mockImplementation(async (command, args) => {
        switch (command) {
            case 'get_projects':
                return structuredClone(storedProjects);
            case 'get_settings':
                return {
                    auto_start_with_windows: false,
                    theme: 'dark',
                    minimize_to_tray: true,
                    show_notifications: false,
                };
            case 'get_project_status':
                return 'stopped';
            case 'get_project_log_snapshot':
                return logSnapshot(args.projectId);
            case 'add_project': {
                // Model the IPC response only; no native process or config file is accessed.
                const project: Project = {
                    id: 'synthetic-added',
                    name: args.name,
                    path: args.path,
                    commands: args.commands,
                    auto_start: args.autoStart ?? true,
                    restart_on_crash: args.restartOnCrash ?? true,
                    enabled: true,
                    env_vars: args.envVars ?? {},
                };
                storedProjects.push(project);
                return structuredClone(project);
            }
            case 'update_project':
                storedProjects = storedProjects.map(project =>
                    project.id === args.project.id ? structuredClone(args.project) : project);
                return;
            default:
                throw new Error(`Unexpected native command: ${command}`);
        }
    });
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    // Saving project choices must never change global startup or launch a process.
    const permitted = [
        'get_projects', 'get_settings', 'get_project_status', 'get_project_log_snapshot',
        'add_project', 'update_project',
    ];
    expect(bridge.invoke.mock.calls.every(([command]) => permitted.includes(command))).toBe(true);
});

async function openAdd(user: User) {
    await screen.findAllByRole('button', { name: '+ Add Project' });
    await user.click(screen.getAllByRole('button', { name: '+ Add Project' })[0]);
    await user.type(screen.getByLabelText('Project Name'), 'New fixture');
    // The trailing slash avoids unrelated project detection in this synthetic form.
    await user.click(screen.getByLabelText('Project Path'));
    await user.paste('C:/synthetic/new/');
    await user.type(screen.getByLabelText('Startup Commands'), 'echo first{Enter}echo second');
}

async function chooseOptions(user: User, options: typeof combinations[number]) {
    await user.click(screen.getByRole('button', { name: 'Options' }));
    const autoStart = screen.getByRole<HTMLInputElement>('checkbox', { name: /Auto-start on launch/ });
    const restartOnCrash = screen.getByRole<HTMLInputElement>('checkbox', { name: /Auto-restart on crash/ });
    if (autoStart.checked !== options.autoStart) await user.click(autoStart);
    if (restartOnCrash.checked !== options.restartOnCrash) await user.click(restartOnCrash);
}

function expectOptions(options: typeof combinations[number]) {
    expect(screen.getByRole<HTMLInputElement>('checkbox', { name: /Auto-start on launch/ }).checked)
        .toBe(options.autoStart);
    expect(screen.getByRole<HTMLInputElement>('checkbox', { name: /Auto-restart on crash/ }).checked)
        .toBe(options.restartOnCrash);
}

async function reopenEdit(user: User) {
    await user.click(await screen.findByTitle('Edit project'));
    await user.click(screen.getByRole('button', { name: 'Options' }));
}

function mutations() {
    return bridge.invoke.mock.calls.filter(([command]) => ['add_project', 'update_project'].includes(command));
}

describe('project option persistence through the form, App and useProjects', () => {
    it.each(['pending', 'failed'])('completes a saved add when its background log snapshot is %s', async outcome => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        const originalImplementation = bridge.invoke.getMockImplementation()!;
        bridge.invoke.mockImplementation((command, args) => {
            if (command === 'get_project_log_snapshot' && args.projectId === 'synthetic-added') {
                return outcome === 'pending' ? new Promise(() => {}) : Promise.reject(new Error('Synthetic snapshot unavailable'));
            }
            return originalImplementation(command, args);
        });
        const user = userEvent.setup();
        render(<App />);
        await openAdd(user);
        await chooseOptions(user, combinations[0]);
        await user.click(screen.getByRole('button', { name: 'Add Project' }));
        await waitFor(() => expect(screen.queryByRole('heading', { name: 'Add Project' })).toBeNull());
        expect(storedProjects).toHaveLength(1);
        expect(mutations()).toHaveLength(1);
        await reopenEdit(user);
        expectOptions(combinations[0]);
        if (outcome === 'failed') expect(consoleError).toHaveBeenCalledWith('Failed to load project logs:', expect.any(Error));
    });

    it.each(combinations)('adds and reloads $autoStart / $restartOnCrash', async options => {
        const user = userEvent.setup();
        const view = render(<App />);
        await openAdd(user);
        await chooseOptions(user, options);
        await user.click(screen.getByRole('button', { name: 'Add Project' }));

        await waitFor(() => expect(mutations()).toEqual([['add_project', {
            name: 'New fixture',
            path: 'C:/synthetic/new/',
            commands: ['echo first', 'echo second'],
            ...options,
            envVars: {},
        }]]));
        await waitFor(() => expect(screen.queryByRole('heading', { name: 'Add Project' })).toBeNull());
        await reopenEdit(user);
        expectOptions(options);
        await user.click(screen.getByRole('button', { name: 'Cancel' }));

        view.unmount();
        render(<App />);
        await reopenEdit(user);
        expectOptions(options);
    });

    for (const previous of combinations) {
        it.each(combinations)(
            `edits ${previous.autoStart} / ${previous.restartOnCrash} to $autoStart / $restartOnCrash`,
            async options => {
                storedProjects = [{
                    ...structuredClone(original),
                    auto_start: previous.autoStart,
                    restart_on_crash: previous.restartOnCrash,
                }];
                const user = userEvent.setup();
                render(<App />);
                await reopenEdit(user);
                expectOptions(previous);
                await chooseOptions(user, options);
                // Switching away from Options before saving must retain the choices.
                await user.click(screen.getByRole('button', { name: 'Commands' }));
                await user.click(screen.getByRole('button', { name: 'Save Changes' }));

                await waitFor(() => expect(mutations()).toEqual([['update_project', { project: {
                    ...original,
                    auto_start: options.autoStart,
                    restart_on_crash: options.restartOnCrash,
                } }]]));
                await waitFor(() => expect(screen.queryByRole('heading', { name: 'Edit Project' })).toBeNull());
                await reopenEdit(user);
                expectOptions(options);
            },
        );
    }

    it('discards cancelled add choices and restores true / true defaults', async () => {
        const user = userEvent.setup();
        render(<App />);
        await openAdd(user);
        await chooseOptions(user, combinations[0]);
        await user.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(mutations()).toEqual([]);
        await openAdd(user);
        await user.click(screen.getByRole('button', { name: 'Options' }));
        expectOptions(combinations[3]);
    });

    it.each(['Cancel', 'Escape', 'close', 'backdrop'])('discards an edit closed with %s', async method => {
        storedProjects = [structuredClone(original)];
        const user = userEvent.setup();
        const view = render(<App />);
        await reopenEdit(user);
        await chooseOptions(user, combinations[0]);
        if (method === 'Escape') {
            // Existing Escape shortcut is handled outside text inputs.
            await user.click(screen.getByRole('button', { name: 'Options' }));
            await user.keyboard('{Escape}');
        } else if (method === 'close') {
            await user.click(screen.getByRole('button', { name: 'x' }));
        } else if (method === 'backdrop') {
            await user.click(view.container.querySelector('.modal-overlay')!);
        } else {
            await user.click(screen.getByRole('button', { name: method }));
        }
        expect(mutations()).toEqual([]);
        await reopenEdit(user);
        expectOptions(combinations[3]);
    });

    it.each(['add', 'edit'])('keeps %s choices when saving fails, then retries them', async mode => {
        if (mode === 'edit') storedProjects = [structuredClone(original)];
        const user = userEvent.setup();
        render(<App />);
        if (mode === 'edit') await reopenEdit(user);
        else await openAdd(user);
        await chooseOptions(user, combinations[0]);
        bridge.invoke.mockRejectedValueOnce(new Error('Synthetic save failure'));
        const button = mode === 'edit' ? 'Save Changes' : 'Add Project';
        await user.click(screen.getByRole('button', { name: button }));
        await screen.findByText(/Synthetic save failure/);
        expectOptions(combinations[0]);
        expect(storedProjects).toEqual(mode === 'edit' ? [original] : []);
        await user.click(screen.getByRole('button', { name: button }));
        await waitFor(() => expect(mutations()).toHaveLength(2));
        expect(mutations()[1]).toEqual(mutations()[0]);
        await waitFor(() => expect(screen.queryByRole('heading', { name: /^(Add|Edit) Project$/ })).toBeNull());
        await reopenEdit(user);
        expectOptions(combinations[0]);
    });

    it('supports keyboard opening, option toggling and form submission', async () => {
        const user = userEvent.setup();
        render(<App />);
        await screen.findByRole('heading', { name: 'No Projects Yet' });
        await user.keyboard('{Control>}n{/Control}');
        await user.type(screen.getByLabelText('Project Name'), 'Keyboard fixture');
        await user.click(screen.getByLabelText('Project Path'));
        await user.paste('C:/synthetic/keyboard/');
        await user.click(screen.getByRole('button', { name: 'Options' }));
        await user.tab();
        expect(document.activeElement).toBe(screen.getByRole('checkbox', { name: /Auto-start on launch/ }));
        await user.keyboard(' ');
        await user.tab();
        await user.keyboard(' ');
        expectOptions(combinations[0]);
        await user.click(screen.getByLabelText('Project Name'));
        await user.keyboard('{Enter}');
        await waitFor(() => expect(mutations()).toEqual([['add_project', {
            name: 'Keyboard fixture', path: 'C:/synthetic/keyboard/', commands: [],
            autoStart: false, restartOnCrash: false,
            envVars: {},
        }]]));
    });
});
