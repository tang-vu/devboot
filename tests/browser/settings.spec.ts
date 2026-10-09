import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import type { Settings } from '../../src/types';
import type { BridgeEntry } from './settings-bridge';

const origin = 'http://127.0.0.1:4180';
const saved: Settings = {
    auto_start_with_windows: false, theme: 'dark', minimize_to_tray: false, show_notifications: false,
};
const dialog = (page: Page) => page.getByRole('dialog', { name: 'Settings', exact: true });
const button = (page: Page, name: string) => dialog(page).getByRole('button', { name, exact: true });
const pending = (page: Page, command: string) => page.getByTestId('settings-pending').filter({
    has: page.getByRole('heading', { name: new RegExp(`^${command} #\\d+$`) }),
});
const issues = new WeakMap<Page, string[]>();

async function ledger(page: Page): Promise<BridgeEntry[]> {
    return JSON.parse(await page.getByTestId('settings-ledger').textContent() ?? '[]') as BridgeEntry[];
}

async function invocations(page: Page) {
    return (await ledger(page)).filter(entry => entry.kind === 'invoke').map(({ command, args }) => ({ command, args }));
}

const call = (command: string, args: unknown = null) => ({ command, args });
const initialCalls = [call('get_projects'), call('get_settings'), call('get_projects'), call('get_settings')];

async function expectCalls(page: Page, expected: ReturnType<typeof call>[]) {
    await expect.poll(() => invocations(page)).toEqual([...initialCalls, ...expected]);
}

async function settle(page: Page, command: string, outcome: 'Resolve' | 'Reject' = 'Resolve') {
    const operation = pending(page, command).first();
    await expect(operation).toBeVisible();
    await operation.getByRole('button', { name: new RegExp(`^${outcome} ${command} #\\d+$`) }).click();
}

async function openSettings(page: Page) {
    await page.keyboard.press('Control+,');
    await expect(dialog(page)).toBeVisible();
}

async function start(page: Page, load = true) {
    await page.goto(`${origin}/tests/browser/settings.html`);
    await expect(page).toHaveTitle('DevBoot synthetic Settings QA');
    await expect(page.getByRole('heading', { name: 'No Projects Yet' })).toBeVisible();
    // Match the production entry point's StrictMode replay and settle its stale
    // read independently. The active read remains pending until explicitly resolved.
    await expect(pending(page, 'get_settings')).toHaveCount(2);
    await expectCalls(page, []);
    await settle(page, 'get_settings');
    if (load) await settle(page, 'get_settings');
    await openSettings(page);
}

async function expectDraft(page: Page, expected: Settings) {
    for (const [name, value] of [
        ['Auto-start with Windows', expected.auto_start_with_windows],
        ['Minimize to system tray', expected.minimize_to_tray],
        ['Show notifications', expected.show_notifications],
    ] as const) {
        await expect(dialog(page).getByRole('switch', { name, exact: true })).toHaveAttribute('aria-checked', String(value));
    }
    await expect(button(page, expected.theme === 'light' ? 'Light' : 'Dark')).toHaveClass(/active/);
}

async function clickDisabled(control: Locator, page: Page) {
    await expect(control).toBeDisabled();
    await control.scrollIntoViewIfNeeded();
    const bounds = await control.boundingBox();
    expect(bounds).not.toBeNull();
    // A real mouse click on a disabled native control must not dispatch an edit/save.
    await page.mouse.click(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2);
}

async function expectFrozen(page: Page, expected: Settings) {
    await expect(dialog(page).getByRole('status')).toContainText('Saving settings...');
    await expect(dialog(page).getByRole('status')).toContainText('Closing this window does not cancel the save.');
    for (const name of ['Auto-start with Windows', 'Minimize to system tray', 'Show notifications']) {
        await expect(dialog(page).getByRole('switch', { name, exact: true })).toBeDisabled();
    }
    await expect(button(page, 'Dark')).toBeDisabled();
    await expect(button(page, 'Light')).toBeDisabled();
    await clickDisabled(button(page, 'Save Changes'), page);
    await clickDisabled(button(page, 'Dark'), page);
    await clickDisabled(dialog(page).getByRole('switch', { name: 'Show notifications', exact: true }), page);
    await expectDraft(page, expected);
}

async function screenshot(page: Page, info: TestInfo, name: string) {
    await info.attach(name, { body: await page.screenshot(), contentType: 'image/png' });
}

async function dismiss(page: Page, method: string) {
    if (method === 'Escape') await page.keyboard.press('Escape');
    else if (method === 'backdrop') await page.locator('.modal-overlay').click({ position: { x: 5, y: 5 } });
    else await button(page, method).click();
    await expect(dialog(page)).toHaveCount(0);
}

