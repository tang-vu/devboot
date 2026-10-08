import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../src/App';
import type { Project } from '../src/types';
import { logSnapshot } from './log-fixtures';

const bridge = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: bridge.invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => vi.fn()) }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));

const original: Project = {
    id: 'synthetic-project', name: 'Fixture project', path: 'C:/synthetic/project/',
    commands: ['echo fixture'], auto_start: false, restart_on_crash: false,
    enabled: true, env_vars: { FIXTURE: 'original' },
};
const literalValue = 'spaces "quotes" $VARIABLE $(echo literal) & café';
let storedProjects: Project[];
type User = ReturnType<typeof userEvent.setup>;

beforeEach(() => {
    storedProjects = [];
    bridge.invoke.mockReset();
    bridge.invoke.mockImplementation(async (command, args) => {
        switch (command) {
            case 'get_projects': return structuredClone(storedProjects);
            case 'get_settings': return {
                auto_start_with_windows: false, theme: 'dark',
                minimize_to_tray: true, show_notifications: false,
            };
            case 'get_project_status': return 'stopped';
            case 'get_project_log_snapshot': return logSnapshot(args.projectId);
            case 'add_project': {
                const project: Project = {
                    ...original, id: 'synthetic-added', name: args.name, path: args.path,
                    commands: args.commands, auto_start: args.autoStart,
                    restart_on_crash: args.restartOnCrash, env_vars: args.envVars ?? {},
                };
                storedProjects.push(structuredClone(project));
                return structuredClone(project);
            }
            case 'update_project':
                storedProjects = storedProjects.map(project =>
                    project.id === args.project.id ? structuredClone(args.project) : project);
                return;
            default: throw new Error(`Unexpected native command: ${command}`);
        }
    });
});

afterEach(() => {
    cleanup();
    expect(bridge.invoke.mock.calls.every(([command]) => [
        'get_projects', 'get_settings', 'get_project_status', 'get_project_log_snapshot',
        'add_project', 'update_project',
    ].includes(command))).toBe(true);
});

async function openAdd(user: User) {
    await screen.findAllByRole('button', { name: '+ Add Project' });
    await user.click(screen.getAllByRole('button', { name: '+ Add Project' })[0]);
    await user.type(screen.getByLabelText('Project Name'), 'New fixture');
    await user.click(screen.getByLabelText('Project Path'));
    await user.paste('C:/synthetic/new/');
}

async function openEnvironment(user: User) {
    await user.click(screen.getByRole('button', { name: /^Environment/ }));
}

async function addVariable(user: User, key: string, value: string) {
    await user.click(screen.getByRole('button', { name: '+ Add Variable' }));
    const keys = screen.getAllByPlaceholderText('KEY');
    const values = screen.getAllByPlaceholderText('value');
    await user.type(keys[keys.length - 1], key);
    if (value) {
        await user.click(values[values.length - 1]);
        await user.paste(value);
    }
}

async function reopenEdit(user: User) {
    await user.click(await screen.findByTitle('Edit project'));
    await openEnvironment(user);
}

function mutations() {
    return bridge.invoke.mock.calls.filter(([command]) => ['add_project', 'update_project'].includes(command));
}

