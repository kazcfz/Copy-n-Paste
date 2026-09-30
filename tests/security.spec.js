// Security guarantees (Mozilla review, issue #39) and the file-picker mechanisms a page can use.
// The page under test is hostile on purpose: it records every channel through which clipboard data
// or the overlay could leak (see pages/recorder.js).
const fs = require('fs');
const path = require('path');
const { test, expect, overlayBox, waitForOverlay, expectNoOverlay, clickOverlay } = require('./support/fixtures');
const { copyFiles, copyImage, copyText } = require('./support/clipboard');

const PAGES = path.join(__dirname, 'pages');
const IMAGE = path.join(__dirname, 'assets', 'cnp-test.png');
const IMAGE_2 = path.join(__dirname, 'assets', 'cnp-test-2.png');
const ARM_DELAY = 600; // a bit more than the extension's 500 ms

async function openHostile(context, page, query = '') {
    await context.route(/^http:\/\/(attacker|other)\.test\//, route =>
        route.fulfill({ path: path.join(PAGES, new URL(route.request().url()).pathname.slice(1)) }));
    await page.goto(`http://attacker.test/hostile.html${query}`);
    await page.frame({ url: /other\.test/ }).waitForLoadState();
    await page.evaluate(() => { window.addedNodes.length = 0; });
}

const read = (frame, expression) => frame.evaluate(expression);
const changes = frame => read(frame, () => window.changes);
const leaks = frame => read(frame, () => window.leaks);

// Opens the overlay from `selector` and waits until the preview accepts clicks
async function openOverlay(page, selector, frame = page.mainFrame()) {
    await frame.click(selector);
    await waitForOverlay(frame);
    await page.waitForTimeout(ARM_DELAY);
}

async function confirm(page, frame = page.mainFrame()) {
    await clickOverlay(page, frame, 'preview');
    await expectNoOverlay(frame);
}

