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
var cnpLastGesture = 0;

// Expose the extension base URL so the main-world init.js (no chrome.runtime) can resolve resources.
try { document.documentElement.setAttribute('data-cnp-base', safeGetURL('')); } catch (e) { }

// Track genuine user gestures so the clipboard bridge only fires in response to real interaction.
if (!document.cnpGestureListener) {
    document.cnpGestureListener = true;
    ['pointerdown', 'keydown'].forEach(type =>
        document.addEventListener(type, event => { if (event.isTrusted) cnpLastGesture = Date.now(); }, true));
}

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

// Inject init.js to the DOM: use extension URL for Google Docs/Slides (their CSP blocks blob:),
// otherwise use blob injection to avoid TrustedScriptURL enforcement on other pages.
// Fallback only — the manifest's world:MAIN content script normally puts init.js in the page world.
if (!document.documentElement.hasAttribute('data-cnp-main') && !document.head.querySelector('#CnP-init')) {
    const initJS = document.createElement('script');
    initJS.id = `CnP-init`;
    initJS.setAttribute('overlayhtml', safeGetURL('overlay.html'));

    const isGoogleDocs = (location.hostname || '').includes('docs.google') || (location.hostname || '').includes('slides.google');
    if (isGoogleDocs) {
        // Docs blocks blob:, but may allow extension's chrome-extension:// URL (depends on installed extension id)
        try { initJS.setAttribute('src', safeGetURL('init.js')); } catch (e) { initJS.src = safeGetURL('init.js') }
        document.head.appendChild(initJS);
    } else {
        // Try to fetch the extension script and inject via blob URL
        try {
            fetch(safeGetURL('init.js'))
                .then(response => response.text())
                .then(code => {
                    try {
                        const blob = new Blob([code], { type: 'text/javascript' });
                        const blobUrl = URL.createObjectURL(blob);
                        initJS.setAttribute('src', blobUrl);
                    } catch (e) {
                        // fallback to direct extension URL
                        try { initJS.setAttribute('src', safeGetURL('init.js')); } catch (e2) { initJS.src = safeGetURL('init.js') }
                    }
                    document.head.appendChild(initJS);
                })
                .catch(err => {
                    // Fallback: append script with extension URL
                    try { initJS.setAttribute('src', safeGetURL('init.js')); } catch (e) { initJS.src = safeGetURL('init.js') }
                    document.head.appendChild(initJS);
                });
        } catch (e) {
            try { initJS.setAttribute('src', safeGetURL('init.js')); } catch (e2) { initJS.src = safeGetURL('init.js') }
            document.head.appendChild(initJS);
        }
    }
}

// Prep a same-origin iframe by injecting the extension scripts into its document.
// Cross-origin iframes are covered independently by the manifest's all_frames content script.
var cnpIframeIndex = 0;
function cnpHandleIframe(iframe) {
    try {
        // world:MAIN + all_frames normally injects into iframes automatically; this is a fallback.
        if (iframe.contentDocument && !iframe.contentDocument.documentElement.hasAttribute('data-cnp-main')) {
            const index = cnpIframeIndex++;
            iframe.classList.add(`CnP-iframe-${index}`);
            fetchAndInjectScript(iframe.contentDocument, 'init.js', `CnP-init-iframe-${index}`);
            fetchAndInjectScript(iframe.contentDocument, 'content.js', `CnP-iframe-${index}`, { overlayhtml: safeGetURL('overlay.html') });
        }
    } catch (error) { logging(error) }
}

// Recursively prep every file input in a root, descending into open shadow trees and
// same-origin iframes. Closed shadow roots are inaccessible by design.
function cnpScan(root) {
    let elements;
    try { elements = root.querySelectorAll('*'); } catch (error) { return }
    elements.forEach(element => {
        if (element.matches("input[type='file']"))
            setupcreateOverlay(element);
        if (element.shadowRoot)
            cnpScan(element.shadowRoot);
        else if (element.matches('iframe'))
            cnpHandleIframe(element);
    });
}

// Prep a single added node: the node itself plus its entire subtree.
function cnpProcessAddedNode(node) {
    if (!node)
        return;
    if (node.nodeType === Node.ELEMENT_NODE) {
        if (node.matches("input[type='file']"))
            setupcreateOverlay(node);
        else if (node.shadowRoot)
            cnpScan(node.shadowRoot);
        else if (node.matches('iframe'))
            cnpHandleIframe(node);
        cnpScan(node);
    } else if (node.nodeType === Node.DOCUMENT_FRAGMENT_NODE)
        cnpScan(node);
}

function afterDOMLoaded() {
    // Intercept clicks on file inputs anywhere in the composed path so open shadow DOM is covered.
    // Inputs already prepped by the scanner/observer are handled by their own listener; anything
    // first seen here (e.g. just inserted in shadow DOM) is handled inline so the very first click
    // shows the overlay instead of leaking through to the native picker.
    if (!document.cnpClickListener) {
        document.cnpClickListener = true;
        document.addEventListener("click", event => {
            const path = (typeof event.composedPath === 'function') ? event.composedPath() : [event.target];
            let fileInput = null;
            for (const node of path)
                if (node && node.matches && node.matches("input[type='file']") && !(node.id || '').toLowerCase().startsWith('cnp')) {
                    fileInput = node;
                    break;
                }
            if (fileInput && fileInput.dataset.cnpCreateListener !== "true")
                try { createOverlay(event, fileInput) } catch (error) { logging(error) }
        }, true);
    }

    // Prep file inputs already present (light DOM, open shadow DOM, same-origin iframes)
    cnpScan(document);

    // Watch for inputs / iframes / shadow hosts added later
    if (!document.body.cnpMutationObserver) {
        const observer = new MutationObserver(mutations => {
            // 'Reload' extension when navigated to other pages within the website (SPA)
            if (lastURL !== location.href) {
                lastURL = location.href;
                afterDOMLoaded();
            }
            mutations.forEach(mutation => mutation.addedNodes.forEach(cnpProcessAddedNode));
        });
        try {
            observer.observe(document.body, { childList: true, subtree: true });
            document.body.cnpMutationObserver = true;
        } catch (error) { logging(error) }
    }

    // Clipboard bridge: the page's main-world script (no clipboardRead) asks this isolated content
    // script to read the clipboard. Only honor requests from our own origin, while an overlay is
    // open and shortly after a real user gesture, so a hostile page can't silently read the clipboard.
    if (!window.cnpMessageListener) {
        window.cnpMessageListener = true;
        window.addEventListener('message', event => {
            if (event.origin !== location.origin)
                return;
            const data = event.data;
            if (!data || data.cnp !== 'copy-n-paste' || data.type !== 'read-clipboard')
                return;
            if (!document.querySelector('.cnp-overlay') || Date.now() - cnpLastGesture > 5000)
                return;
            try { document.execCommand('paste'); } catch (error) { logging(error) }
        });
    }
}
