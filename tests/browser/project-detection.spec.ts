import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import type { BridgeEntry } from './project-detection-bridge';

const origin = 'http://127.0.0.1:4181';
// Deliberately repeat the public fixture contract instead of importing a bridge
// with browser-only globals into the Node test runner.
const paths = {
    A: 'C:\\Synthetic\\ProjectA', B: 'C:\\Synthetic\\ProjectB', Empty: 'C:\\Synthetic\\Empty',
    Tall: 'C:\\Synthetic\\Tall',
    Short: 'C:\\A', Trailing: 'C:\\Synthetic\\Trailing\\',
};
const form = (page: Page) => page.locator('.add-project-modal');
const nameField = (page: Page) => form(page).getByLabel('Project Name', { exact: true });
const pathField = (page: Page) => form(page).getByLabel('Project Path', { exact: true });
const commandsField = (page: Page) => form(page).getByLabel('Startup Commands', { exact: true });
const save = (page: Page) => form(page).locator('button[type="submit"]');
const pending = (page: Page, command: string) => page.getByTestId('project-detection-pending').filter({
    has: page.getByRole('heading', { name: new RegExp(`^${command} #\\d+$`) }),
});
const operation = (page: Page, id: number) => page.getByTestId('project-detection-pending').filter({
    has: page.getByRole('heading', { name: new RegExp(` #${id}$`) }),
});
const issues = new WeakMap<Page, string[]>();

async function ledger(page: Page): Promise<BridgeEntry[]> {
    return JSON.parse(await page.getByTestId('project-detection-ledger').textContent() ?? '[]') as BridgeEntry[];
}

async function calls(page: Page, command: string) {
    return (await ledger(page)).filter(entry => entry.command === command && ['invoke', 'picker'].includes(entry.kind));
}

async function replace(page: Page, field: Locator, value: string) {
    await field.click();
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Backspace');
    if (value) await page.keyboard.insertText(value);
}

async function start(page: Page) {
    await page.goto(`${origin}/tests/browser/project-detection.html`);
    await expect(page).toHaveTitle('DevBoot synthetic project detection QA');
    await expect(page.getByRole('heading', { name: 'No Projects Yet', exact: true })).toBeVisible();
    await expect.poll(async () => (await calls(page, 'get_projects')).length).toBe(2);
    await expect.poll(async () => (await calls(page, 'get_settings')).length).toBe(2);
    await page.locator('.empty-state').getByRole('button', { name: '+ Add Project', exact: true }).click();
    await expect(form(page)).toBeVisible();
}

async function detect(page: Page, path: string) {
    const before = (await calls(page, 'detect_project_from_path')).length;
    await replace(page, pathField(page), path);
    await expect.poll(async () => (await calls(page, 'detect_project_from_path')).length).toBe(before + 1);
    const request = (await calls(page, 'detect_project_from_path')).slice(-1)[0]!;
    expect(request.args).toEqual({ path });
    return request.id;
}

async function browse(page: Page) {
    const before = (await calls(page, 'dialog:open')).length;
    await form(page).getByRole('button', { name: 'Browse', exact: true }).click();
    await expect.poll(async () => (await calls(page, 'dialog:open')).length).toBe(before + 1);
    return (await calls(page, 'dialog:open')).slice(-1)[0]!.id;
}

async function settle(page: Page, id: number, action: 'Resolve' | 'Reject' | 'Cancel picker' | 'Choose A' | 'Choose B' | 'Choose Empty' = 'Resolve') {
    await operation(page, id).getByRole('button', { name: `${action} #${id}`, exact: true }).click();
    await expect(operation(page, id)).toHaveCount(0);
}

async function detected(page: Page, label: keyof typeof paths, id: number) {
    await expect(pathField(page)).toHaveValue(paths[label]);
    await expect(nameField(page)).toHaveValue(`Synthetic ${label} #${id}`);
    await expect(commandsField(page)).toHaveValue(label === 'Empty' ? '' : `echo ${label}-${id}-recommended`);
    await expect(form(page).locator('.type-badge')).toHaveText(`Synthetic ${label}`);
    await expect(form(page).locator('.framework-badge')).toHaveText(`Fixture #${id}`);
    await expect(form(page).getByRole('status')).toHaveCount(0);
    await expect(form(page).getByRole('alert')).toHaveCount(0);
    await expect(save(page)).toBeEnabled();
}

