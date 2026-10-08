import { expect, test, type Page, type TestInfo } from '@playwright/test';

type Anchor = { id: string; offset: number; text: string };
type Geometry = {
    top: number;
    height: number;
    viewport: number;
    bottomGap: number;
    count: number;
    first: Anchor | null;
};

const region = (page: Page) => page.getByRole('region', { name: /Synthetic (alpha|beta) output/ });
const control = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const mode = (page: Page) => page.locator('.terminal-follow-controls [role="status"]').first();

async function geometry(page: Page): Promise<Geometry> {
    return region(page).evaluate(body => {
        const top = body.getBoundingClientRect().top + body.clientTop;
        const lines = Array.from(body.querySelectorAll<HTMLElement>('[data-log-id]'));
        const first = lines.find(line => line.getBoundingClientRect().bottom > top);
        return {
            top: body.scrollTop, height: body.scrollHeight, viewport: body.clientHeight,
            bottomGap: body.scrollHeight - body.clientHeight - body.scrollTop,
            count: lines.length,
            first: first ? {
                id: first.dataset.logId!, offset: first.getBoundingClientRect().top - top,
                text: first.textContent ?? '',
            } : null,
        };
    });
}

async function settled(page: Page): Promise<Geometry> {
    let previous = '';
    let stableSamples = 0;
    await expect.poll(async () => {
        const current = JSON.stringify(await geometry(page));
        stableSamples = current === previous ? stableSamples + 1 : 0;
        previous = current;
        return stableSamples;
    }, { intervals: [40, 60, 80, 100] }).toBeGreaterThanOrEqual(2);
    return geometry(page);
}

async function expectFollowing(page: Page) {
    await expect(mode(page)).toHaveText('Following output');
    await expect(control(page, 'Pause following')).toBeVisible();
    await expect.poll(async () => Math.abs((await geometry(page)).bottomGap)).toBeLessThanOrEqual(2);
}

async function expectPaused(page: Page) {
    await expect(mode(page)).toHaveText('Reading history');
    await expect(control(page, 'Resume live')).toBeVisible();
}

async function expectAnchor(page: Page, anchor: Anchor) {
    await expectPaused(page);
    await expect.poll(async () => (await geometry(page)).first?.id).toBe(anchor.id);
    await expect.poll(async () => Math.abs((await geometry(page)).first!.offset - anchor.offset)).toBeLessThanOrEqual(1);
}

async function wheelIntoHistory(page: Page, pixels = 650): Promise<Anchor> {
    const box = await region(page).boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.wheel(0, -pixels);
    await expectPaused(page);
    const current = await settled(page);
    expect(current.bottomGap).toBeGreaterThan(100);
    expect(current.first).not.toBeNull();
    return current.first!;
}

async function wrappedAnchor(page: Page): Promise<Anchor> {
    let anchor = await wheelIntoHistory(page);
    for (let attempt = 0; !anchor.text.includes('wrapped geometry marker') && attempt < 20; attempt++) {
        const box = await region(page).boundingBox();
        await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
        await page.mouse.wheel(0, -60);
        anchor = (await settled(page)).first!;
    }
    expect(anchor.text).toContain('wrapped geometry marker');
    return anchor;
}

async function evidence(page: Page, info: TestInfo, label: string) {
    await info.attach(`${label}-geometry`, {
        body: JSON.stringify(await geometry(page), null, 2), contentType: 'application/json',
    });
    await info.attach(label, { body: await page.screenshot(), contentType: 'image/png' });
}

async function anchorEvidence(page: Page, info: TestInfo, label: string, anchor: Anchor) {
    const measured = await region(page).evaluate((body, id) => {
        const top = body.getBoundingClientRect().top + body.clientTop;
        const lines = Array.from(body.querySelectorAll<HTMLElement>('[data-log-id]'));
        const measure = (line: HTMLElement) => {
            const bounds = line.getBoundingClientRect();
            return { id: line.dataset.logId, offset: bounds.top - top,
                bottom: bounds.bottom - top, height: bounds.height };
        };
        const original = lines.find(line => line.dataset.logId === id);
        return {
            scrollTop: body.scrollTop, scrollHeight: body.scrollHeight,
            clientHeight: body.clientHeight, clientWidth: body.clientWidth,
            original: original ? measure(original) : null,
            visible: lines.filter(line => line.getBoundingClientRect().bottom > top).slice(0, 3).map(measure),
        };
    }, anchor.id);
    await info.attach(label, {
        body: JSON.stringify({ captured: anchor, measured }, null, 2), contentType: 'application/json',
    });
}

