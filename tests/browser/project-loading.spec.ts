import { expect, test, type Page, type TestInfo } from '@playwright/test';
import type { BridgeEntry } from './project-loading-bridge';

const origin = 'http://127.0.0.1:4182';
const notice = (page: Page) => page.getByRole('alert', { name: 'Project list unavailable', exact: true });
const retry = (page: Page) => page.getByRole('button', { name: 'Retry projects', exact: true });
const pending = (page: Page, command: string) => page.getByTestId('project-loading-pending').filter({
    has: page.getByRole('heading', { name: new RegExp(`^${command} #\\d+$`) }),
});
const issues = new WeakMap<Page, string[]>();
async function ledger(page: Page): Promise<BridgeEntry[]> {
    return JSON.parse(await page.getByTestId('project-loading-ledger').textContent() ?? '[]');
}
async function readCount(page: Page) {
    return (await ledger(page)).filter(entry => entry.kind === 'invoke' && entry.command === 'get_projects').length;
}
async function settle(page: Page, command: string, outcome: 'Resolve' | 'Reject' | 'Reject long' | 'Empty' | 'Newer' | 'History warning' = 'Resolve', last = false) {
    const operation = last ? pending(page, command).last() : pending(page, command).first();
    await expect(operation).toBeVisible();
    await operation.getByRole('button', { name: new RegExp(`^${outcome} #\\d+$`) }).click();
}
async function start(page: Page, settleStale = true) {
    await page.goto(`${origin}/tests/browser/project-loading.html`);
    await expect(page).toHaveTitle('DevBoot synthetic project loading QA');
    await expect(pending(page, 'get_projects')).toHaveCount(2);
    await expect(page.getByText('Loading DevBoot...', { exact: true })).toBeVisible();
    if (settleStale) await settle(page, 'get_projects', 'Empty');
}
async function screenshot(page: Page, info: TestInfo, name: string) {
    await info.attach(name, { body: await page.screenshot(), contentType: 'image/png' });
}
async function projectSuccess(page: Page, logOutcome: 'Resolve' | 'Reject' | 'History warning' = 'Resolve') {
    await settle(page, 'get_projects');
    await settle(page, 'get_project_status');
    await settle(page, 'get_project_log_snapshot', logOutcome);
    await expect(page.getByRole('region', { name: 'Synthetic project output' })).toBeVisible();
}
async function historyGeometry(page: Page) {
    return page.getByRole('region', { name: 'Synthetic project output' }).evaluate(body => {
        const top = body.getBoundingClientRect().top + body.clientTop;
        const first = Array.from(body.querySelectorAll('[data-log-id]'))
            .find(line => line.getBoundingClientRect().bottom > top);
        return {
            first: first ? { id: first.getAttribute('data-log-id'), offset: first.getBoundingClientRect().top - top } : null,
            count: body.querySelectorAll('[data-log-id]').length,
            bottomGap: body.scrollHeight - body.scrollTop - body.clientHeight,
        };
    });
}
async function settledHistory(page: Page) {
    let previous = '';
    let stableSamples = 0;
    await expect.poll(async () => {
        const current = JSON.stringify(await historyGeometry(page));
        stableSamples = current === previous ? stableSamples + 1 : 0;
        previous = current;
        return stableSamples;
    }, { intervals: [40, 60, 80, 100] }).toBeGreaterThanOrEqual(2);
    return historyGeometry(page);
}
async function expectContainedRecovery(page: Page, info: TestInfo) {
    const geometry = await page.locator('.main-content').evaluate(main => {
        const box = (node: Element) => {
            const rect = node.getBoundingClientRect();
            return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, height: rect.height };
        };
        const alert = main.querySelector('[aria-label="Project list unavailable"]')!;
        const button = alert.querySelector('button')!;
        const b = button.getBoundingClientRect();
        return {
            main: box(main), alert: box(alert), button: box(button),
            terminal: main.querySelector('.terminal') ? box(main.querySelector('.terminal')!) : null,
            reachable: button.contains(document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)),
            horizontalOverflow: alert.scrollWidth > alert.clientWidth,
        };
    });
    await info.attach('recovery-geometry', { body: JSON.stringify(geometry, null, 2), contentType: 'application/json' });
    expect(geometry.alert.left).toBeGreaterThanOrEqual(geometry.main.left);
    expect(geometry.alert.right).toBeLessThanOrEqual(geometry.main.right + 1);
    expect(geometry.button.bottom).toBeLessThanOrEqual(geometry.alert.bottom);
    expect(geometry.reachable).toBe(true);
    expect(geometry.horizontalOverflow).toBe(false);
    if (geometry.terminal) {
        expect(geometry.terminal.top).toBeGreaterThanOrEqual(geometry.alert.bottom);
        expect(geometry.terminal.height).toBeGreaterThan(150);
        expect(geometry.terminal.bottom).toBeLessThanOrEqual(geometry.main.bottom + 1);
    }
}