describe('project environment through the real form, App and project hook', () => {
    it('saves literal and empty values on creation, then restores them after reload', async () => {
        const user = userEvent.setup();
        const view = render(<App />);
        await openAdd(user);
        await openEnvironment(user);
        await addVariable(user, 'FIXTURE', literalValue);
        await addVariable(user, 'EMPTY_FIXTURE', '');
        await addVariable(user, '__proto__', 'literal name');
        await user.click(screen.getByRole('button', { name: 'Options' }));
        await user.click(screen.getByRole('button', { name: 'Add Project' }));
        await waitFor(() => expect(storedProjects[0]?.env_vars).toEqual({
            FIXTURE: literalValue, EMPTY_FIXTURE: '', ['__proto__']: 'literal name',
        }));
        expect(mutations()[0][1].envVars).toEqual(storedProjects[0].env_vars);
        view.unmount();
        render(<App />);
        await reopenEdit(user);
        expect(screen.getAllByPlaceholderText<HTMLInputElement>('value').map(input => input.value))
            .toEqual([literalValue, '', 'literal name']);
    });

    it.each(['python-bot', 'node-api'])('persists the %s template environment', async template => {
        const user = userEvent.setup();
        render(<App />);
        await openAdd(user);
        await user.selectOptions(screen.getByRole('combobox'), template);
        await user.click(screen.getByRole('button', { name: 'Add Project' }));
        await waitFor(() => expect(storedProjects[0]?.env_vars).toEqual(
            template === 'python-bot' ? { PYTHONUNBUFFERED: '1' } : { NODE_ENV: 'development' },
        ));
        await reopenEdit(user);
        expect(screen.getByPlaceholderText<HTMLInputElement>('KEY').value)
            .toBe(template === 'python-bot' ? 'PYTHONUNBUFFERED' : 'NODE_ENV');
    });

    it('edits and removes all environment entries without changing project options', async () => {
        storedProjects = [structuredClone(original)];
        const user = userEvent.setup();
        const view = render(<App />);
        await reopenEdit(user);
        const value = screen.getByPlaceholderText('value');
        await user.clear(value);
        await user.type(value, 'updated');
        await user.click(screen.getByRole('button', { name: 'Save Changes' }));
        await waitFor(() => expect(storedProjects[0]).toEqual({ ...original, env_vars: { FIXTURE: 'updated' } }));
        await reopenEdit(user);
        await user.click(view.container.querySelector<HTMLButtonElement>('.env-remove')!);
        await user.click(screen.getByRole('button', { name: 'Save Changes' }));
        await waitFor(() => expect(storedProjects[0]).toEqual({ ...original, env_vars: {} }));
        view.unmount();
        render(<App />);
        await reopenEdit(user);
        expect(screen.queryByPlaceholderText('KEY')).toBeNull();
    });

    it('retains a failed add for retry and discards cancelled edits', async () => {
        const user = userEvent.setup();
        render(<App />);
        await openAdd(user);
        await openEnvironment(user);
        await addVariable(user, 'FIXTURE', literalValue);
        bridge.invoke.mockRejectedValueOnce(new Error('Synthetic save failure'));
        await user.click(screen.getByRole('button', { name: 'Add Project' }));
        await screen.findByText(/Synthetic save failure/);
        expect(screen.getByPlaceholderText<HTMLInputElement>('value').value).toBe(literalValue);
        expect(storedProjects).toEqual([]);
        await user.click(screen.getByRole('button', { name: 'Add Project' }));
        await waitFor(() => expect(storedProjects[0]?.env_vars).toEqual({ FIXTURE: literalValue }));
        expect(mutations()[1]).toEqual(mutations()[0]);
        await reopenEdit(user);
        await user.clear(screen.getByPlaceholderText('value'));
        await user.click(screen.getByRole('button', { name: 'Cancel' }));
        await reopenEdit(user);
        expect(screen.getByPlaceholderText<HTMLInputElement>('value').value).toBe(literalValue);
        expect(mutations()).toHaveLength(2);
    });

    it('shows environment validation errors and saves the corrected name', async () => {
        const user = userEvent.setup();
        render(<App />);
        await openAdd(user);
        await openEnvironment(user);
        await addVariable(user, 'INVALID=KEY', 'fixture');
        bridge.invoke.mockRejectedValueOnce(new Error("Environment variable names cannot contain '='"));
        await user.click(screen.getByRole('button', { name: 'Add Project' }));
        await screen.findByText(/Environment variable names cannot contain/);
        expect(storedProjects).toEqual([]);
        expect(screen.getByPlaceholderText<HTMLInputElement>('value').value).toBe('fixture');
        await user.clear(screen.getByPlaceholderText('KEY'));
        await user.type(screen.getByPlaceholderText('KEY'), 'FIXTURE');
        await user.click(screen.getByRole('button', { name: 'Add Project' }));
        await waitFor(() => expect(storedProjects[0]?.env_vars).toEqual({ FIXTURE: 'fixture' }));
    });
});

function delayMutation(commandToDelay: string) {
    const originalImplementation = bridge.invoke.getMockImplementation()!;
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    bridge.invoke.mockImplementation(async (command, args) => {
        if (command === commandToDelay) await gate;
        return originalImplementation(command, args);
    });
    return release;
}