test.beforeEach(async ({ page }) => {
    await page.goto('/tests/browser/log-follow.html');
    await expect(page.getByRole('heading', { name: 'DevBoot synthetic log-follow QA' })).toBeVisible();
    await expectFollowing(page);
});

test('follows repeated, wrapped, burst and sustained output with distinct identities', async ({ page }, info) => {
    await control(page, 'Append one').click();
    await control(page, 'Append 20 identical').click();
    await control(page, 'Append 3 wrapped').click();
    await expect(page.locator('.log-line')).toHaveCount(204);
    const repeated = page.locator('.log-line').filter({ hasText: /^identical repeated message$/ });
    await expect(repeated).toHaveCount(20);
    const identities = await repeated.evaluateAll(lines => lines.map(line => line.getAttribute('data-log-id')));
    expect(new Set(identities).size).toBe(20);
    await expectFollowing(page);

    for (let batch = 0; batch < 3; batch++) {
        await control(page, 'Append 300').click();
        await expectFollowing(page);
    }
    await expect(page.locator('.log-line')).toHaveCount(1000);
    const oldLastId = await page.locator('.log-line').last().getAttribute('data-log-id');
    await control(page, 'Start sustained output').click();
    await expect.poll(() => page.locator('.log-line').last().getAttribute('data-log-id')).not.toBe(oldLastId);
    await expectFollowing(page);
    await control(page, 'Stop sustained output').click();
    await settled(page);
    await expectFollowing(page);
    await expect(page.locator('.log-line')).toHaveCount(1000);
    await evidence(page, info, 'following-capped-output');
});

test('wheel pauses and preserves identity and offset through own and unrelated output', async ({ page }, info) => {
    const anchor = await wheelIntoHistory(page);
    for (const action of ['Append one', 'Append 20 identical', 'Append 3 wrapped', 'Append 300', 'Append other project']) {
        await control(page, action).click();
        await expectAnchor(page, anchor);
    }
    await expect(page.locator('.fixture-summary')).toContainText('other records: 181');
    const count = await page.locator('.log-line').count();
    await control(page, 'Start sustained output').click();
    await expect.poll(() => page.locator('.log-line').count()).toBeGreaterThanOrEqual(count + 12);
    await expectAnchor(page, anchor);
    await control(page, 'Stop sustained output').click();
    await settled(page);
    await expectAnchor(page, anchor);
    await evidence(page, info, 'paused-retained-history');
    await control(page, 'Resume live').click();
    await expectFollowing(page);
    await expect(page.locator('.history-notice')).toHaveCount(0);
});

test('explicit pause at the tail holds position until keyboard resume', async ({ page }) => {
    const pause = control(page, 'Pause following');
    await pause.focus();
    await expect(pause).toBeFocused();
    await page.keyboard.press('Space');
    await expectPaused(page);
    const anchor = (await settled(page)).first!;
    await control(page, 'Append 20 identical').click();
    await control(page, 'Append 3 wrapped').click();
    await expectAnchor(page, anchor);
    expect((await geometry(page)).bottomGap).toBeGreaterThan(100);
    const resume = control(page, 'Resume live');
    await resume.focus();
    await page.keyboard.press('Enter');
    await expectFollowing(page);
});

test('upward wheel and PageUp immediately after resize are honored while following', async ({ page }) => {
    const body = await region(page).boundingBox();
    // Keep the pointer inside the output at both viewport widths. Deliberately
    // do not inspect or settle geometry between resize and genuine user input.
    await page.mouse.move(body!.x + 300, body!.y + body!.height / 2);
    await page.setViewportSize({ width: 980, height: 900 });
    await page.mouse.wheel(0, -450);
    await expectPaused(page);
    expect((await settled(page)).bottomGap).toBeGreaterThan(100);

    await control(page, 'Resume live').click();
    await expectFollowing(page);
    await region(page).focus();
    await page.setViewportSize({ width: 1280, height: 760 });
    await page.keyboard.press('PageUp');
    await expectPaused(page);
    expect((await settled(page)).bottomGap).toBeGreaterThan(100);
});