async function blockedSave(page: Page) {
    const before = (await ledger(page)).filter(entry => ['add_project', 'update_project'].includes(entry.command));
    await expect(save(page)).toBeDisabled();
    await save(page).scrollIntoViewIfNeeded();
    const bounds = await save(page).boundingBox();
    expect(bounds).not.toBeNull();
    await page.mouse.click(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2);
    if (await nameField(page).isEnabled()) {
        await nameField(page).click();
        await page.keyboard.press('Enter');
    }
    expect((await ledger(page)).filter(entry => ['add_project', 'update_project'].includes(entry.command))).toEqual(before);
}

async function dismiss(page: Page, method: string) {
    if (method === 'close') await form(page).locator('.close-btn').click();
    else if (method === 'backdrop') await page.locator('.modal-overlay').click({ position: { x: 5, y: 5 } });
    else if (method === 'Escape') {
        // App intentionally ignores its shortcuts while a text field has focus.
        await form(page).getByRole('button', { name: 'Cancel', exact: true }).focus();
        await page.keyboard.press('Escape');
    } else await form(page).getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(form(page)).toHaveCount(0);
}

async function reopen(page: Page) {
    await page.locator('.sidebar').getByRole('button', { name: '+ Add Project', exact: true }).click();
    await expect(form(page)).toBeVisible();
}

async function screenshot(page: Page, info: TestInfo, title: string) {
    await info.attach(title, { body: await page.screenshot(), contentType: 'image/png' });
}

async function appearance(control: Locator) {
    // Read-only computed styles establish that disabled state is visible, too.
    return control.evaluate(element => {
        const styles = getComputedStyle(element);
        return { opacity: styles.opacity, cursor: styles.cursor };
    });
}

async function panelGeometry(page: Page) {
    return form(page).evaluate(panel => {
        const rect = (element: Element) => {
            const box = element.getBoundingClientRect();
            return {
                x: box.x, y: box.y, top: box.top, bottom: box.bottom,
                left: box.left, right: box.right, width: box.width, height: box.height,
            };
        };
        const overlay = panel.parentElement!;
        const fields = panel.querySelector('fieldset')!;
        const formElement = panel.querySelector('form')!;
        const scrollRegion = panel.querySelector<HTMLElement>('.project-scroll-region')!;
        const dimensions = (element: HTMLElement) => {
            const style = getComputedStyle(element);
            return {
                ...rect(element), scrollTop: element.scrollTop, scrollLeft: element.scrollLeft,
                scrollHeight: element.scrollHeight, clientHeight: element.clientHeight,
                scrollWidth: element.scrollWidth, clientWidth: element.clientWidth,
                display: style.display, flex: style.flex, minHeight: style.minHeight,
                overflowX: style.overflowX, overflowY: style.overflowY,
            };
        };
        return {
            viewport: { width: innerWidth, height: innerHeight },
            panel: rect(panel), header: rect(panel.querySelector('.modal-header')!),
            footer: rect(panel.querySelector('.modal-footer')!), form: dimensions(formElement),
            body: dimensions(scrollRegion), fields: dimensions(fields),
            overlay: { scrollTop: overlay.scrollTop, scrollHeight: overlay.scrollHeight, clientHeight: overlay.clientHeight },
            background: getComputedStyle(panel).backgroundImage,
            fixedControls: Array.from(panel.querySelectorAll('.modal-header button, .modal-footer button')).map(rect),
            fieldControls: Array.from(fields.querySelectorAll('input, button, select, textarea')).map(element => {
                const box = element.getBoundingClientRect();
                const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
                return {
                    id: element.id, tag: element.tagName, className: element.className,
                    ...rect(element), hitTag: hit?.tagName ?? null,
                    hitId: hit?.id ?? null, hitClassName: hit?.className ?? null,
                };
            }),
        };
    });
}

