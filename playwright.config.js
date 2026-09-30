const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
    testDir: 'tests',
    outputDir: 'tests/results',
    globalSetup: require.resolve('./tests/support/global-setup.js'),
    // One worker: the OS clipboard is shared by every browser window
    workers: 1,
    fullyParallel: false,
    timeout: 60_000,
    expect: { timeout: 10_000 },
    reporter: [['list'], ['html', { open: 'never', outputFolder: 'tests/report' }]],
    use: {
        // Trace DOM snapshots evaluate scripts as a user gesture, which would hide activation bugs
        trace: { mode: 'retain-on-failure', snapshots: false, screenshots: true },
        screenshot: 'only-on-failure',
    },
    projects: [
        { name: 'chromium', use: { browserName: 'chromium' } },
        { name: 'firefox', use: { browserName: 'firefox' } },
    ],
});