test.describe('clipboard data never reaches the page without the user', () => {
    test('the v1.6.3 message bridge is gone (findings 3 and 4)', async ({ context, page }) => {
        copyImage(IMAGE);
        await openHostile(context, page);
        await page.evaluate(() => {
            for (const message of [{ Type: 'paste' }, { Type: 'paste', iframe: 'cross' }, { Type: 'getURL', Path: 'overlay.html' }]) {
                window.postMessage(message, '*');
                window.frames[0].postMessage(message, '*');
            }
        });
        await page.waitForTimeout(500);
        expect(await leaks(page)).toEqual([]);
        expect(await leaks(page.frame({ url: /other\.test/ }))).toEqual([]);
        await expectNoOverlay(page.mainFrame());
    });

    test('nothing happens without user activation', async ({ context, page }) => {
        copyImage(IMAGE);
        await openHostile(context, page, '?no-activation');
        await page.waitForTimeout(500);
        expect(await leaks(page)).toEqual([]);
        await expectNoOverlay(page.mainFrame());
    });

    test('the open overlay reveals nothing to the page', async ({ context, page }) => {
        copyFiles(IMAGE);
        await openHostile(context, page);
        await openOverlay(page, '#visible');
        await page.evaluate(() => window.watchFocus());
        expect(await page.evaluate(() => window.probe())).toEqual({
            hostShadowRoot: 'null', hostChildren: 0, hostText: '', blobImages: [], blobResources: [], frames: 1,
        });
        expect(await read(page, () => window.addedNodes)).toEqual(['DIV in HTML']);
        await page.waitForTimeout(1000);
        expect(await changes(page)).toEqual([]);
        expect(await leaks(page)).toEqual([]);
        expect(await read(page, () => window.focusLog)).toEqual([]);
    });

    test('files reach the page only when the user confirms, without moving focus', async ({ context, page }) => {
        copyFiles(IMAGE);
        await openHostile(context, page);
        await openOverlay(page, '#visible');
        await page.evaluate(() => window.watchFocus());
        await confirm(page);
        await expect.poll(() => changes(page)).toEqual([{ id: 'visible', files: ['cnp-test.png'] }]);
        expect(await leaks(page)).toEqual([]);
        expect(await read(page, () => window.focusLog)).toEqual([]);
    });

    // Firefox only pastes into editable elements on such pages, so focus briefly moves into the overlay
    test('with a rich-text editor on the page, reading the clipboard moves no focus or caret the page can see', async ({ context, page }) => {
        copyFiles(IMAGE);
        await openHostile(context, page, '?editor');
        await page.click('#editor');
        await page.keyboard.press('End');
        await page.focus('#visible');
        const state = () => page.evaluate(() => {
            const selection = getSelection();
            return { active: document.activeElement.id, anchor: selection.anchorNode?.nodeName, offset: selection.anchorOffset };
        });
        const before = await state();
        await page.evaluate(() => window.watchFocus());
        await page.keyboard.press('Enter');
        await waitForOverlay(page.mainFrame());
        expect(await read(page, () => window.focusLog)).toEqual([]);
        expect(await state()).toEqual(before);
        await page.waitForTimeout(ARM_DELAY);
        await confirm(page);
        await expect.poll(() => changes(page)).toEqual([{ id: 'visible', files: ['cnp-test.png'] }]);
        expect(await leaks(page)).toEqual([]);
    });

    test('a double click cannot confirm (arming delay)', async ({ context, page }) => {
        copyFiles(IMAGE);
        await openHostile(context, page);
        const box = await page.locator('#visible').boundingBox();
        const x = box.x + 20, y = box.y + box.height / 2;
        await page.mouse.click(x, y);
        // The overlay opens with its corner under the cursor; this lands on the preview right away
        await page.mouse.click(x + 130, y + 80);
        await page.waitForTimeout(ARM_DELAY);
        expect(await changes(page)).toEqual([]);
        await confirm(page);
        await expect.poll(() => changes(page)).toEqual([{ id: 'visible', files: ['cnp-test.png'] }]);
    });

    test('synthetic events cannot confirm', async ({ context, page }) => {
        copyFiles(IMAGE);
        await openHostile(context, page);
        await openOverlay(page, '#visible');
        const box = await overlayBox(page.mainFrame());
        await page.evaluate(({ x, y }) => {
            const host = window.overlayHost();
            for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'])
                host.dispatchEvent(new MouseEvent(type, { bubbles: true, composed: true, clientX: x, clientY: y }));
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', ctrlKey: true, bubbles: true }));
        }, { x: box.x + box.width / 2, y: box.y + box.height * 0.38 });
        await page.waitForTimeout(300);
        expect(await changes(page)).toEqual([]);
        expect(await overlayBox(page.mainFrame())).not.toBeNull();
    });

    test('the page cannot hide, move or cover the overlay', async ({ context, page }) => {
        copyFiles(IMAGE);
        await openHostile(context, page);
        await openOverlay(page, '#visible');
        expect(await page.evaluate(() => window.tamper())).toEqual({
            opacity: '1', visibility: 'visible', transform: 'none', filter: 'none', pointerEvents: 'none', after: 'none',
        });
    });

    test('a paste listener planted in an about:blank frame sees nothing', async ({ context, page }) => {
        copyFiles(IMAGE);
        await openHostile(context, page);
        await page.click('#blank-frame');
        const frame = await (await page.$('#blank')).contentFrame();
        await openOverlay(page, '#blank-input', frame);
        expect(await leaks(page)).toEqual([]);
        await confirm(page, frame);
        await expect.poll(() => changes(page)).toEqual([{ id: 'blank-input', files: ['cnp-test.png'] }]);
        expect(await leaks(page)).toEqual([]);
    });

    test('a document.write() frame falls back to the native picker', async ({ context, page, nativePicker }) => {
        copyFiles(IMAGE);
        await openHostile(context, page);
        await page.click('#written-frame');
        const frame = await (await page.$('#written')).contentFrame();
        await frame.click('#written-input');
        await expect.poll(() => nativePicker.length).toBe(1);
        await expectNoOverlay(frame);
        expect(await leaks(page)).toEqual([]);
    });

    test('a cross-origin frame gets its own overlay and neither page sees the clipboard', async ({ context, page }) => {
        copyFiles(IMAGE);
        await openHostile(context, page);
        const frame = page.frame({ url: /other\.test/ });
        await openOverlay(page, '#frame-input', frame);
        await confirm(page, frame);
        await expect.poll(() => changes(frame)).toEqual([{ id: 'frame-input', files: ['cnp-test.png'] }]);
        expect(await leaks(frame)).toEqual([]);
        expect(await leaks(page)).toEqual([]);
    });
});

test.describe('every way a page can open a file picker', () => {
    for (const [name, selector, id] of [
        ['<label for>', '#label', 'hidden-input'],
        ['input.click() on a detached input', '#detached', 'detached'],
        ['input.showPicker()', '#picker', 'picker-input'],
        ['a modal <dialog> (everything else is inert)', null, 'dialog-input'],
    ])
        test(name, async ({ context, page }) => {
            copyFiles(IMAGE);
            await openHostile(context, page);
            if (id === 'dialog-input') {
                await page.click('#open-dialog');
                await openOverlay(page, '#dialog-input');
            } else
                await openOverlay(page, selector);
            await confirm(page);
            await expect.poll(() => changes(page)).toEqual([{ id, files: ['cnp-test.png'] }]);
        });

    test('closed shadow root, clicked directly and through .click()', async ({ context, page }) => {
        copyFiles(IMAGE);
        await openHostile(context, page);
        const box = await page.locator('closed-upload').boundingBox();
        for (const x of [box.x + 10, box.x + box.width - 10]) {
            await page.mouse.click(x, box.y + box.height / 2);
            await waitForOverlay(page.mainFrame());
            await page.waitForTimeout(ARM_DELAY);
            await confirm(page);
        }
        await expect.poll(() => changes(page)).toEqual([
            { id: 'closed-input', files: ['cnp-test.png'] },
            { id: 'closed-input', files: ['cnp-test.png'] },
        ]);
    });

    test('folder pickers keep the native picker', async ({ context, page, nativePicker }) => {
        copyFiles(IMAGE);
        await openHostile(context, page);
        await page.click('#folder');
        await expect.poll(() => nativePicker.length).toBe(1);
        await expectNoOverlay(page.mainFrame());
    });
});