async function expectContainedPanel(page: Page) {
    await expect(form(page)).toHaveCSS('transform', 'none');
    const geometry = await panelGeometry(page);
    for (const box of [geometry.panel, geometry.header, geometry.footer, ...geometry.fixedControls]) {
        expect(box.top).toBeGreaterThanOrEqual(-1);
        expect(box.bottom).toBeLessThanOrEqual(geometry.viewport.height + 1);
        expect(box.left).toBeGreaterThanOrEqual(-1);
        expect(box.right).toBeLessThanOrEqual(geometry.viewport.width + 1);
    }
    for (const box of [geometry.header, geometry.footer, geometry.form, geometry.body, ...geometry.fixedControls]) {
        expect(box.top).toBeGreaterThanOrEqual(geometry.panel.top - 1);
        expect(box.bottom).toBeLessThanOrEqual(geometry.panel.bottom + 1);
        expect(box.left).toBeGreaterThanOrEqual(geometry.panel.left - 1);
        expect(box.right).toBeLessThanOrEqual(geometry.panel.right + 1);
    }
    expect(geometry.body.top).toBeGreaterThanOrEqual(geometry.header.bottom - 1);
    expect(geometry.body.bottom).toBeLessThanOrEqual(geometry.footer.top + 1);
    expect(geometry.body.clientHeight).toBeGreaterThan(0);
    expect(['auto', 'scroll']).toContain(geometry.body.overflowY);
    expect(geometry.form.scrollTop).toBe(0);
    expect(geometry.form.scrollLeft).toBe(0);
    expect(geometry.form.scrollHeight).toBeLessThanOrEqual(geometry.form.clientHeight + 1);
    expect(geometry.form.scrollWidth).toBeLessThanOrEqual(geometry.form.clientWidth + 1);
    expect(geometry.fields.scrollTop).toBe(0);
    expect(geometry.overlay.scrollTop).toBe(0);
    expect(geometry.overlay.scrollHeight).toBeLessThanOrEqual(geometry.overlay.clientHeight + 1);
    expect(geometry.background).not.toBe('none');
    return geometry;
}

async function expectControlInsideBody(control: Locator) {
    const geometry = await control.evaluate(element => {
        const box = element.getBoundingClientRect();
        const body = element.closest('.project-scroll-region')!.getBoundingClientRect();
        const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
        return {
            inside: box.top >= body.top - 1 && box.bottom <= body.bottom + 1
                && box.left >= body.left - 1 && box.right <= body.right + 1,
            hit: hit === element || (hit !== null && element.contains(hit)),
        };
    });
    expect(geometry).toEqual({ inside: true, hit: true });
}

async function wheelBody(page: Page, direction: 'top' | 'bottom') {
    const body = form(page).locator('.project-scroll-region');
    const box = await body.boundingBox();
    expect(box).not.toBeNull();
    // The right padding belongs to the body, avoiding nested textarea scroll.
    await page.mouse.move(box!.x + box!.width - 15, box!.y + box!.height / 2);
    await page.mouse.wheel(0, direction === 'top' ? -10_000 : 10_000);
    await expect.poll(async () => {
        const geometry = await panelGeometry(page);
        return direction === 'top' ? geometry.body.scrollTop
            : geometry.body.scrollHeight - geometry.body.clientHeight - geometry.body.scrollTop;
    }).toBeLessThanOrEqual(1);
    await expectContainedPanel(page);
}

async function tabTo(page: Page, target: Locator) {
    // Traverse native focus order, including fixture/background controls if the
    // previous completion removed the focused button. Never inject focus/scroll.
    for (let index = 0; index < 60; index += 1) {
        if (await target.evaluate(element => element === document.activeElement)) return;
        await page.keyboard.press('Tab');
    }
    await expect(target).toBeFocused();
}

async function capturePanel(page: Page, info: TestInfo, state: string) {
    const geometry = await panelGeometry(page);
    await info.attach(`${state}-geometry`, { body: JSON.stringify(geometry, null, 2), contentType: 'application/json' });
    await screenshot(page, info, state);
    await expectContainedPanel(page);
}

test.beforeEach(async ({ page, context }) => {
    const failures: string[] = [];
    issues.set(page, failures);
    page.on('pageerror', error => failures.push(error.message));
    context.on('page', popup => { if (popup !== page) failures.push('Unexpected popup'); });
    await context.route('**/*', route => {
        const request = route.request();
        if (new URL(request.url()).origin === origin && request.method() === 'GET') return route.continue();
        failures.push(`Unexpected network request: ${request.method()} ${request.url()}`);
        return route.abort('blockedbyclient');
    });
});