test.beforeEach(async ({ page, context }) => {
    const failures: string[] = [];
    issues.set(page, failures);
    page.on('pageerror', error => failures.push(error.message));
    context.on('page', popup => { if (popup !== page) failures.push('Unexpected popup'); });
    await context.route('**/*', route => {
        const request = route.request();
        if (new URL(request.url()).origin === origin && request.method() === 'GET') return route.continue();
        failures.push(`Unexpected request: ${request.method()} ${request.url()}`);
        return route.abort('blockedbyclient');
    });
});
test.afterEach(async ({ page }, info) => {
    if (await page.getByTestId('project-loading-ledger').count()) {
        const entries = await ledger(page);
        await info.attach('synthetic-read-ledger', { body: JSON.stringify(entries, null, 2), contentType: 'application/json' });
        expect(entries.filter(entry => entry.kind === 'denied')).toEqual([]);
        expect(entries.filter(entry => entry.kind === 'invoke').every(entry => [
            'get_projects', 'get_settings', 'get_project_status', 'get_project_log_snapshot',
        ].includes(entry.command))).toBe(true);
    }
    expect(issues.get(page)).toEqual([]);
});

for (const width of [1280, 980]) {
    test(`initial failure, keyboard retry, repeated activation, failed retry and project recovery at ${width}px`, async ({ page }, info) => {
        await page.setViewportSize({ width, height: 900 });
        await start(page);
        await settle(page, 'get_projects', 'Reject');
        await expect(notice(page)).toContainText('Project list could not be loaded');
        await expect(page.getByRole('heading', { name: 'No Projects Yet' })).toHaveCount(0);
        await expectContainedRecovery(page, info);
        await screenshot(page, info, `initial-failure-${width}`);
        // Native Tab from the last fixture settlement moves through the real sidebar
        // to Retry. No DOM focus injection or synthetic dispatch is used.
        for (let index = 0; index < 12 && !(await retry(page).evaluate(node => node === document.activeElement)); index++) {
            await page.keyboard.press('Tab');
        }
        await expect(retry(page)).toBeFocused();
        await page.keyboard.press('Enter');
        await expect(retry(page)).toBeDisabled();
        await expect(notice(page)).toHaveAttribute('aria-busy', 'true');
        await expect(page.getByRole('status')).toContainText('Retrying project load...');
        const bounds = await retry(page).boundingBox();
        expect(bounds).not.toBeNull();
        await page.mouse.click(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2, { clickCount: 3 });
        await page.keyboard.press('Enter');
        await expect.poll(() => readCount(page)).toBe(3);
        await expect(pending(page, 'get_projects')).toHaveCount(1);
        await screenshot(page, info, `retry-pending-${width}`);
        await settle(page, 'get_projects', 'Reject');
        await expect(retry(page)).toBeEnabled();
        await expect(notice(page)).toContainText('Project list could not be loaded');
        await screenshot(page, info, `retry-failed-${width}`);
        await retry(page).click();
        await projectSuccess(page);
        await expect(notice(page)).toHaveCount(0);
        await expect(page.getByText('Synthetic retained output', { exact: true })).toBeVisible();
        await screenshot(page, info, `project-recovered-${width}`);
    });

    test(`failed refresh retains list, terminal and independent log alert at ${width}px`, async ({ page }, info) => {
        await page.setViewportSize({ width, height: 900 });
        await start(page);
        await projectSuccess(page, 'Reject');
        const terminal = page.getByRole('region', { name: 'Synthetic project output' });
        await expect(terminal.getByRole('alert')).toContainText('Log history could not be loaded');
        await expect(notice(page)).toHaveCount(0);
        await page.getByRole('button', { name: 'Pause following' }).click();
        await page.getByRole('button', { name: 'Reload logs', exact: true }).click();
        await expect(terminal).toBeVisible();
        await expect(page.getByRole('button', { name: 'Resume live' })).toBeVisible();
        await settle(page, 'get_projects', 'Reject');
        await expect(notice(page)).toContainText('Showing the last loaded project list');
        await expect(terminal.getByRole('alert')).toContainText('Log history could not be loaded');
        await expect(page.getByRole('heading', { name: 'No Projects Yet' })).toHaveCount(0);
        await expectContainedRecovery(page, info);
        await screenshot(page, info, `retained-refresh-error-${width}`);
        await retry(page).click();
        await expect(retry(page)).toBeDisabled();
        await expect(terminal).toBeVisible();
        await expect(page.getByRole('button', { name: 'Resume live' })).toBeVisible();
        await projectSuccess(page);
        await expect(notice(page)).toHaveCount(0);
        await expect(terminal.getByRole('alert')).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Resume live' })).toBeVisible();
        await screenshot(page, info, `retained-refresh-recovered-${width}`);
    });

    test(`catalog failure and retry retain unsent input and paused history anchor at ${width}px`, async ({ page }, info) => {
        await page.setViewportSize({ width, height: 900 });
        await start(page);
        await projectSuccess(page, 'History warning');
        const output = page.getByRole('region', { name: 'Synthetic project output' });
        const draft = page.getByRole('textbox', { name: 'Terminal input', exact: true });
        await draft.fill('unsent synthetic draft');
        await page.getByRole('button', { name: 'Pause following' }).click();
        await page.getByRole('button', { name: 'Reload logs', exact: true }).click();
        const bounds = await output.boundingBox();
        expect(bounds).not.toBeNull();
        await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2);
        await page.mouse.wheel(0, 550);
        const anchor = await settledHistory(page);
        expect(anchor.count).toBe(121);
        expect(anchor.first).not.toBeNull();
        expect(anchor.first!.offset).toBeLessThanOrEqual(1);
        expect(anchor.bottomGap).toBeGreaterThan(100);
        await settle(page, 'get_projects', 'Reject');
        await expect(notice(page)).toBeVisible();
        const failed = await settledHistory(page);
        expect(failed.first!.id).toBe(anchor.first!.id);
        expect(Math.abs(failed.first!.offset - anchor.first!.offset)).toBeLessThanOrEqual(1);
        await expect(draft).toHaveValue('unsent synthetic draft');
        await expect(page.getByRole('button', { name: 'Resume live' })).toBeVisible();
        await screenshot(page, info, `retained-draft-history-error-${width}`);
        await retry(page).click();
        await projectSuccess(page);
        const recovered = await settledHistory(page);
        expect(recovered.first!.id).toBe(anchor.first!.id);
        expect(Math.abs(recovered.first!.offset - anchor.first!.offset)).toBeLessThanOrEqual(1);
        await expect(draft).toHaveValue('unsent synthetic draft');
        await expect(page.getByRole('button', { name: 'Resume live' })).toBeVisible();
        await expect(notice(page)).toHaveCount(0);
        // The catalog retry does not erase this independent capture limitation.
        await expect(output.getByRole('alert')).toContainText('Log capture stopped');
        await info.attach('retained-history-anchor', {
            body: JSON.stringify({ anchor, failed, recovered }, null, 2), contentType: 'application/json',
        });
        await screenshot(page, info, `retained-draft-history-recovered-${width}`);
    });
}

