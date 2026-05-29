/*
Scripts that (must) run within its isolated world,
which is the execution environment unique to this extension.
*/

if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', afterDOMLoaded);
else
    afterDOMLoaded();

// Global variables
var lastURL = location.href;

// Safe Trusted Types helper: try to create and memoize a policy, but fall back to no-op shim
function getTrustedPolicy(name, options) {
    // Avoid calling trustedTypes.createPolicy to prevent triggering CSP refusal logs.
    // Instead always return a safe shim that performs pass-through conversions.
    return { createScriptURL: s => s, createHTML: s => s };
}

// Safe wrapper for chrome.runtime.getURL — avoid referencing chrome.runtime when not available
function safeGetURL(path) {
    try {
        if (typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.getURL === 'function')
            return chrome.runtime.getURL(path);
    } catch (e) { }
    return path;
}

// Feature detection helpers
function docRequiresTrustedHTML(targetDoc) {
    try {
        // Try a small parse; on some sites DOMParser throws when TrustedHTML is required
        try {
            (targetDoc || document).createElement('div');
        } catch (e) { /* ignore */ }
        try {
            // Use the target document's DOMParser when same-origin; otherwise test top-level
            const parser = new DOMParser();
            parser.parseFromString('<div></div>', 'text/html');
            return false;
        } catch (err) {
            if (err && err.message && err.message.includes('TrustedHTML'))
                return true;
            return false;
        }
    } catch (e) { return false }
}

function docAllowsBlobScripts(targetDoc) {
    try {
        // Try to read any meta CSP; if it mentions script-src without blob: then assume blob is blocked
        const doc = targetDoc || document;
        try {
            const meta = doc.querySelector('meta[http-equiv="Content-Security-Policy"]');
            if (meta && meta.content) {
                const content = meta.content;
                // if script-src contains blob: explicitly, allow; if it contains script-src but not blob:, assume blocked
                const hasScriptSrc = /script-src/i.test(content);
                const hasBlob = /\bblob:\b/.test(content);
                if (hasScriptSrc && !hasBlob)
                    return false;
                return true;
            }
        } catch (e) { /* ignore */ }
        // Unknown — default to allowing blob URLs since many sites permit it
        return true;
    } catch (e) { return true }
}

// Helper: fetch an extension script and inject into a target document using a blob URL
function fetchAndInjectScript(targetDoc, scriptPath, id, attrs) {
    try {
        // Decide injection strategy based on page features rather than hostname
        const trustedHTMLRequired = docRequiresTrustedHTML(targetDoc);
        const blobAllowed = docAllowsBlobScripts(targetDoc);
        if (trustedHTMLRequired || !blobAllowed) {
            // Pages that require TrustedHTML or explicitly block blob: should use extension URL instead
            const s = targetDoc.createElement('script');
            if (id) s.id = id;
            if (attrs) Object.keys(attrs).forEach(k => s.setAttribute(k, attrs[k]));
            try { s.setAttribute('src', safeGetURL(scriptPath)); } catch (e) { s.src = safeGetURL(scriptPath) }
            targetDoc.head.appendChild(s);
            return;
        }

        fetch(safeGetURL(scriptPath)).then(r => r.text()).then(code => {
            try {
                const s = targetDoc.createElement('script');
                if (id) s.id = id;
                if (attrs) Object.keys(attrs).forEach(k => s.setAttribute(k, attrs[k]));
                const blob = new Blob([code], { type: 'text/javascript' });
                const blobUrl = URL.createObjectURL(blob);
                try { s.setAttribute('src', blobUrl); } catch (e) { s.src = blobUrl }
                targetDoc.head.appendChild(s);
            } catch (e) {
                // fallback
                const s = targetDoc.createElement('script');
                if (id) s.id = id;
                if (attrs) Object.keys(attrs).forEach(k => s.setAttribute(k, attrs[k]));
                try { s.setAttribute('src', safeGetURL(scriptPath)); } catch (e2) { s.src = safeGetURL(scriptPath) }
                targetDoc.head.appendChild(s);
            }
        }).catch(err => {
            const s = targetDoc.createElement('script');
            if (id) s.id = id;
            if (attrs) Object.keys(attrs).forEach(k => s.setAttribute(k, attrs[k]));
            try { s.setAttribute('src', safeGetURL(scriptPath)); } catch (e) { s.src = safeGetURL(scriptPath) }
            targetDoc.head.appendChild(s);
        });
    } catch (e) {
        try {
            const s = targetDoc.createElement('script');
            if (id) s.id = id;
            if (attrs) Object.keys(attrs).forEach(k => s.setAttribute(k, attrs[k]));
            try { s.setAttribute('src', safeGetURL(scriptPath)); } catch (e2) { s.src = safeGetURL(scriptPath) }
            targetDoc.head.appendChild(s);
        } catch (err) { logging(err) }
    }
}

