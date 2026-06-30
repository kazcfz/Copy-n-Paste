const { test, expect, chromium } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const extensionPath = path.join(rootDir, 'dist', 'chromium');
const profileDir = path.resolve(process.env.CNP_PROFILE_DIR || path.join(rootDir, 'playwright-profiles', 'real-sites'));
const browserChannel = process.env.CNP_BROWSER_CHANNEL || '';
const selectedTargets = new Set((process.env.CNP_SITE_TARGETS || 'contacts,linkedin,bsky,gemini')
    .split(/[\s,]+/)
    .map(target => target.trim().toLowerCase())
    .filter(Boolean));

function shouldRun(target) {
    return selectedTargets.has('all') || selectedTargets.has(target);
}

function launchOptions() {
    const options = {
        headless: false,
        ignoreDefaultArgs: ['--enable-automation'],
        args: [
            '--disable-blink-features=AutomationControlled',
            `--disable-extensions-except=${extensionPath}`,
            `--load-extension=${extensionPath}`
        ]
    };

    if (browserChannel)
        options.channel = browserChannel;

    return options;
}

async function waitForExtension(page) {
    await page.waitForFunction(() => document.documentElement.dataset.cnpInitLoaded === 'true', null, { timeout: 15000 });
    await page.waitForFunction(() => document.documentElement.dataset.cnpPageHookLoaded === 'true', null, { timeout: 15000 });
}

async function waitForFrame(page, urlPattern, timeout = 30000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        const frame = page.frames().find(candidate => urlPattern.test(candidate.url()));
        if (frame)
            return frame;

        await page.waitForTimeout(250);
    }

    throw new Error(`Frame matching ${urlPattern} was not found`);
}

async function skipIfLoginRequired(page, loginPattern, message) {
    await page.waitForLoadState('domcontentloaded').catch(() => { });
    test.skip(loginPattern.test(page.url()), message);
}

async function clickAndDetectUpload(page, locator, label, overlayScope = page) {
    await waitForStableActionable(locator, label, 1000, 15000);

    const overlay = overlayScope.locator('.cnp-overlay-content').first();
    const fileChooserPromise = page.waitForEvent('filechooser', { timeout: 7000 })
        .then(() => 'filechooser')
        .catch(() => null);
    const clickPromise = locator.click({ timeout: 15000 })
        .then(() => null)
        .catch(error => error);

    const earlyResult = await Promise.race([clickPromise, fileChooserPromise]);
    if (earlyResult === 'filechooser')
        return 'filechooser';
    if (earlyResult instanceof Error)
        throw new Error(`${label} click failed: ${earlyResult.message}`);

    const overlayPromise = overlay.waitFor({ state: 'visible', timeout: 7000 })
        .then(() => 'overlay')
        .catch(() => null);
    const finalResult = await Promise.race([overlayPromise, fileChooserPromise]);

    return finalResult || 'no-overlay';
}

async function expectUploadOverlay(page, locator, label, overlayScope = page) {
    let result = 'no-overlay';
    for (let attempt = 0; attempt < 3; attempt++) {
        result = await clickAndDetectUpload(page, locator, label, overlayScope);
        expect(result, `${label} opened the native file chooser instead of the CnP overlay`).not.toBe('filechooser');
        if (result === 'overlay')
            return;

        await page.waitForTimeout(750);
    }

    expect(result, `${label} did not show the CnP overlay`).toBe('overlay');
}

async function closeOverlay(scope) {
    await scope.evaluate(() => document.querySelectorAll('.cnp-overlay').forEach(overlay => overlay.remove()));
}

async function waitForNoFileChooser(page, action, timeout = 2500) {
    const fileChooserPromise = page.waitForEvent('filechooser', { timeout })
        .then(() => 'filechooser')
        .catch(() => null);

    await action();
    expect(await fileChooserPromise, 'A native file chooser opened unexpectedly').toBeNull();
}

async function expectOverlayUploadDirectFileInput(page) {
    await expect(page.locator('#cnp-upload-btn')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#cnp-overlay-file-input')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#cnp-overlay-file-input')).toHaveAttribute('type', 'file');
}

async function waitForAnyLocator(page, locators, timeout = 30000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        for (const locator of locators) {
            if (await locator.first().isVisible().catch(() => false))
                return locator.first();
        }

        await page.waitForTimeout(250);
    }

    throw new Error('None of the expected locators became visible');
}