test('confirmed empty success and empty retry show the genuine empty state', async ({ page }, info) => {
    await start(page);
    await settle(page, 'get_projects', 'Empty');
    await expect(page.getByRole('heading', { name: 'No Projects Yet' })).toBeVisible();
    await expect(notice(page)).toHaveCount(0);
    await start(page);
    await settle(page, 'get_projects', 'Reject');
    await retry(page).click();
    await settle(page, 'get_projects', 'Empty');
    await expect(page.getByRole('heading', { name: 'No Projects Yet' })).toBeVisible();
    await expect(notice(page)).toHaveCount(0);
    await screenshot(page, info, 'confirmed-empty-recovery');
});

for (const staleOutcome of ['Empty', 'Reject'] as const) {
    test(`older StrictMode ${staleOutcome.toLowerCase()} cannot replace current error or finish pending retry`, async ({ page }) => {
        await start(page, false);
        await settle(page, 'get_projects', 'Reject', true);
        await retry(page).click();
        await expect(pending(page, 'get_projects')).toHaveCount(2);
        await settle(page, 'get_projects', staleOutcome);
        await expect(retry(page)).toBeDisabled();
        await expect(notice(page)).toHaveAttribute('aria-busy', 'true');
        await expect(page.getByRole('heading', { name: 'No Projects Yet' })).toHaveCount(0);
        await projectSuccess(page);
        await expect(notice(page)).toHaveCount(0);
    });
}