test.afterEach(async ({ page }, info) => {
    // Retain the actual boxes even when a containment/actionability assertion
    // failed before a named state capture, rather than losing its best evidence.
    if (await form(page).count()) {
        await info.attach('project-final-panel-geometry', {
            body: JSON.stringify(await panelGeometry(page), null, 2), contentType: 'application/json',
        });
    }
    if (await page.getByTestId('project-detection-ledger').count()) {
        const entries = await ledger(page);
        await info.attach('synthetic-project-command-ledger', {
            body: JSON.stringify(entries, null, 2), contentType: 'application/json',
        });
        expect(entries.filter(entry => entry.kind === 'denied')).toEqual([]);
        expect(entries.filter(entry => entry.kind === 'invoke').every(entry => [
            'get_projects', 'get_settings', 'detect_project_from_path', 'add_project', 'update_project',
            'get_project_status', 'get_project_log_snapshot',
        ].includes(entry.command))).toBe(true);
        expect(entries.filter(entry => entry.kind === 'listen' || entry.kind === 'unlisten').every(entry =>
            ['process-log-v2', 'process-status', 'process-crash'].includes(entry.command) && entry.args === null,
        )).toBe(true);
        expect(entries.filter(entry => entry.kind === 'picker').every(entry => entry.command === 'dialog:open'
            && JSON.stringify(entry.args) === JSON.stringify({ directory: true, multiple: false, title: 'Select Project Folder' }),
        )).toBe(true);
    }
    expect(issues.get(page)).toEqual([]);
});

for (const outcome of ['Resolve', 'Reject'] as const) {
    test(`older A ${outcome.toLowerCase()} cannot change the accepted B draft or its readiness`, async ({ page }) => {
        await start(page);
        const a = await detect(page, paths.A);
        const b = await detect(page, paths.B);
        await blockedSave(page);
        await settle(page, b);
        await detected(page, 'B', b);
        await settle(page, a, outcome);
        await detected(page, 'B', b);
        expect((await calls(page, 'detect_project_from_path')).map(entry => entry.args)).toEqual([{ path: paths.A }, { path: paths.B }]);
    });

    test(`older A ${outcome.toLowerCase()} cannot clear B's pending indicator or Save lock`, async ({ page }) => {
        await start(page);
        const a = await detect(page, paths.A);
        const b = await detect(page, paths.B);
        await settle(page, a, outcome);
        await expect(form(page).getByRole('status')).toHaveText('Detecting project type...');
        await expect(pathField(page)).toHaveValue(paths.B);
        await expect(nameField(page)).toHaveValue('');
        await expect(form(page).getByRole('alert')).toHaveCount(0);
        await blockedSave(page);
        await settle(page, b);
        await detected(page, 'B', b);
    });
}

test('A to B to A uses operation identity rather than matching the final path string', async ({ page }, info) => {
    await start(page);
    const firstA = await detect(page, paths.A);
    const b = await detect(page, paths.B);
    const lastA = await detect(page, paths.A);
    await settle(page, lastA);
    await detected(page, 'A', lastA);
    await settle(page, firstA);
    await settle(page, b, 'Reject');
    await detected(page, 'A', lastA);
    await screenshot(page, info, 'project-current-generation');
});

test('debounce owns rapid edits, clearing, short paths, trailing separators and unmount', async ({ page }) => {
    await start(page);
    await replace(page, nameField(page), 'Synthetic draft');
    await replace(page, pathField(page), paths.A);
    await expect(save(page)).toBeDisabled();
    await replace(page, pathField(page), paths.B);
    await expect(pending(page, 'detect_project_from_path')).toHaveCount(1);
    const b = (await calls(page, 'detect_project_from_path'))[0];
    expect(b.args).toEqual({ path: paths.B });
    await settle(page, b.id);
    await replace(page, pathField(page), paths.A);
    await replace(page, pathField(page), '');
    // Observe beyond the real 500 ms debounce; no virtual clocks or app injection.
    await page.waitForTimeout(650);
    expect(await calls(page, 'detect_project_from_path')).toHaveLength(1);
    for (const path of [paths.Short, paths.Trailing]) {
        const id = await detect(page, path);
        await settle(page, id);
        await expect(pathField(page)).toHaveValue(path);
        await expect(nameField(page)).toHaveValue('Synthetic draft');
    }
    await replace(page, pathField(page), paths.A);
    await dismiss(page, 'Cancel');
    await reopen(page);
    await page.waitForTimeout(650);
    expect(await calls(page, 'detect_project_from_path')).toHaveLength(3);
    await expect(pathField(page)).toHaveValue('');
    await expect(nameField(page)).toHaveValue('');
});