test('keyboard and native scrollbar scrolling pause without implicit resume at the bottom', async ({ page }, info) => {
    await region(page).focus();
    await expect(region(page)).toBeFocused();
    await page.keyboard.press('PageUp');
    await expectPaused(page);
    const keyboardAnchor = (await settled(page)).first!;
    await control(page, 'Append one').click();
    await expectAnchor(page, keyboardAnchor);
    await region(page).focus();
    await page.keyboard.press('Control+End');
    await expect.poll(async () => (await geometry(page)).bottomGap).toBeLessThanOrEqual(2);
    await expectPaused(page);

    await control(page, 'Resume live').click();
    await expectFollowing(page);
    const metrics = await region(page).evaluate(body => {
        if (!(body instanceof HTMLElement)) throw new Error('Expected an HTML output region');
        const box = body.getBoundingClientRect();
        const style = getComputedStyle(body);
        const borderRight = parseFloat(style.borderRightWidth);
        const scrollbarWidth = body.offsetWidth - body.clientWidth - parseFloat(style.borderLeftWidth) - borderRight;
        return { x: box.right - borderRight - scrollbarWidth / 2,
            bottom: box.bottom, top: box.top, viewport: body.clientHeight,
            scrollbarWidth, clientWidth: body.clientWidth, offsetWidth: body.offsetWidth,
            thumb: Math.max(20, body.clientHeight * body.clientHeight / body.scrollHeight) };
    });
    await info.attach('native-scrollbar-metrics', {
        body: JSON.stringify(metrics, null, 2), contentType: 'application/json',
    });
    expect(metrics.scrollbarWidth, 'Native scrollbar must be visible before testing a real thumb drag').toBeGreaterThan(0);
    await page.mouse.move(metrics.x, metrics.bottom - metrics.thumb / 2);
    await page.mouse.down();
    await page.mouse.move(metrics.x, metrics.top + metrics.viewport / 2, { steps: 12 });
    await page.mouse.up();
    await expectPaused(page);
    const dragged = await settled(page);
    expect(dragged.bottomGap).toBeGreaterThan(100);
    await control(page, 'Append 3 wrapped').click();
    await expectAnchor(page, dragged.first!);
    await evidence(page, info, 'scrollbar-paused-history');
});

test('retains a wrapped anchor across insertion, errors, reload and resize', async ({ page }, info) => {
    const anchor = await wrappedAnchor(page);
    for (const action of ['Insert late record near start', 'Toggle log error']) {
        await control(page, action).click();
        await expectAnchor(page, anchor);
    }
    await expect(page.getByRole('alert')).toContainText('Synthetic log subscription failed');
    await expect(control(page, 'Reload logs')).toBeAttached();
    // Complete a synthetic reload without scrolling to the offscreen error
    // button: navigating to that button would intentionally change the anchor.
    await control(page, 'Reload synthetic snapshot').click();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expectAnchor(page, anchor);
    for (const action of ['Narrow view', 'Shorter view', 'Taller view', 'Widen view']) {
        await control(page, action).click();
        await expectAnchor(page, anchor);
    }
    await control(page, 'Narrow view').click();
    await expectAnchor(page, anchor);
    await evidence(page, info, 'narrow-wrapped-anchor');
    await control(page, 'Resume live').click();
    await expectFollowing(page);
    await control(page, 'Widen view').click();
    await control(page, 'Shorter view').click();
    await expectFollowing(page);
});

test('native error reload control clears the error and keeps the view paused', async ({ page }) => {
    await control(page, 'Toggle log error').click();
    await region(page).focus();
    await page.keyboard.press('Control+Home');
    await expectPaused(page);
    await expect.poll(async () => (await geometry(page)).top).toBe(0);
    await control(page, 'Reload logs').click();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expectPaused(page);
    const anchor = (await settled(page)).first!;
    await control(page, 'Append one').click();
    await expectAnchor(page, anchor);
});

test('widening a deeply read wrapped row keeps that row when the old offset no longer fits', async ({ page }, info) => {
    await control(page, 'Narrow view').click();
    await expectFollowing(page);
    const initial = await wrappedAnchor(page);
    const row = page.locator(`[data-log-id="${initial.id}"]`);
    const narrowHeight = await row.evaluate(line => line.getBoundingClientRect().height);
    const targetDepth = narrowHeight - 30;
    expect(targetDepth).toBeGreaterThan(100);
    const body = await region(page).boundingBox();
    await page.mouse.move(body!.x + body!.width / 2, body!.y + body!.height / 2);
    await page.mouse.wheel(0, targetDepth + initial.offset);
    const deep = (await settled(page)).first!;
    expect(deep.id).toBe(initial.id);
    expect(deep.offset).toBeLessThan(-100);

    await control(page, 'Widen view').click();
    const wideHeight = await row.evaluate(line => line.getBoundingClientRect().height);
    expect(wideHeight).toBeLessThan(-deep.offset);
    await expectPaused(page);
    await expect.poll(async () => (await geometry(page)).first?.id).toBe(initial.id);
    await expect.poll(async () => Math.abs((await geometry(page)).first!.offset)).toBeLessThanOrEqual(1);
    await expect(page.locator('.history-notice')).toHaveCount(0);
    const aligned = (await settled(page)).first!;
    await control(page, 'Append one').click();
    await expectAnchor(page, aligned);
    await evidence(page, info, 'widened-shorter-anchor');
});

