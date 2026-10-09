import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: '.',
    testMatch: ['log-follow.spec.ts', 'settings.spec.ts'],
    fullyParallel: true,
    workers: 2,
    retries: 0,
    timeout: 30_000,
    expect: { timeout: 5_000 },
    reporter: [['list'], ['html', { open: 'never' }]],
    outputDir: '../../test-results',
    use: {
        browserName: 'chromium',
        // Chromium's headless default hides scrollbars, turning a supposed
        // thumb drag into text selection. Keep the real native control visible.
        launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] },
        baseURL: 'http://127.0.0.1:4179',
        viewport: { width: 1280, height: 900 },
        screenshot: 'only-on-failure',
        trace: 'retain-on-failure',
    },
    webServer: [{
        command: 'npx vite --config tests/browser/vite.config.mjs',
        cwd: '../..',
        url: 'http://127.0.0.1:4179/tests/browser/log-follow.html',
        reuseExistingServer: false,
        timeout: 30_000,
    }, {
        command: 'npx vite --config tests/browser/settings-vite.config.mjs',
        cwd: '../..',
        url: 'http://127.0.0.1:4180/tests/browser/settings.html',
        reuseExistingServer: false,
        timeout: 30_000,
    }],
});