describe('pending project environment saves', () => {
    it('does not silently overwrite duplicate names from environment rows', async () => {
        const user = userEvent.setup();
        render(<App />);
        await openAdd(user);
        await openEnvironment(user);
        await addVariable(user, 'FIXTURE', 'first');
        await addVariable(user, ' FIXTURE ', 'second');
        await user.click(screen.getByRole('button', { name: 'Add Project' }));
        expect(mutations()).toHaveLength(0);
        expect(screen.getByRole('alert').textContent).toContain('names must be unique');
        const duplicate = screen.getAllByPlaceholderText('KEY')[1];
        await user.clear(duplicate);
        await user.type(duplicate, 'SECOND');
        await user.click(screen.getByRole('button', { name: 'Add Project' }));
        await waitFor(() => expect(storedProjects[0]?.env_vars).toEqual({ FIXTURE: 'first', SECOND: 'second' }));
    });

    it('keeps a newer add form open when an older dismissed save succeeds', async () => {
        const user = userEvent.setup();
        render(<App />);
        await openAdd(user);
        await openEnvironment(user);
        await addVariable(user, 'FIXTURE', 'old request');
        const release = delayMutation('add_project');
        await user.click(screen.getByRole('button', { name: 'Add Project' }));
        expect(mutations()).toHaveLength(1);
        await user.click(screen.getByRole('button', { name: 'Cancel' }));
        await openAdd(user);
        await openEnvironment(user);
        await addVariable(user, 'FIXTURE', 'new unsaved value');
        await act(async () => { release(); });
        expect(screen.queryByRole('heading', { name: 'Add Project' })).not.toBeNull();
        expect(screen.getByPlaceholderText<HTMLInputElement>('value').value).toBe('new unsaved value');
    });

    it('keeps a newer edit form open when an older dismissed edit succeeds', async () => {
        storedProjects = [structuredClone(original)];
        const user = userEvent.setup();
        render(<App />);
        await reopenEdit(user);
        await user.clear(screen.getByPlaceholderText('value'));
        await user.type(screen.getByPlaceholderText('value'), 'old request');
        const release = delayMutation('update_project');
        await user.click(screen.getByRole('button', { name: 'Save Changes' }));
        await user.click(screen.getByRole('button', { name: 'Cancel' }));
        await reopenEdit(user);
        await user.clear(screen.getByPlaceholderText('value'));
        await user.type(screen.getByPlaceholderText('value'), 'new unsaved value');
        await act(async () => { release(); });
        expect(screen.queryByRole('heading', { name: 'Edit Project' })).not.toBeNull();
        expect(screen.getByPlaceholderText<HTMLInputElement>('value').value).toBe('new unsaved value');
    });

    it('submits at most one create while the environment save is pending', async () => {
        const user = userEvent.setup();
        render(<App />);
        await openAdd(user);
        await openEnvironment(user);
        await addVariable(user, 'FIXTURE', 'value');
        const release = delayMutation('add_project');
        await user.dblClick(screen.getByRole('button', { name: 'Add Project' }));
        const submitted = mutations().length;
        // The enclosing fieldset disables its inputs and prevents unsaved edits in flight.
        expect(screen.getByLabelText('Project Name').matches(':disabled')).toBe(true);
        expect(screen.getByPlaceholderText('value').matches(':disabled')).toBe(true);
        expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Saving...' }).disabled).toBe(true);
        await act(async () => { release(); });
        expect(submitted).toBe(1);
    });

    it('preserves failed edit environment for correction and retry', async () => {
        storedProjects = [structuredClone(original)];
        const user = userEvent.setup();
        render(<App />);
        await reopenEdit(user);
        await user.clear(screen.getByPlaceholderText('value'));
        await user.type(screen.getByPlaceholderText('value'), 'edited value');
        bridge.invoke.mockRejectedValueOnce(new Error('Synthetic save failure'));
        await user.click(screen.getByRole('button', { name: 'Save Changes' }));
        await screen.findByText(/Synthetic save failure/);
        expect(screen.getByPlaceholderText<HTMLInputElement>('value').value).toBe('edited value');
        expect(storedProjects).toEqual([original]);
        await user.click(screen.getByRole('button', { name: 'Save Changes' }));
        await waitFor(() => expect(storedProjects[0].env_vars).toEqual({ FIXTURE: 'edited value' }));
    });

    it('discards a cancelled add environment and starts a fresh draft', async () => {
        const user = userEvent.setup();
        render(<App />);
        await openAdd(user);
        await openEnvironment(user);
        await addVariable(user, 'FIXTURE', 'discard me');
        await user.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(mutations()).toHaveLength(0);
        await openAdd(user);
        await openEnvironment(user);
        expect(screen.queryByPlaceholderText('KEY')).toBeNull();
    });

    it('retains a value whose name is blank, then allows correction and an empty placeholder', async () => {
        const user = userEvent.setup();
        render(<App />);
        await openAdd(user);
        await openEnvironment(user);
        await addVariable(user, ' ', 'preserve me');
        await user.click(screen.getByRole('button', { name: 'Add Project' }));
        expect(mutations()).toHaveLength(0);
        expect(screen.getByRole('alert').textContent).toContain('Enter a name');
        expect(screen.getByPlaceholderText<HTMLInputElement>('value').value).toBe('preserve me');
        await user.type(screen.getByPlaceholderText('KEY'), 'FIXTURE');
        await user.click(screen.getByRole('button', { name: '+ Add Variable' }));
        await user.click(screen.getByRole('button', { name: 'Add Project' }));
        await waitFor(() => expect(storedProjects[0]?.env_vars).toEqual({ FIXTURE: 'preserve me' }));
    });
});
