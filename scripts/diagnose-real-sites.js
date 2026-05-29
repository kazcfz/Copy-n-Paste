const fs = require('fs');
const path = require('path');
const { chromium } = require('@playwright/test');

const knownTargets = {
    business: 'https://business.facebook.com/',
    contacts: 'https://contacts.google.com/new',
    bsky: 'https://bsky.app/',
    gemini: 'https://gemini.google.com/app',
    linkedin: 'https://www.linkedin.com/',
    photos: 'https://photos.google.com/'
};

const targets = (process.argv.slice(2).length ? process.argv.slice(2) : ['contacts', 'linkedin', 'bsky', 'gemini'])
    .map(target => knownTargets[target] || target);

const rootDir = path.resolve(__dirname, '..');
const extensionPath = path.join(rootDir, 'dist', 'chromium');
const profileDir = path.resolve(process.env.CNP_PROFILE_DIR || path.join(rootDir, 'playwright-profiles', 'real-sites'));
const browserChannel = process.env.CNP_BROWSER_CHANNEL || '';
const interceptFileChooser = process.env.CNP_INTERCEPT_FILE_CHOOSER !== '0';
const launchArgs = [
    '--disable-blink-features=AutomationControlled',
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`
];

if (!fs.existsSync(path.join(extensionPath, 'manifest.json'))) {
    console.error('Missing dist/chromium/manifest.json. Run `npm run build` first.');
    process.exit(1);
}

function relativeSelector(element) {
    if (!element || !element.tagName)
        return '(unknown)';

    const parts = [];
    let current = element;
    while (current && current.nodeType === Node.ELEMENT_NODE && parts.length < 4) {
        let part = current.tagName.toLowerCase();
        if (current.id)
            part += `#${current.id}`;
        else {
            const classes = [...current.classList].slice(0, 3).join('.');
            if (classes)
                part += `.${classes}`;
        }
        parts.unshift(part);
        current = current.parentElement;
    }
    return parts.join(' > ');
}