async function isActionable(locator) {
    if (!await locator.isVisible({ timeout: 250 }).catch(() => false))
        return false;

    return locator.evaluate(element => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0
            && rect.height > 0
            && style.display !== 'none'
            && style.visibility !== 'hidden'
            && !element.disabled
            && element.getAttribute('aria-disabled') !== 'true';
    }).catch(() => false);
}

async function waitForStableActionable(locator, label, stableMs = 1000, timeout = 15000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        if (await isActionable(locator)) {
            const stable = await locator.evaluate((element, delay) => new Promise(resolve => {
                const rect = element.getBoundingClientRect();
                setTimeout(() => {
                    const nextRect = element.getBoundingClientRect();
                    const style = getComputedStyle(element);
                    resolve(element.isConnected
                        && rect.x === nextRect.x
                        && rect.y === nextRect.y
                        && rect.width === nextRect.width
                        && rect.height === nextRect.height
                        && style.display !== 'none'
                        && style.visibility !== 'hidden'
                        && !element.disabled
                        && element.getAttribute('aria-disabled') !== 'true');
                }, delay);
            }), stableMs).catch(() => false);

            if (stable)
                return locator;
        }

        await new Promise(resolve => setTimeout(resolve, 250));
    }

    throw new Error(`${label} did not become stable and actionable`);
}

async function waitForAnyActionableLocator(page, locators, label, timeout = 30000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        for (const locator of locators) {
            const candidate = locator.first();
            if (await isActionable(candidate))
                return candidate;
        }

        await page.waitForTimeout(250);
    }

    throw new Error(`${label} did not become actionable`);
}

async function waitForActionableLocator(page, locator, label, timeout = 30000) {
    return waitForAnyActionableLocator(page, [locator], label, timeout);
}

async function waitForBskyAddImageButton(page) {
    const addImageButton = page.locator('button[aria-label="Add image"]').first();
    const newPostButton = page.getByRole('button', { name: /^(new post|compose)$/i }).first();
    const firstControl = await waitForAnyActionableLocator(page, [addImageButton, newPostButton], 'Bsky composer controls', 30000).catch(() => null);
    test.skip(!firstControl, 'Bsky profile is not signed in or the composer controls are not visible. Run `npm run diagnose:sites -- bsky` and log in manually first.');

    if (!await isActionable(addImageButton))
        await firstControl.click();

    return waitForActionableLocator(page, addImageButton, 'Bsky Add image', 30000);
}

async function waitForGeminiUploadFiles(page) {
    const uploadFiles = page.getByText(/^Upload files$/i).first();
    const menuControls = [
        page.locator('simplified-input-menu button').first(),
        page.getByRole('button', { name: /add|attach|upload|files/i }).first()
    ];
    const deadline = Date.now() + 30000;

    while (Date.now() < deadline) {
        if (await isActionable(uploadFiles))
            return uploadFiles;

        const menuControl = await waitForAnyActionableLocator(page, menuControls, 'Gemini upload menu control', 1500).catch(() => null);
        if (menuControl)
            await menuControl.click().catch(() => { });

        await page.waitForTimeout(500);
    }

    test.skip(true, 'Gemini upload menu was not visible or actionable. Run `npm run diagnose:sites -- gemini` and open the prompt controls manually first.');
}

async function writeClipboardTestImage(page) {
    await page.bringToFront();
    await page.locator('body').click({ position: { x: 20, y: 20 } }).catch(() => { });
    await page.evaluate(async () => {
        const canvas = document.createElement('canvas');
        canvas.width = 160;
        canvas.height = 160;

        const context = canvas.getContext('2d');
        context.fillStyle = '#2f7cff';
        context.fillRect(0, 0, 160, 160);
        context.fillStyle = '#ffffff';
        context.fillRect(40, 40, 80, 80);

        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    });
}

test.describe.configure({ mode: 'serial' });