test('cap eviction preserves retained anchors and honestly reports an evicted anchor', async ({ page }, info) => {
    for (let batch = 0; batch < 3; batch++) await control(page, 'Append 300').click();
    await expect(page.locator('.log-line')).toHaveCount(1000);
    await expectFollowing(page);
    const anchor = await wheelIntoHistory(page);
    const oldFirstId = await page.locator('.log-line').first().getAttribute('data-log-id');
    await anchorEvidence(page, info, 'before-cap-retention', anchor);
    await control(page, 'Append 300').click();
    await expect(page.locator('.log-line')).toHaveCount(1000);
    await anchorEvidence(page, info, 'after-cap-retention', anchor);
    expect(await page.locator('.log-line').first().getAttribute('data-log-id')).not.toBe(oldFirstId);
    await expectAnchor(page, anchor);
    await expect(page.locator('.history-notice')).toHaveCount(0);

    await control(page, 'Evict all old records').click();
    await expectPaused(page);
    await expect(page.locator('.history-notice')).toContainText('Earlier output is no longer available.');
    await expect(page.locator('.history-notice')).toContainText('Showing retained history.');
    await expect(page.locator(`[data-log-id="${anchor.id}"]`)).toHaveCount(0);
    expect((await settled(page)).top).toBe(0);
    await evidence(page, info, 'evicted-history-notice');
    await control(page, 'Append one').click();
    await expectPaused(page);
    await control(page, 'Resume live').click();
    await expectFollowing(page);
    await expect(page.locator('.history-notice')).toHaveCount(0);
});

test('clear and backend session replacement remain paused with honest missing history', async ({ page }) => {
    await wheelIntoHistory(page);
    await page.getByRole('button', { name: '🗑 Clear', exact: true }).click();
    await expect(page.locator('.log-line')).toHaveCount(0);
    await expectPaused(page);
    await expect(page.locator('.history-notice')).toContainText('No logs are retained.');
    await control(page, 'Append one').click();
    const afterClear = (await settled(page)).first!;
    await control(page, 'Append 300').click();
    await expectAnchor(page, afterClear);
    await control(page, 'Resume live').click();
    await expectFollowing(page);
    await expect(page.locator('.history-notice')).toHaveCount(0);

    const previousSession = await wheelIntoHistory(page);
    await control(page, 'Replace backend session').click();
    await expectPaused(page);
    await expect(page.locator('.history-notice')).toContainText('Earlier output is no longer available.');
    const changed = await settled(page);
    expect(changed.first!.id).toContain('replacement:');
    expect(changed.first!.id).not.toBe(previousSession.id);
    expect(changed.top).toBe(0);
    await control(page, 'Resume live').click();
    await expectFollowing(page);
});

test('only a fresh keyed view resets mode; synthetic process controls retain it', async ({ page }) => {
    const anchor = await wheelIntoHistory(page);
    await page.getByRole('button', { name: '■ Stop', exact: true }).click();
    await expect(page.getByLabel('Terminal input')).toBeDisabled();
    await expectAnchor(page, anchor);
    await page.getByRole('button', { name: '▶ Start', exact: true }).click();
    await expectAnchor(page, anchor);
    await page.getByRole('button', { name: '↻ Restart', exact: true }).click();
    await expectAnchor(page, anchor);

    await control(page, 'Switch project').click();
    await expect(page.getByRole('region', { name: 'Synthetic beta output' })).toBeVisible();
    await expectFollowing(page);
    await wheelIntoHistory(page);
    await control(page, 'Switch project').click();
    await expect(page.getByRole('region', { name: 'Synthetic alpha output' })).toBeVisible();
    await expectFollowing(page);
    await wheelIntoHistory(page);
    await control(page, 'Close terminal view').click();
    await expect(region(page)).toHaveCount(0);
    await control(page, 'Reopen terminal view').click();
    await expectFollowing(page);
    await expect(page.locator('.history-notice')).toHaveCount(0);
});