test('manual name and command edits stay authoritative across pending and later detections', async ({ page }, info) => {
    await start(page);
    const a = await detect(page, paths.A);
    await replace(page, nameField(page), 'My synthetic project');
    await replace(page, commandsField(page), 'echo manual command\necho second line');
    await settle(page, a);
    await expect(nameField(page)).toHaveValue('My synthetic project');
    await expect(commandsField(page)).toHaveValue('echo manual command\necho second line');
    await expect(form(page).locator('.suggestion-item input:checked')).toHaveCount(0);
    const b = await detect(page, paths.B);
    await settle(page, b);
    await expect(nameField(page)).toHaveValue('My synthetic project');
    await expect(commandsField(page)).toHaveValue('echo manual command\necho second line');
    await expect(form(page).locator('.suggestion-item input:checked')).toHaveCount(0);
    await screenshot(page, info, 'project-manual-draft-after-detection');

    // A deliberate checkbox change still applies exactly the chosen suggestions.
    const optional = form(page).locator('.suggestion-item').filter({ hasText: `echo B-${b}-optional` });
    await optional.getByRole('checkbox').click();
    await expect(commandsField(page)).toHaveValue(`echo B-${b}-optional`);
    await optional.getByRole('checkbox').click();
    await expect(commandsField(page)).toHaveValue('');
});

test('a template chosen while detection is pending keeps its commands and environment', async ({ page }) => {
    await start(page);
    const a = await detect(page, paths.A);
    await form(page).locator('.template-select').click();
    await page.keyboard.press('Home');
    await page.keyboard.press('Enter');
    await settle(page, a);
    await expect(nameField(page)).toHaveValue(`Synthetic A #${a}`);
    await expect(commandsField(page)).toHaveValue('source .venv/Scripts/activate\npython main.py');
    await expect(form(page).locator('.suggestion-item input:checked')).toHaveCount(0);
    await form(page).getByRole('button', { name: 'Environment (1)', exact: true }).click();
    await expect(form(page).getByPlaceholder('KEY', { exact: true })).toHaveValue('PYTHONUNBUFFERED');
    await expect(form(page).getByPlaceholder('value', { exact: true })).toHaveValue('1');
    await form(page).getByRole('button', { name: 'Commands', exact: true }).click();
    await form(page).locator('.template-select').click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await expect(commandsField(page)).toHaveValue('');
    const b = await detect(page, paths.B);
    await settle(page, b);
    await expect(commandsField(page)).toHaveValue('');
    await expect(form(page).getByRole('button', { name: 'Environment (1)', exact: true })).toBeVisible();
});

test('a new folder without suggestions clears commands generated for the previous folder', async ({ page }) => {
    await start(page);
    const a = await detect(page, paths.A);
    await settle(page, a);
    await detected(page, 'A', a);
    const empty = await detect(page, paths.Empty);
    await settle(page, empty);
    await detected(page, 'Empty', empty);
    await expect(form(page).locator('.suggestion-item')).toHaveCount(0);
});

test('failure blocks submission until explicit retry succeeds for the same current path', async ({ page }, info) => {
    await start(page);
    await replace(page, nameField(page), 'Synthetic retry draft');
    await replace(page, commandsField(page), 'echo retained');
    const a = await detect(page, paths.A);
    await settle(page, a, 'Reject');
    await expect(form(page).getByRole('alert')).toContainText(`Synthetic detect_project_from_path failure #${a}`);
    await expect(form(page).getByRole('alert')).toContainText('Your draft is unchanged');
    await blockedSave(page);
    await form(page).getByRole('alert').scrollIntoViewIfNeeded();
    await screenshot(page, info, 'project-detection-failure');
    await form(page).getByRole('button', { name: 'Retry detection', exact: true }).click();
    await expect(pending(page, 'detect_project_from_path')).toHaveCount(1);
    const retry = (await calls(page, 'detect_project_from_path')).slice(-1)[0]!;
    expect(retry.args).toEqual({ path: paths.A });
    await expect(form(page).getByRole('alert')).toHaveCount(0);
    await blockedSave(page);
    await settle(page, retry.id);
    await expect(nameField(page)).toHaveValue('Synthetic retry draft');
    await expect(commandsField(page)).toHaveValue('echo retained');
    await expect(save(page)).toBeEnabled();
});