test.beforeEach(async ({ page, context }) => {
    const failures: string[] = [];
    issues.set(page, failures);
    page.on('pageerror', error => failures.push(error.message));
    context.on('page', popup => {
        if (popup !== page) failures.push('Unexpected popup');
    });
    await context.route('**/*', route => {
        const request = route.request();
        if (new URL(request.url()).origin === origin && request.method() === 'GET') return route.continue();
        failures.push(`Unexpected network request: ${request.method()} ${request.url()}`);
        return route.abort('blockedbyclient');
    });
});

test.afterEach(async ({ page }, info) => {
    if (await page.getByTestId('settings-ledger').count()) {
        const entries = await ledger(page);
        await info.attach('synthetic-settings-command-ledger', {
            body: JSON.stringify(entries, null, 2), contentType: 'application/json',
        });
        expect(entries.filter(entry => entry.kind === 'denied')).toEqual([]);
        expect(entries.filter(entry => entry.kind === 'invoke').every(entry => [
            'get_projects', 'get_settings', 'update_settings', 'enable_auto_start', 'disable_auto_start',
        ].includes(entry.command))).toBe(true);
        expect(entries.filter(entry => entry.kind === 'listen' || entry.kind === 'unlisten').every(entry =>
            ['process-log-v2', 'process-status', 'process-crash'].includes(entry.command) && entry.args === null,
        )).toBe(true);
    }
    expect(issues.get(page)).toEqual([]);
});

test('loading and failed reads forbid edits and saving until an explicit retry succeeds', async ({ page }, info) => {
    await start(page, false);
    await expect(dialog(page).getByRole('status')).toHaveText('Loading settings...');
    await expect(dialog(page).getByRole('switch')).toHaveCount(0);
    await expect(button(page, 'Light')).toHaveCount(0);
    await clickDisabled(button(page, 'Save Changes'), page);
    await expectCalls(page, []);
    await screenshot(page, info, 'settings-loading');

    await settle(page, 'get_settings', 'Reject');
    await expect(dialog(page).getByRole('alert')).toContainText('Settings could not be loaded. Retry to edit your preferences.');
    await expect(dialog(page).getByRole('switch')).toHaveCount(0);
    await clickDisabled(button(page, 'Save Changes'), page);
    await screenshot(page, info, 'settings-load-error');
    await button(page, 'Retry loading settings').click();
    await expect(dialog(page).getByRole('status')).toHaveText('Loading settings...');
    await clickDisabled(button(page, 'Save Changes'), page);
    await expectCalls(page, [call('get_settings')]);
    await settle(page, 'get_settings');
    await expect(dialog(page).getByRole('alert')).toHaveCount(0);
    await expectDraft(page, saved);
    await expect(button(page, 'Save Changes')).toBeEnabled();
    await screenshot(page, info, 'settings-recovered-load');
    await expectCalls(page, [call('get_settings')]);
});