function injectInitScriptTag() {
    if (document.getElementById('CnP-init') || document.documentElement.dataset.cnpPageHookLoaded)
        return;

    const initJS = document.createElement('script');
    initJS.id = `CnP-init`;
    initJS.setAttribute('overlayhtml', safeGetURL('overlay.html'));

    try { initJS.setAttribute('src', safeGetURL('init.js')); } catch (e) { initJS.src = safeGetURL('init.js') }
    const scriptParent = document.head || document.documentElement;
    if (scriptParent)
        scriptParent.appendChild(initJS);
}

function requestMainWorldInit() {
    return new Promise(resolve => {
        try {
            if (document.documentElement.dataset.cnpPageHookLoaded) {
                resolve(true);
                return;
            }

            if (typeof chrome === 'undefined' || !chrome.runtime || typeof chrome.runtime.sendMessage !== 'function') {
                resolve(false);
                return;
            }

            chrome.runtime.sendMessage({ Type: 'CnP-inject-main-world' }, response => {
                try {
                    if (chrome.runtime.lastError)
                        resolve(false);
                    else
                        resolve(!!(response && response.ok));
                } catch (e) { resolve(false) }
            });
        } catch (e) { resolve(false) }
    });
}

// Inject init.js into the page world as early as possible. Chromium uses
// chrome.scripting for MAIN-world injection; Firefox and fallback paths use a
// script tag when the page hook marker is still missing.
requestMainWorldInit().then(ok => {
    const fallbackDelay = ok ? 100 : 0;
    setTimeout(() => {
        if (!document.documentElement.dataset.cnpPageHookLoaded)
            injectInitScriptTag();
    }, fallbackDelay);
});

function isPageFileInput(node) {
    return node && node.matches && node.matches("input[type='file']") && node.id !== 'cnp-overlay-file-input' && !node.id.toLowerCase().startsWith('cnp');
}

function hasActiveUserGesture() {
    return !navigator.userActivation || navigator.userActivation.isActive;
}

function hasRecentPageActivation(fileInput) {
    const activatedAt = Number(fileInput.dataset.cnpPageActivation || 0);
    return activatedAt > 0 && Date.now() - activatedAt < 1000;
}

function findClickedFileInput(event) {
    const path = typeof event.composedPath === 'function' ? event.composedPath() : [event.target];
    const pathInput = path.find(node => isPageFileInput(node));
    if (pathInput)
        return pathInput;

    const label = path.find(node => node && node.tagName === 'LABEL');
    if (!label)
        return null;

    if (isPageFileInput(label.control))
        return label.control;

    if (label.querySelector) {
        const nestedInput = label.querySelector("input[type='file']");
        if (isPageFileInput(nestedInput))
            return nestedInput;
    }

    return null;
}

function openOverlayFromCapturedClick(event, fileInput) {
    setupcreateOverlay(fileInput);
    createOverlay({
        target: fileInput,
        preventDefault: () => {
            if (event.cancelable !== false)
                event.preventDefault();
        },
        stopPropagation: () => {
            event.stopPropagation();
            if (typeof event.stopImmediatePropagation === 'function')
                event.stopImmediatePropagation();
        }
    });
}