test('Continue manually preserves the entire draft, sends exact IPC, and retains failed saves for retry', async ({ page }, info) => {
    await start(page);
    await replace(page, nameField(page), 'Synthetic manual save');
    await replace(page, commandsField(page), '  echo first  \n\n echo second ');
    await form(page).getByRole('button', { name: 'Environment (0)', exact: true }).click();
    await form(page).getByRole('button', { name: '+ Add Variable', exact: true }).click();
    await replace(page, form(page).getByPlaceholder('KEY', { exact: true }), ' SYNTHETIC_FLAG ');
    await replace(page, form(page).getByPlaceholder('value', { exact: true }), ' keep spaces ');
    await form(page).getByRole('button', { name: 'Options', exact: true }).click();
    await form(page).getByRole('checkbox', { name: /Auto-start on launch/ }).click();
    const a = await detect(page, paths.A);
    await settle(page, a, 'Reject');
    await blockedSave(page);
    await form(page).getByRole('button', { name: 'Continue manually', exact: true }).click();
    await expect(nameField(page)).toHaveValue('Synthetic manual save');
    await expect(pathField(page)).toHaveValue(paths.A);
    await expect(commandsField(page)).toHaveValue('  echo first  \n\n echo second ');
    await expect(form(page).getByRole('alert')).toHaveCount(0);
    await expect(save(page)).toBeEnabled();
    await screenshot(page, info, 'project-manual-recovery');
    const payload = {
        name: 'Synthetic manual save', path: paths.A, commands: ['echo first', 'echo second'],
        autoStart: false, restartOnCrash: true, envVars: { SYNTHETIC_FLAG: ' keep spaces ' },
    };
    await save(page).click();
    await expect(pending(page, 'add_project')).toHaveCount(1);
    const firstSave = (await calls(page, 'add_project'))[0];
    expect(firstSave.args).toEqual(payload);
    await expect(nameField(page)).toBeDisabled();
    await expect(pathField(page)).toBeDisabled();
    await expect(commandsField(page)).toBeDisabled();
    await blockedSave(page);
    await settle(page, firstSave.id, 'Reject');
    await expect(form(page)).toBeVisible();
    await expect(save(page)).toBeEnabled();
    await expect(nameField(page)).toHaveValue(payload.name);
    await save(page).click();
    await expect(pending(page, 'add_project')).toHaveCount(1);
    const secondSave = (await calls(page, 'add_project'))[1];
    expect(secondSave.args).toEqual(payload);
    await settle(page, secondSave.id);
    await expect(form(page)).toHaveCount(0);
    await expect(page.locator('.sidebar .project-name')).toHaveText(payload.name);

    // The actual App's edit route preserves options/env and uses update_project.
    await page.locator('.sidebar').getByTitle('Edit project', { exact: true }).click();
    await expect(form(page).getByRole('heading', { name: 'Edit Project', exact: true })).toBeVisible();
    const b = await detect(page, paths.B);
    await replace(page, nameField(page), 'Synthetic edited save');
    await replace(page, commandsField(page), 'echo edited');
    await settle(page, b, 'Reject');
    await form(page).getByRole('button', { name: 'Continue manually', exact: true }).click();
    await save(page).click();
    await expect(pending(page, 'update_project')).toHaveCount(1);
    const update = (await calls(page, 'update_project'))[0];
    expect(update.args).toEqual({ project: {
        id: `synthetic-project-${secondSave.id}`, name: 'Synthetic edited save', path: paths.B,
        commands: ['echo edited'], auto_start: false, restart_on_crash: true, enabled: true,
        env_vars: { SYNTHETIC_FLAG: ' keep spaces ' },
    } });
    await settle(page, update.id);
    await expect(form(page)).toHaveCount(0);
    await expect(page.locator('.sidebar .project-name')).toHaveText('Synthetic edited save');
});