test.describe('overlay behaviour', () => {
    test('screenshots get a CnP_ timestamp name', async ({ context, page }) => {
        copyImage(IMAGE);
        await openHostile(context, page);
        await openOverlay(page, '#visible');
        await confirm(page);
        await expect.poll(() => changes(page)).toEqual([{ id: 'visible', files: [expect.stringMatching(/^CnP_\d{8}_\d{6}\.png$/)] }]);
    });

    test('multi-file inputs keep earlier files', async ({ context, page }) => {
        copyFiles(IMAGE);
        await openHostile(context, page);
        await openOverlay(page, '#multi');
        await confirm(page);
        copyFiles(IMAGE_2);
        await openOverlay(page, '#multi');
        await confirm(page);
        await expect.poll(() => changes(page)).toEqual([
            { id: 'multi', files: ['cnp-test.png'] },
            { id: 'multi', files: ['cnp-test.png', 'cnp-test-2.png'] },
        ]);
    });

    test('text on the clipboard is never attached', async ({ context, page }) => {
        copyText('secret password');
        await openHostile(context, page);
        await openOverlay(page, '#visible');
        await clickOverlay(page, page.mainFrame(), 'preview');
        await page.waitForTimeout(300);
        expect(await changes(page)).toEqual([]);
        expect(await leaks(page)).toEqual([]);
    });

    test('Ctrl+V attaches what is on the clipboard now', async ({ context, page }) => {
        copyFiles(IMAGE);
        await openHostile(context, page);
        await openOverlay(page, '#visible');
        copyFiles(IMAGE_2);
        await page.keyboard.press('Control+V');
        await expect.poll(() => changes(page)).toEqual([{ id: 'visible', files: ['cnp-test-2.png'] }]);
        await expectNoOverlay(page.mainFrame());
    });

    test('Ctrl+V without files still pastes text into the page', async ({ context, page }) => {
        copyText('hello');
        await openHostile(context, page);
        await openOverlay(page, '#visible');
        await page.focus('#notes');
        await page.keyboard.press('Control+V');
        await expect(page.locator('#notes')).toHaveValue('hello');
        expect(await changes(page)).toEqual([]);
    });

    test('"Upload File" opens the native picker of the original input', async ({ context, page, nativePicker }) => {
        copyFiles(IMAGE);
        await openHostile(context, page);
        await openOverlay(page, '#visible');
        await clickOverlay(page, page.mainFrame(), 'upload');
        await expect.poll(() => nativePicker.length).toBe(1);
        expect(await (await nativePicker[0].element()).evaluate(el => el.id)).toBe('visible');
        await expectNoOverlay(page.mainFrame());
    });

    test('clicking elsewhere closes it; clicking the input again opens the native picker', async ({ context, page, nativePicker }) => {
        copyFiles(IMAGE);
        await openHostile(context, page);
        await openOverlay(page, '#visible');
        await page.mouse.click(1200, 700);
        await expectNoOverlay(page.mainFrame());
        await openOverlay(page, '#visible');
        await page.click('#visible');
        await expect.poll(() => nativePicker.length).toBe(1);
        await expectNoOverlay(page.mainFrame());
        expect(await changes(page)).toEqual([]);
    });

    test('dropping files on the overlay attaches them', async ({ context, page, browserName }) => {
        test.skip(browserName !== 'chromium', 'trusted file drops need the Chrome DevTools Protocol');
        copyFiles(IMAGE);
        await openHostile(context, page);
        await openOverlay(page, '#visible');
        const box = await overlayBox(page.mainFrame());
        const cdp = await context.newCDPSession(page);
        const drag = { items: [], files: [IMAGE_2], dragOperationsMask: 1 };
        const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
        for (const type of ['dragEnter', 'dragOver', 'drop'])
            await cdp.send('Input.dispatchDragEvent', { type, ...at, data: drag });
        await expect.poll(() => changes(page)).toEqual([{ id: 'visible', files: ['cnp-test-2.png'] }]);
    });
});

test('shipped code has no HTML sinks, message channels or web-accessible resources', ({ browserName }) => {
    test.skip(browserName !== 'chromium', 'static check, runs once');
    for (const target of ['chromium', 'firefox']) {
        const dir = path.join(__dirname, '..', 'dist', target);
        const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
        expect(manifest.web_accessible_resources, target).toBeUndefined();
        for (const file of fs.readdirSync(dir).filter(name => name.endsWith('.js'))) {
            const code = fs.readFileSync(path.join(dir, file), 'utf8');
            expect(code, `${target}/${file}`).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|DOMParser|createContextualFragment|document\.write|\beval\(|new Function|postMessage|onmessage|['"]message['"]/);
        }
    }
});