function installFileInputActivationListeners() {
    if (document.cnpFileInputActivationListeners)
        return;

    document.cnpFileInputActivationListeners = true;
    document.addEventListener('cnp-page-file-input-activated', event => {
        const fileInput = isPageFileInput(event.target) ? event.target : null;
        if (!fileInput || !hasRecentPageActivation(fileInput) || !hasActiveUserGesture())
            return;

        openOverlayFromCapturedClick(event, fileInput);
    }, true);

    document.addEventListener("click", event => {
        const fileInput = findClickedFileInput(event);
        if (fileInput)
            openOverlayFromCapturedClick(event, fileInput);
    }, true);
}

installFileInputActivationListeners();

function afterDOMLoaded() {
    // Prep all input file elements
    installFileInputActivationListeners();

    // Run through DOM to detect:
    document.querySelectorAll('*').forEach((element, index) => {
        // Raw input file elements
        if (element.matches("input[type='file']"))
            setupcreateOverlay(element);

        // Shadow roots
        else if (element.shadowRoot)
            element.shadowRoot.querySelectorAll("input[type='file']").forEach(fileInput => setupcreateOverlay(fileInput));

        // iframes
        else if (element.matches('iframe'))
            if (element.contentDocument) {
                element.classList.add(`CnP-iframe-${index}`);
                fetchAndInjectScript(element.contentDocument, 'init.js', `CnP-init-iframe-${index}`);
                fetchAndInjectScript(element.contentDocument, 'content.js', `CnP-iframe-${index}`, { overlayhtml: safeGetURL('overlay.html') });
            }
    });

    // Find and prep customized input file elements, iframes
    if (!document.body.cnpMutationObserver) {
        const observer = new MutationObserver(mutations => {
            // 'Reload' extension when navigated to other pages within the website
            if (lastURL !== location.href) {
                lastURL = location.href;
                afterDOMLoaded();
            }

            // Watch the DOM to detect:
            mutations.forEach(mutation => {
                mutation.addedNodes.forEach((node, index) => {
                    // Input file elements
                    if (node.nodeType === Node.ELEMENT_NODE && node.matches("input[type='file']"))
                        setupcreateOverlay(node);

                    // Shadow roots
                    else if (node.nodeType === Node.ELEMENT_NODE && node.shadowRoot) {
                        const fileInputs = node.shadowRoot.querySelectorAll("input[type='file']");
                        fileInputs.forEach(fileInput => setupcreateOverlay(fileInput));
                    }

                    // iframes
                    else if (node.nodeType === Node.ELEMENT_NODE && node.matches("iframe")) {
                        if (node.contentDocument) {
                            // Inject scripts into dynamically added iframe using blob URLs
                            node.classList.add(`CnP-mutatedIframe-${index}`);
                            fetchAndInjectScript(node.contentDocument, 'init.js', `CnP-init-iframe-${index}`);
                            fetchAndInjectScript(node.contentDocument, 'content.js', `CnP-mutatedIframe-${index}`, { overlayhtml: safeGetURL('overlay.html') });
                        }
                    }

                    // Checks if sub-nodes/child are input file elements
                    else if (node.nodeType === Node.ELEMENT_NODE && node.hasChildNodes())
                        node.querySelectorAll("input[type='file']").forEach(fileInput => setupcreateOverlay(fileInput));

                    // If the added node is a document fragment, it may contain shadow hosts
                    else if (node.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
                        node.childNodes.forEach(childNode => {
                            if (childNode.nodeType === Node.ELEMENT_NODE && childNode.shadowRoot)
                                childNode.shadowRoot.querySelectorAll("input[type='file']").forEach(fileInput => setupcreateOverlay(fileInput));
                        });
                    }
                });
            });
        });
        try {
            observer.observe(document.body, { childList: true, subtree: true });
            document.body.cnpMutationObserver = true;
        } catch (error) { logging(error) }
    }
}