for (const method of ['Cancel', 'close', 'Escape', 'backdrop']) {
    test(`${method} and reopen isolate the old detection and native picker lifetimes`, async ({ page }) => {
        await start(page);
        const a = await detect(page, paths.A);
        const picker = await browse(page);
        await dismiss(page, method);
        await reopen(page);
        const b = await detect(page, paths.B);
        await settle(page, b);
        await detected(page, 'B', b);
        await settle(page, a);
        await settle(page, picker, 'Choose A');
        await detected(page, 'B', b);
        expect(await calls(page, 'detect_project_from_path')).toHaveLength(2);
    });
}

test('typed path supersedes a held picker, and repeated Browse cannot open duplicate pickers', async ({ page }, info) => {
    await start(page);
    const a = await detect(page, paths.A);
    await settle(page, a);
    const browseButton = form(page).getByRole('button', { name: 'Browse', exact: true });
    await expect(save(page)).toBeEnabled();
    await expect(save(page)).toHaveCSS('opacity', '1');
    await expect(browseButton).toBeEnabled();
    await expect(browseButton).toHaveCSS('opacity', '1');
    const enabledSave = await appearance(save(page));
    const enabledBrowse = await appearance(browseButton);
    const picker = await browse(page);
    await expect(form(page).getByRole('status')).toHaveText('Choosing project folder...');
    await expect(browseButton).toBeDisabled();
    await expect(save(page)).toHaveCSS('opacity', '0.5');
    await expect(save(page)).toHaveCSS('cursor', 'not-allowed');
    await expect(browseButton).toHaveCSS('opacity', '0.5');
    await expect(browseButton).toHaveCSS('cursor', 'not-allowed');
    const disabledSave = await appearance(save(page));
    const disabledBrowse = await appearance(browseButton);
    expect(Number(disabledSave.opacity)).toBeLessThan(Number(enabledSave.opacity));
    expect(Number(disabledBrowse.opacity)).toBeLessThan(Number(enabledBrowse.opacity));
    expect(disabledSave.cursor).not.toBe(enabledSave.cursor);
    expect(disabledBrowse.cursor).not.toBe(enabledBrowse.cursor);
    await info.attach('project-button-availability-styles', {
        body: JSON.stringify({ enabledSave, enabledBrowse, disabledSave, disabledBrowse }, null, 2),
        contentType: 'application/json',
    });
    await screenshot(page, info, 'project-pending-picker-save-lock');
    await blockedSave(page);
    // The clickable drop-zone shares Browse's duplicate guard.
    await form(page).locator('.drop-zone').click();
    expect(await calls(page, 'dialog:open')).toHaveLength(1);
    const b = await detect(page, paths.B);
    await settle(page, picker, 'Choose A');
    await expect(pathField(page)).toHaveValue(paths.B);
    await expect(form(page).getByRole('status')).toHaveText('Detecting project type...');
    await expect(save(page)).toHaveCSS('opacity', '0.5');
    await expect(browseButton).toHaveCSS('opacity', enabledBrowse.opacity);
    await screenshot(page, info, 'project-pending-detection-save-lock');
    await settle(page, b);
    await detected(page, 'B', b);
    await expect(save(page)).toHaveCSS('opacity', enabledSave.opacity);
    await expect(save(page)).toHaveCSS('cursor', enabledSave.cursor);
    expect(await calls(page, 'detect_project_from_path')).toHaveLength(2);
});

test('picker selection owns the new lookup; cancellation restarts an interrupted lookup and failure leaves the draft', async ({ page }) => {
    await start(page);
    const firstA = await detect(page, paths.A);
    const cancelled = await browse(page);
    await settle(page, cancelled, 'Cancel picker');
    await expect(pending(page, 'detect_project_from_path')).toHaveCount(2);
    const resumedA = (await calls(page, 'detect_project_from_path')).slice(-1)[0]!.id;
    await settle(page, firstA);
    await blockedSave(page);
    await settle(page, resumedA);
    await detected(page, 'A', resumedA);

    const failed = await browse(page);
    await settle(page, failed, 'Reject');
    await expect(form(page).getByRole('alert')).toContainText('Could not open the folder picker');
    await expect(nameField(page)).toHaveValue(`Synthetic A #${resumedA}`);
    await expect(commandsField(page)).toHaveValue(`echo A-${resumedA}-recommended`);
    await expect(save(page)).toBeEnabled();
    const chosen = await browse(page);
    await settle(page, chosen, 'Choose B');
    await expect(pending(page, 'detect_project_from_path')).toHaveCount(1);
    const b = (await calls(page, 'detect_project_from_path')).slice(-1)[0]!;
    expect(b.args).toEqual({ path: paths.B });
    await settle(page, b.id);
    await detected(page, 'B', b.id);
});