test('Tab, Space and Enter operate accessible switches and full success closes the originating dialog', async ({ page }) => {
    await start(page);
    await button(page, 'Close Settings').focus();
    const names = ['Auto-start with Windows', 'Minimize to system tray', 'Show notifications'];
    for (const [index, name] of names.entries()) {
        await page.keyboard.press('Tab');
        const toggle = dialog(page).getByRole('switch', { name, exact: true });
        await expect(toggle).toBeFocused();
        await expect(toggle).toHaveAttribute('aria-checked', 'false');
        await page.keyboard.press(index === 1 ? 'Enter' : 'Space');
        await expect(toggle).toHaveAttribute('aria-checked', 'true');
    }
    await page.keyboard.press('Tab');
    await expect(button(page, 'Dark')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(button(page, 'Light')).toBeFocused();
    await page.keyboard.press('Enter');
    const draft = { auto_start_with_windows: true, minimize_to_tray: true, show_notifications: true, theme: 'light' };
    await expectDraft(page, draft);
    await expectCalls(page, []);
    await button(page, 'Save Changes').click();
    await expectFrozen(page, draft);
    await expectCalls(page, [call('update_settings', { settings: draft })]);
    await settle(page, 'update_settings');
    await expectFrozen(page, draft);
    await expectCalls(page, [call('update_settings', { settings: draft }), call('enable_auto_start')]);
    await settle(page, 'enable_auto_start');
    await expect(dialog(page)).toHaveCount(0);
    await openSettings(page);
    await expectDraft(page, draft);
    await expectCalls(page, [call('update_settings', { settings: draft }), call('enable_auto_start')]);
});

test('preference-write failure retains the draft and retries the exact payload before startup', async ({ page }, info) => {
    await start(page);
    await button(page, 'Light').click();
    const draft = { ...saved, theme: 'light' };
    await button(page, 'Save Changes').click();
    await settle(page, 'update_settings', 'Reject');
    await expect(dialog(page).getByRole('alert')).toContainText('Settings save was not confirmed. These are your attempted changes');
    await expect(dialog(page).getByRole('alert')).toContainText('Synthetic update_settings failure');
    await expectDraft(page, draft);
    await expect(button(page, 'Save Changes')).toBeEnabled();
    await dialog(page).getByRole('alert').scrollIntoViewIfNeeded();
    await screenshot(page, info, 'settings-preference-write-failure');
    await expectCalls(page, [call('update_settings', { settings: draft })]);
    await button(page, 'Save Changes').click();
    await expect(dialog(page).getByRole('alert')).toHaveCount(0);
    await expectCalls(page, [call('update_settings', { settings: draft }), call('update_settings', { settings: draft })]);
    await settle(page, 'update_settings');
    await expectCalls(page, [call('update_settings', { settings: draft }), call('update_settings', { settings: draft }), call('disable_auto_start')]);
    await settle(page, 'disable_auto_start');
    await expect(dialog(page)).toHaveCount(0);
});

test('startup failure preserves saved preferences and its warning across reopen until a successful retry', async ({ page }, info) => {
    await start(page);
    await dialog(page).getByRole('switch', { name: 'Auto-start with Windows', exact: true }).click();
    await button(page, 'Light').click();
    const draft = { ...saved, auto_start_with_windows: true, theme: 'light' };
    await button(page, 'Save Changes').click();
    await settle(page, 'update_settings');
    await settle(page, 'enable_auto_start', 'Reject');
    await expect(dialog(page).getByRole('alert')).toContainText('Preferences were saved, but the Windows startup update was not confirmed.');
    await expect(dialog(page).getByRole('alert')).toContainText('Synthetic enable_auto_start failure');
    await expectDraft(page, draft);
    await dialog(page).getByRole('alert').scrollIntoViewIfNeeded();
    await screenshot(page, info, 'settings-partial-startup-failure');
    await dismiss(page, 'Cancel');
    await openSettings(page);
    await expectDraft(page, draft);
    await expect(dialog(page).getByRole('alert')).toContainText('Preferences were saved, but the Windows startup update was not confirmed.');
    await button(page, 'Save Changes').click();
    await settle(page, 'update_settings');
    await expectCalls(page, [
        call('update_settings', { settings: draft }), call('enable_auto_start'),
        call('update_settings', { settings: draft }), call('enable_auto_start'),
    ]);
    await settle(page, 'enable_auto_start');
    await expect(dialog(page)).toHaveCount(0);
    await openSettings(page);
    await expect(dialog(page).getByRole('alert')).toHaveCount(0);
    await expectDraft(page, draft);
    await screenshot(page, info, 'settings-recovered-startup');
});

for (const stage of ['preferences', 'startup']) {
    for (const method of ['Cancel', 'Close Settings', 'Escape', 'backdrop']) {
        test(`${method} and reopen during pending ${stage} freezes edits; old completion cannot close the new dialog`, async ({ page }) => {
            await start(page);
            await button(page, 'Light').click();
            await dialog(page).getByRole('switch', { name: 'Show notifications', exact: true }).click();
            const draft = { ...saved, theme: 'light', show_notifications: true };
            await button(page, 'Save Changes').click();
            if (stage === 'startup') await settle(page, 'update_settings');
            await expectFrozen(page, draft);
            const before = [call('update_settings', { settings: draft }), ...(stage === 'startup' ? [call('disable_auto_start')] : [])];
            await expectCalls(page, before);
            await dismiss(page, method);
            await openSettings(page);
            await expectFrozen(page, draft);
            await expectCalls(page, before);
            if (stage === 'preferences') await settle(page, 'update_settings');
            await expectFrozen(page, draft);
            await expectCalls(page, [call('update_settings', { settings: draft }), call('disable_auto_start')]);
            await settle(page, 'disable_auto_start');
            await expect(dialog(page)).toBeVisible();
            await expect(button(page, 'Save Changes')).toBeEnabled();
            await expectDraft(page, draft);
            // The reopened dialog owns this fresh save, so its completion may close it.
            await button(page, 'Dark').click();
            const newerDraft = { ...draft, theme: 'dark' };
            await button(page, 'Save Changes').click();
            await settle(page, 'update_settings');
            await expectCalls(page, [
                call('update_settings', { settings: draft }), call('disable_auto_start'),
                call('update_settings', { settings: newerDraft }), call('disable_auto_start'),
            ]);
            await settle(page, 'disable_auto_start');
            await expect(dialog(page)).toHaveCount(0);
        });
    }
}