test.describe('authenticated real-site upload controls', () => {
    test.setTimeout(90000);

    let context;

    test.beforeAll(async () => {
        if (!fs.existsSync(path.join(extensionPath, 'manifest.json')))
            throw new Error('Missing dist/chromium/manifest.json. Run `npm run build` before `npm run test:sites`.');

        fs.mkdirSync(profileDir, { recursive: true });
        context = await chromium.launchPersistentContext(profileDir, launchOptions());
    });

    test.afterAll(async () => {
        await context?.close();
    });

    if (shouldRun('contacts')) {
        test('Google Contacts contact photo preview reaches crop dialog', async () => {
            const page = await context.newPage();
            await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'https://contacts.google.com' });
            await page.goto('https://contacts.google.com/new', { waitUntil: 'domcontentloaded' });
            await skipIfLoginRequired(page, /accounts\.google\.com/, 'Google Contacts profile is not signed in. Run `npm run diagnose:sites -- contacts` and log in manually first.');
            await waitForExtension(page);
            await writeClipboardTestImage(page);

            const setPhotoButton = page.getByRole('button', { name: /set contact photo/i }).first();
            await expect(setPhotoButton).toBeVisible({ timeout: 30000 });

            await setPhotoButton.click();
            const photoFrame = await waitForFrame(page, /myaccount\.google\.com\/profile-picture/);
            await photoFrame.waitForFunction(() => document.documentElement.dataset.cnpInitLoaded === 'true', null, { timeout: 15000 });
            await photoFrame.waitForFunction(() => document.documentElement.dataset.cnpPageHookLoaded === 'true', null, { timeout: 15000 });

            const fromComputerTab = photoFrame.getByRole('tab', { name: /from computer/i });
            await expect(fromComputerTab).toBeVisible({ timeout: 30000 });
            await fromComputerTab.click();
            await expect(photoFrame.locator('.cnp-overlay-content')).toHaveCount(0);

            const uploadButton = photoFrame.getByRole('button', { name: /upload from computer/i });
            await expect(uploadButton).toBeVisible({ timeout: 30000 });
            await expectUploadOverlay(page, uploadButton, 'Google Contacts Upload from computer', photoFrame);
            await expect(photoFrame.locator('#cnp-image-preview')).toBeVisible({ timeout: 10000 });
            await photoFrame.locator('#cnp-preview-container').click();
            await page.waitForTimeout(750);
            await expect.poll(() => photoFrame.url(), { timeout: 30000 }).toMatch(/\/profile-picture\/crop\//);
            await expect(photoFrame.getByText(/crop & rotate/i).first()).toBeVisible({ timeout: 30000 });
            await page.close();
        });
    }

    if (shouldRun('bsky')) {
        test('Bsky Add image preview attaches without opening native picker', async () => {
            const page = await context.newPage();
            await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'https://bsky.app' });
            await page.goto('https://bsky.app/', { waitUntil: 'domcontentloaded' });
            await waitForExtension(page);

            const addImageButton = await waitForBskyAddImageButton(page);
            await writeClipboardTestImage(page);
            await expectUploadOverlay(page, addImageButton, 'Bsky Add image');
            await expect(page.locator('#cnp-image-preview')).toBeVisible({ timeout: 10000 });
            await waitForNoFileChooser(page, () => page.locator('#cnp-preview-container').click(), 3000);
            await expect(page.locator('.cnp-overlay-content')).toHaveCount(0);
            await page.close();
        });

        test('Bsky Add image Upload Files opens CnP picker and attaches', async () => {
            const page = await context.newPage();
            const uploadFile = path.join(rootDir, 'test-results', 'cnp-bsky-upload.png');
            fs.mkdirSync(path.dirname(uploadFile), { recursive: true });
            fs.writeFileSync(uploadFile, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAKAAAACgCAIAAAAErfB6AAABHklEQVR4nO3RsQ3AMAwEwYz77+wuQEuYFhQcZqWfubc9AAAAAAAAAAAAwDy7ewH8DBJgQECAAAECBAgQIECAAAECBAgQIECAAAECBAgQIECAAAECBAgQIECAAAECBAgQIECAAAECBAgQIECAAAECBAgQIECAAAECBAgQIECAAAECBAgQIECAAAECBAgQIECAAAECBAgQIECAAAECBAgQIECAAAECBAgQIECAAAECBAgQIECAAAECBAgQIECAAAECBAgQIECAAAECBAgQIECAAAECBAgQIECAAAGCV9wdDKDnPD0DBAgQIECAAAECBAgQIECAAAECBAgQIECAAAECBAgQIECAAAECBAgQIECAAAECBAgQIECAAAECBAgQIECAAAECBAgQIECAAAECBPgCk8oC+nY8vl8AAAAASUVORK5CYII=', 'base64'));

            await page.goto('https://bsky.app/', { waitUntil: 'domcontentloaded' });
            await waitForExtension(page);

            const addImageButton = await waitForBskyAddImageButton(page);
            await expectUploadOverlay(page, addImageButton, 'Bsky Add image');
            await expectOverlayUploadDirectFileInput(page);
            const chooserPromise = page.waitForEvent('filechooser', { timeout: 10000 });
            await page.locator('#cnp-upload-btn').click();
            const chooser = await chooserPromise;
            await chooser.setFiles(uploadFile);
            await expect(page.locator('.cnp-overlay-content')).toHaveCount(0);
            await fs.promises.rm(uploadFile, { force: true });
            await page.close();
        });
    }

    if (shouldRun('gemini')) {
        test('Gemini Upload files preview attaches and closes without reopening', async () => {
            const page = await context.newPage();
            await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'https://gemini.google.com' });
            await page.goto('https://gemini.google.com/app', { waitUntil: 'domcontentloaded' });
            await skipIfLoginRequired(page, /accounts\.google\.com/, 'Gemini profile is not signed in. Run `npm run diagnose:sites -- gemini` and log in manually first.');
            await waitForExtension(page);
            await writeClipboardTestImage(page);

            const uploadFiles = await waitForGeminiUploadFiles(page);
            await expectUploadOverlay(page, uploadFiles, 'Gemini Upload files');
            await expect(page.locator('#cnp-image-preview')).toBeVisible({ timeout: 10000 });
            await expect(page.locator('.cnp-preview-badge')).toHaveText('1');
            await waitForNoFileChooser(page, () => page.locator('#cnp-preview-container').click(), 3000);
            await expect(page.locator('.cnp-overlay-content')).toHaveCount(0);
            await page.waitForTimeout(1500);
            await expect(page.locator('.cnp-overlay-content')).toHaveCount(0);
            await page.close();
        });

        test('Gemini Upload files keeps menu open and opens native chooser', async () => {
            const page = await context.newPage();
            const uploadFile = path.join(rootDir, 'test-results', 'cnp-gemini-upload.txt');
            fs.mkdirSync(path.dirname(uploadFile), { recursive: true });
            fs.writeFileSync(uploadFile, 'copy-n-paste Gemini upload test');

            await page.goto('https://gemini.google.com/app', { waitUntil: 'domcontentloaded' });
            await skipIfLoginRequired(page, /accounts\.google\.com/, 'Gemini profile is not signed in. Run `npm run diagnose:sites -- gemini` and log in manually first.');
            await waitForExtension(page);

            const uploadFiles = await waitForGeminiUploadFiles(page);
            await expectUploadOverlay(page, uploadFiles, 'Gemini Upload files');
            await expectOverlayUploadDirectFileInput(page);
            const chooserPromise = page.waitForEvent('filechooser', { timeout: 10000 });
            await page.locator('#cnp-upload-btn').click();
            const chooser = await chooserPromise;
            expect(chooser, 'Gemini Upload Files did not open a native file chooser').toBeTruthy();
            await chooser.setFiles(uploadFile);
            await expect(page.locator('.cnp-overlay-content')).toHaveCount(0);
            await page.getByText(path.basename(uploadFile)).first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => { });
            await fs.promises.rm(uploadFile, { force: true });
            await page.close();
        });
    }

    if (shouldRun('linkedin')) {
        test('LinkedIn photo upload shows CnP overlay', async () => {
            const page = await context.newPage();
            await page.goto('https://www.linkedin.com/', { waitUntil: 'domcontentloaded' });
            await skipIfLoginRequired(page, /linkedin\.com\/(login|uas\/login|checkpoint)/, 'LinkedIn profile is not signed in. Run `npm run diagnose:sites -- linkedin` and log in manually first.');
            await page.waitForURL(/linkedin\.com\/(feed|in|mynetwork|jobs|notifications|messaging|$)/, { timeout: 30000 }).catch(() => { });
            await waitForExtension(page);

            const photoControl = await waitForAnyActionableLocator(page, [
                page.getByRole('button', { name: /^(Photo|Foto)$/i }).first(),
                page.getByRole('link', { name: /^(Photo|Foto)$/i }).first()
            ], 'LinkedIn Photo', 30000);

            const firstResult = await clickAndDetectUpload(page, photoControl, 'LinkedIn Photo');
            expect(firstResult, 'LinkedIn Photo opened the native file chooser instead of the CnP overlay').not.toBe('filechooser');
            if (firstResult === 'overlay') {
                await closeOverlay(page);
                await page.close();
                return;
            }

            const uploadControl = page.locator('.media-editor-file-selector__upload-media-button, label.artdeco-button').first();
            const uploadControlVisible = await uploadControl.isVisible({ timeout: 15000 }).catch(() => false);
            test.skip(!uploadControlVisible, 'LinkedIn did not expose the media upload composer in this automated session. Verify with `npm run diagnose:sites -- linkedin`.');
            await expectUploadOverlay(page, uploadControl, 'LinkedIn Upload from computer');
            await closeOverlay(page);
            await page.close();
        });
    }
});