async function installPageDiagnostics(page) {
    await page.addInitScript(() => {
        window.__cnpDiagnostics = [];
        window.__cnpManualStep = 0;

        function relativeSelector(element) {
            if (!element || !element.tagName)
                return '(unknown)';

            const parts = [];
            let current = element;
            while (current && current.nodeType === Node.ELEMENT_NODE && parts.length < 5) {
                let part = current.tagName.toLowerCase();
                if (current.id)
                    part += `#${current.id}`;
                else {
                    const classes = [...current.classList || []].slice(0, 3).join('.');
                    if (classes)
                        part += `.${classes}`;
                }
                parts.unshift(part);
                current = current.parentElement;
            }
            return parts.join(' > ');
        }

        function describeElement(element) {
            if (!element || !element.tagName)
                return null;

            return {
                tag: element.tagName.toLowerCase(),
                id: element.id || '',
                classes: [...element.classList || []].slice(0, 8),
                type: element.getAttribute && element.getAttribute('type'),
                accept: element.getAttribute && element.getAttribute('accept'),
                multiple: !!element.multiple,
                hidden: !!element.hidden,
                display: getComputedStyle(element).display,
                visibility: getComputedStyle(element).visibility,
                ariaLabel: element.getAttribute && element.getAttribute('aria-label'),
                selector: relativeSelector(element),
                text: (element.innerText || element.textContent || '').trim().slice(0, 120)
            };
        }

        function isVisible(element) {
            if (!element || !element.getBoundingClientRect)
                return false;

            const rect = element.getBoundingClientRect();
            const style = getComputedStyle(element);
            return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
        }

        function isRelevantUploadUi(element) {
            if (!element || !element.matches)
                return false;

            if (element.matches('input[type="file"], .cnp-overlay-content, simplified-input-menu, [role="menu"], [role="dialog"]'))
                return true;

            if (!element.matches('button, a, label, [role="button"], [aria-label], [data-testid], [data-test-id]'))
                return false;

            const text = [
                element.id,
                element.getAttribute('aria-label'),
                element.getAttribute('title'),
                element.getAttribute('data-testid'),
                element.getAttribute('data-test-id'),
                element.innerText || element.textContent || ''
            ].filter(Boolean).join(' ');
            return /upload|file|image|photo|media|attach|add/i.test(text);
        }

        function collectVisibleUploadUi() {
            return [...document.querySelectorAll('input[type="file"], .cnp-overlay-content, simplified-input-menu, [role="menu"], [role="dialog"], button, a, label, [role="button"], [aria-label], [data-testid], [data-test-id]')]
                .filter(element => isVisible(element) && isRelevantUploadUi(element))
                .slice(0, 30)
                .map(describeElement);
        }

        function relevantNodes(node) {
            const nodes = [];
            if (!node || node.nodeType !== Node.ELEMENT_NODE)
                return nodes;

            if (isRelevantUploadUi(node))
                nodes.push(node);

            if (node.querySelectorAll)
                node.querySelectorAll('input[type="file"], .cnp-overlay-content, simplified-input-menu, [role="menu"], [role="dialog"], button, a, label, [role="button"], [aria-label], [data-testid], [data-test-id]').forEach(element => {
                    if (isRelevantUploadUi(element))
                        nodes.push(element);
                });
            return nodes.slice(0, 20);
        }

        function eventPathHasCnPUploadActivation(event) {
            const path = event.composedPath ? event.composedPath() : [event.target];
            return path.some(node => node && node.id && (node.id === 'cnp-overlay-file-input' || node.id === 'cnp-upload-btn'));
        }

        function describePointerHit(event) {
            if (typeof event.clientX !== 'number' || typeof event.clientY !== 'number')
                return null;

            return describeElement(document.elementFromPoint(event.clientX, event.clientY));
        }

        function record(type, detail) {
            window.__cnpDiagnostics.push({
                type,
                url: location.href,
                time: new Date().toISOString(),
                detail
            });
        }

        ['pointerdown', 'mousedown', 'mouseup', 'click'].forEach(type => {
            window.addEventListener(type, event => {
                if (!event.isTrusted || !eventPathHasCnPUploadActivation(event))
                    return;

                record('overlay-upload-activation-event', {
                    type,
                    target: describeElement(event.target),
                    hitTarget: describePointerHit(event),
                    cancelable: event.cancelable,
                    defaultPrevented: event.defaultPrevented,
                    userActivationActive: !!(navigator.userActivation && navigator.userActivation.isActive),
                    userActivationHasBeenActive: !!(navigator.userActivation && navigator.userActivation.hasBeenActive)
                });
            }, true);
        });

        const originalCreateElement = Document.prototype.createElement;
        Document.prototype.createElement = function (...args) {
            const element = originalCreateElement.apply(this, args);
            if (String(args[0]).toLowerCase() === 'input') {
                queueMicrotask(() => {
                    if (element.type === 'file')
                        record('create-file-input', describeElement(element));
                });
            }
            return element;
        };

        const originalClick = HTMLInputElement.prototype.click;
        HTMLInputElement.prototype.click = function (...args) {
            if (this.type === 'file')
                record('input-click', describeElement(this));
            return originalClick.apply(this, args);
        };

        if (HTMLInputElement.prototype.showPicker) {
            const originalShowPicker = HTMLInputElement.prototype.showPicker;
            HTMLInputElement.prototype.showPicker = function (...args) {
                if (this.type === 'file')
                    record('input-showPicker', describeElement(this));
                return originalShowPicker.apply(this, args);
            };
        }

        if (typeof window.showOpenFilePicker === 'function') {
            const originalShowOpenFilePicker = window.showOpenFilePicker;
            window.showOpenFilePicker = function (...args) {
                record('showOpenFilePicker', args[0] || null);
                return originalShowOpenFilePicker.apply(this, args);
            };
        }

        document.addEventListener('click', event => {
            const path = event.composedPath ? event.composedPath() : [];
            const fileInput = path.find(node => node && node.tagName === 'INPUT' && node.type === 'file');
            const label = path.find(node => node && node.tagName === 'LABEL');
            const button = path.find(node => node && node.tagName && /^(BUTTON|A|DIV|SPAN)$/.test(node.tagName) && (node.innerText || node.getAttribute('aria-label')));
            if (event.isTrusted) {
                const step = ++window.__cnpManualStep;
                record('manual-click', {
                    step,
                    target: describeElement(event.target),
                    visibleUploadUi: collectVisibleUploadUi()
                });
                setTimeout(() => record('post-click-ui', {
                    step,
                    visibleUploadUi: collectVisibleUploadUi()
                }), 250);
            }
            if (fileInput || label || button)
                record('document-click', {
                    target: describeElement(event.target),
                    fileInput: describeElement(fileInput),
                    label: describeElement(label),
                    control: describeElement(button)
                });
        }, true);

        const observer = new MutationObserver(mutations => {
            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    for (const element of relevantNodes(node)) {
                        if (element.matches('input[type="file"]'))
                            record('added-file-input', describeElement(element));
                        else if (element.matches('.cnp-overlay-content'))
                            record('overlay-added', describeElement(element));
                        else
                            record('ui-added', describeElement(element));
                    }
                }

                for (const node of mutation.removedNodes) {
                    for (const element of relevantNodes(node))
                        record('ui-removed', describeElement(element));
                }
            }
        });

        window.addEventListener('DOMContentLoaded', () => observer.observe(document.documentElement, { childList: true, subtree: true }), { once: true });
    });

    page.on('console', message => {
        const text = message.text();
        if (/Copy-n-Paste|CnP|clipboard|file|upload/i.test(text))
            console.log(`[console:${message.type()}] ${text}`);
    });

    if (interceptFileChooser) {
        page.on('filechooser', async chooser => {
            console.log(`[filechooser] ${page.url()}`);
            console.log('  Playwright intercepted the chooser. Set CNP_INTERCEPT_FILE_CHOOSER=0 to let the Windows picker appear during manual diagnostics.');
        });
    }

    page.on('framenavigated', frame => {
        if (frame === page.mainFrame())
            console.log(`[nav] ${frame.url()}`);
    });
}

