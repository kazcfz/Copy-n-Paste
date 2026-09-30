// Playwright fixtures: every test gets a fresh browser context with the built extension (dist/) loaded.
// Chromium loads it unpacked; Firefox installs it as a temporary add-on over the remote debugging protocol.
const { test: base, expect, chromium, firefox } = require('@playwright/test');
const path = require('path');
const { installTemporaryAddon } = require('./rdp');

const DIST = path.resolve(__dirname, '../../dist');
const VIEWPORT = { width: 1280, height: 800 };

// Live sites need the corporate/system proxy when one is configured through the environment
function proxyFromEnv() {
    const server = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy;
    return server ? { server, bypass: process.env.NO_PROXY || process.env.no_proxy || '' } : undefined;
}

const test = base.extend({
    firefoxWithExtension: [async ({ browserName }, use, workerInfo) => {
        if (browserName !== 'firefox')
            return use(null);
        const port = 6100 + workerInfo.workerIndex;
        const browser = await firefox.launch({
            headless: false,
            proxy: proxyFromEnv(),
            args: ['-start-debugger-server', String(port)],
            firefoxUserPrefs: {
                'devtools.debugger.remote-enabled': true,
                'devtools.debugger.prompt-connection': false,
                'devtools.chrome.enabled': true,
            },
        });
        await installTemporaryAddon(port, path.join(DIST, 'firefox'));
        await use(browser);
        await browser.close();
    }, { scope: 'worker' }],

    context: async ({ browserName, firefoxWithExtension }, use) => {
        let context;
        if (browserName === 'firefox')
            context = await firefoxWithExtension.newContext({ viewport: VIEWPORT });
        else {
            // Extensions only load into persistent contexts; headed so the real OS clipboard is used
            const extension = path.join(DIST, 'chromium');
            context = await chromium.launchPersistentContext('', {
                headless: false,
                viewport: VIEWPORT,
                proxy: proxyFromEnv(),
                args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
            });
        }
        await use(context);
        await context.close();
    },

    page: async ({ context }, use) => {
        const page = context.pages()[0] || await context.newPage();
        await use(page);
    },

    // Native file pickers are intercepted (no OS dialog) and recorded, so tests can tell
    // "overlay shown" apart from "fell back to the native picker"
    nativePicker: async ({ page }, use) => {
        const opened = [];
        page.on('filechooser', chooser => opened.push(chooser));
        await use(opened);
    },
});

// The overlay is a closed shadow root: like any page script, tests only see its host element.
// Its visible box is found by hit-testing, since only the overlay's panel accepts pointer events:
// a coarse scan finds the panel, then its edges are binary-searched from the centre.
async function overlayBox(frame) {
    return frame.evaluate(() => {
        const host = [...document.querySelectorAll(':popover-open')].reverse().find(el => {
            const style = getComputedStyle(el);
            return el.localName === 'div' && style.pointerEvents === 'none' && style.zIndex === '2147483647';
        });
        if (!host)
            return null;
        const hits = (x, y) => document.elementFromPoint(x, y) === host;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (let y = 2; y < innerHeight; y += 16)
            for (let x = 2; x < innerWidth; x += 16)
                if (hits(x, y)) {
                    minX = Math.min(minX, x);
                    minY = Math.min(minY, y);
                    maxX = Math.max(maxX, x);
                    maxY = Math.max(maxY, y);
                }
        if (minX === Infinity)
            return null;
        const cx = Math.round((minX + maxX) / 2), cy = Math.round((minY + maxY) / 2);
        // Last coordinate from `inside` towards `outside` that still hits
        const edge = (inside, outside, test) => {
            while (Math.abs(outside - inside) > 1) {
                const middle = Math.round((inside + outside) / 2);
                if (test(middle))
                    inside = middle;
                else
                    outside = middle;
            }
            return inside;
        };
        const left = edge(cx, -1, x => hits(x, cy));
        const right = edge(cx, innerWidth, x => hits(x, cy));
        const top = edge(cy, -1, y => hits(cx, y));
        const bottom = edge(cy, innerHeight, y => hits(cx, y));
        return { x: left, y: top, width: right - left, height: bottom - top };
    });
}

async function waitForOverlay(frame, timeout) {
    await expect.poll(() => overlayBox(frame), { message: 'Copy-n-Paste overlay should open', timeout }).not.toBeNull();
    return overlayBox(frame);
}

async function expectNoOverlay(frame) {
    expect(await overlayBox(frame), 'Copy-n-Paste overlay should not be open').toBeNull();
}

// Top-left of a frame's viewport in main-frame coordinates (boundingBox() is already main-frame relative)
async function frameOrigin(frame) {
    if (!frame.parentFrame())
        return { x: 0, y: 0 };
    const element = await frame.frameElement();
    const box = await element.boundingBox();
    const inset = await element.evaluate(el => ({
        left: el.clientLeft + parseFloat(getComputedStyle(el).paddingLeft),
        top: el.clientTop + parseFloat(getComputedStyle(el).paddingTop),
    }));
    return { x: box.x + inset.left, y: box.y + inset.top };
}

// part: 'preview' (the clipboard preview) or 'upload' (the "Upload File" row)
async function clickOverlay(page, frame, part) {
    const box = await waitForOverlay(frame);
    const origin = await frameOrigin(frame);
    const y = part === 'upload' ? box.y + box.height - 20 : box.y + box.height * 0.38;
    await page.mouse.click(origin.x + box.x + box.width / 2, origin.y + y);
}

module.exports = { test, expect, overlayBox, waitForOverlay, expectNoOverlay, clickOverlay };