test('status failure does not mislabel a successful catalog or hide its terminal', async ({ page }, info) => {
    await start(page);
    await settle(page, 'get_projects');
    await settle(page, 'get_project_status', 'Reject');
    await settle(page, 'get_project_log_snapshot');
    await expect(page.getByRole('region', { name: 'Synthetic project output' })).toBeVisible();
    await expect(notice(page)).toHaveCount(0);
    await expect(page.getByText('Synthetic retained output', { exact: true })).toBeVisible();
    await screenshot(page, info, 'independent-status-failure');
});

test('unmounted retry completion cannot change a freshly mounted App', async ({ page }) => {
    await start(page);
    await settle(page, 'get_projects', 'Reject');
    await retry(page).click();
    await page.getByRole('button', { name: 'Unmount App', exact: true }).click();
    await page.getByRole('button', { name: 'Mount App', exact: true }).click();
    await expect(pending(page, 'get_projects')).toHaveCount(3);
    await settle(page, 'get_projects', 'Newer');
    await expect(page.getByText('Loading DevBoot...', { exact: true })).toBeVisible();
    await expect(notice(page)).toHaveCount(0);
    await settle(page, 'get_projects', 'Empty');
    await settle(page, 'get_projects', 'Reject');
    await expect(notice(page)).toBeVisible();
    await expect(retry(page)).toBeEnabled();
    await expect(page.getByRole('region')).toHaveCount(0);
});

test('long refresh failure wraps and leaves terminal and keyboard retry usable at narrow short viewport', async ({ page }, info) => {
    await page.setViewportSize({ width: 980, height: 640 });
    await start(page);
    await projectSuccess(page, 'Reject');
    await page.getByRole('button', { name: 'Reload logs', exact: true }).click();
    await settle(page, 'get_projects', 'Reject long');
    await expect(notice(page)).toContainText('Showing the last loaded project list');
    await screenshot(page, info, 'long-refresh-error-before-scroll');
    // Tab is real keyboard navigation and scrolls the focus target into view.
    // DOM evaluation only reads focus/geometry; it never sets scrollTop.
    for (let index = 0; index < 20 && !(await retry(page).evaluate(node => node === document.activeElement)); index++) {
        await page.keyboard.press('Tab');
    }
    await expect(retry(page)).toBeFocused();
    await expectContainedRecovery(page, info);
    await expect(page.getByRole('region', { name: 'Synthetic project output' })).toBeVisible();
    await screenshot(page, info, 'long-refresh-error-keyboard-retry');
    await page.keyboard.press('Space');
    await expect(retry(page)).toBeDisabled();
    await projectSuccess(page);
    await expect(notice(page)).toHaveCount(0);
    await screenshot(page, info, 'long-refresh-error-recovered');
});