async function flushDiagnostics(page, label) {
    try {
        const events = await page.evaluate(() => {
            const events = window.__cnpDiagnostics || [];
            window.__cnpDiagnostics = [];
            return events;
        });

        for (const event of events) {
            console.log(`[${label}] ${event.type} ${event.time}`);
            console.log(JSON.stringify(event.detail, null, 2));
        }
    } catch (error) {
        console.log(`[${label}] diagnostics unavailable: ${error.message}`);
    }
}

(async () => {
    fs.mkdirSync(profileDir, { recursive: true });
    console.log(`Using persistent profile: ${profileDir}`);
    console.log(`Loading extension: ${extensionPath}`);
    console.log('Using launch flag: --disable-blink-features=AutomationControlled');
    if (browserChannel)
        console.log(`Using browser channel: ${browserChannel}`);
    else
        console.log('Using bundled Chromium channel; leave CNP_BROWSER_CHANNEL empty for extension diagnostics.');
    console.log(interceptFileChooser
        ? 'File chooser diagnostics: Playwright will intercept chooser events for logging.'
        : 'File chooser diagnostics: native Windows picker is not intercepted by this script.');

    const launchOptions = {
        headless: false,
        viewport: null,
        ignoreDefaultArgs: ['--enable-automation'],
        args: launchArgs
    };

    if (browserChannel)
        launchOptions.channel = browserChannel;

    const context = await chromium.launchPersistentContext(profileDir, launchOptions);

    const pages = [];
    for (const target of targets) {
        const page = await context.newPage();
        await installPageDiagnostics(page);
        await page.goto(target, { waitUntil: 'domcontentloaded' });
        pages.push({ page, label: new URL(target).hostname });
        console.log(`Opened ${target}`);
    }

    console.log('\nLog in manually if needed, then click the failing upload controls.');
    console.log('This script will print file-input, filechooser, and CnP overlay events. Press Ctrl+C here when done.\n');

    const interval = setInterval(async () => {
        for (const entry of pages)
            await flushDiagnostics(entry.page, entry.label);
    }, 1000);

    process.on('SIGINT', async () => {
        clearInterval(interval);
        for (const entry of pages)
            await flushDiagnostics(entry.page, entry.label);
        await context.close();
        process.exit(0);
    });
})();