test('an old detection and old save cannot change or dismiss a reopened form', async ({ page }) => {
    await start(page);
    const a = await detect(page, paths.A);
    const b = await detect(page, paths.B);
    await settle(page, b);
    await save(page).click();
    await expect(pending(page, 'add_project')).toHaveCount(1);
    const submitted = (await calls(page, 'add_project'))[0];
    expect(submitted.args).toEqual({
        name: `Synthetic B #${b}`, path: paths.B, commands: [`echo B-${b}-recommended`],
        autoStart: true, restartOnCrash: true, envVars: {},
    });
    await settle(page, a);
    await expect(nameField(page)).toHaveValue(`Synthetic B #${b}`);
    await expect(commandsField(page)).toHaveValue(`echo B-${b}-recommended`);
    await blockedSave(page);
    await dismiss(page, 'Cancel');
    await reopen(page);
    await replace(page, nameField(page), 'New synthetic draft');
    await settle(page, submitted.id);
    await expect(form(page)).toBeVisible();
    await expect(nameField(page)).toHaveValue('New synthetic draft');
    await expect(pathField(page)).toHaveValue('');
    await expect(commandsField(page)).toHaveValue('');
});

for (const height of [900, 640]) {
    test(`project panel contains pending, error, recovery and tall content at 1280x${height}`, async ({ page }, info) => {
        await page.setViewportSize({ width: 1280, height });
        await start(page);
        await replace(page, nameField(page), 'Synthetic geometry draft');
        await replace(page, commandsField(page), 'echo geometry');
        const first = await detect(page, paths.Tall);
        await wheelBody(page, 'top');
        await expect(save(page)).toBeDisabled();
        await capturePanel(page, info, `project-${height}-pending`);

        await settle(page, first, 'Reject');
        await wheelBody(page, 'top');
        const retry = form(page).getByRole('button', { name: 'Retry detection', exact: true });
        const manual = form(page).getByRole('button', { name: 'Continue manually', exact: true });
        await tabTo(page, retry);
        await expect(retry).toBeFocused();
        await expectControlInsideBody(retry);
        await tabTo(page, manual);
        await expect(manual).toBeFocused();
        await expectControlInsideBody(manual);
        await capturePanel(page, info, `project-${height}-error-recovery-controls`);
        await page.keyboard.press('Enter');
        await expect(form(page).getByRole('alert')).toHaveCount(0);
        await expect(save(page)).toBeEnabled();
        await wheelBody(page, 'bottom');
        await tabTo(page, commandsField(page));
        await expect(commandsField(page)).toBeFocused();
        await expectControlInsideBody(commandsField(page));
        await expect(commandsField(page)).toHaveValue('echo geometry');
        await capturePanel(page, info, `project-${height}-manual-recovery-bottom`);

        const tall = await detect(page, paths.Tall);
        await settle(page, tall);
        await expect(form(page).locator('.suggestion-item')).toHaveCount(8);
        await wheelBody(page, 'top');
        const top = await expectContainedPanel(page);
        expect(top.body.scrollHeight - top.body.clientHeight).toBeGreaterThan(300);
        await capturePanel(page, info, `project-${height}-tall-suggestions-top`);
        await wheelBody(page, 'bottom');
        const bottom = await expectContainedPanel(page);
        expect(bottom.body.scrollTop).toBeGreaterThan(300);
        expect(bottom.header).toEqual(top.header);
        expect(bottom.footer).toEqual(top.footer);
        await tabTo(page, commandsField(page));
        await expect(commandsField(page)).toBeFocused();
        await expectControlInsideBody(commandsField(page));
        await capturePanel(page, info, `project-${height}-tall-suggestions-bottom`);
        await wheelBody(page, 'top');
        await tabTo(page, form(page).locator('.suggestion-item input').first());
        await expectControlInsideBody(form(page).locator('.suggestion-item input').first());
        await expectContainedPanel(page);
    });
}
