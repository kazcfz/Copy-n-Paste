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
var cnpLastTrustedClickAt = 0;
var cnpContentBridgeChannel = 'copy-n-paste:clipboard';
var cnpContentPageRequest = 'page-request';
var cnpContentResponse = 'content-response';
var cnpCancelClipboardRead = null;

function cnpMessageTargetOrigin() {
    return location.origin === 'null' ? '*' : location.origin;
}

function isSameWindowMessage(event) {
    if (event.source !== window)
        return false;

    if (location.origin !== 'null' && event.origin !== location.origin)
        return false;

    return true;
}

function isClipboardPreviewRequest(data) {
    return !!(data
        && data.channel === cnpContentBridgeChannel
        && data.direction === cnpContentPageRequest
        && data.type === 'read-clipboard-files'
        && typeof data.requestId === 'string'
        && /^[a-f0-9-]{36}$/i.test(data.requestId)
        && typeof data.overlayId === 'string'
        && document.getElementById(data.overlayId)?.classList.contains('cnp-overlay'));
}

function readClipboardFilesViaPaste() {
    if (cnpCancelClipboardRead)
        cnpCancelClipboardRead();

    return new Promise(resolve => {
        const pasteTarget = document.createElement('div');
        pasteTarget.contentEditable = 'true';
        pasteTarget.setAttribute('aria-hidden', 'true');
        Object.assign(pasteTarget.style, {
            height: '1px',
            left: '-10000px',
            opacity: '0',
            overflow: 'hidden',
            position: 'fixed',
            top: '-10000px',
            width: '1px'
        });

        let settled = false;
        function finish(files) {
            if (settled)
                return;

            settled = true;
            document.removeEventListener('paste', onPaste, true);
            pasteTarget.remove();
            if (cnpCancelClipboardRead === cancel)
                cnpCancelClipboardRead = null;
            resolve(files);
        }

        function cancel() {
            finish([]);
        }

        function onPaste(event) {
            event.stopPropagation();
            event.preventDefault();
            finish([...event.clipboardData.files].filter(file => !(file.size === 0 && file.type === '')));
        }

        cnpCancelClipboardRead = cancel;
        document.addEventListener('paste', onPaste, { once: true, capture: true });
        (document.body || document.documentElement).appendChild(pasteTarget);
        pasteTarget.focus({ preventScroll: true });

        try { document.execCommand('paste') } catch (e) { }
        setTimeout(() => finish([]), 300);
    });
}

window.addEventListener('message', async event => {
    if (!isSameWindowMessage(event) || !isClipboardPreviewRequest(event.data))
        return;

    if (Date.now() - cnpLastTrustedClickAt > 5000) {
        window.postMessage({
            channel: cnpContentBridgeChannel,
            direction: cnpContentResponse,
            type: 'clipboard-files',
            requestId: event.data.requestId,
            overlayId: event.data.overlayId,
            files: []
        }, cnpMessageTargetOrigin());
        return;
    }

    window.postMessage({
        channel: cnpContentBridgeChannel,
        direction: cnpContentResponse,
        type: 'clipboard-files',
        requestId: event.data.requestId,
        overlayId: event.data.overlayId,
        files: await readClipboardFilesViaPaste()
    }, cnpMessageTargetOrigin());
});

function markTrustedActivation(event) {
    if (event.isTrusted)
        cnpLastTrustedClickAt = Date.now();
}

['pointerdown', 'mousedown', 'keydown', 'click'].forEach(type => {
    window.addEventListener(type, markTrustedActivation, true);
    document.addEventListener(type, markTrustedActivation, true);
});

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

function extensionBaseURL() {
    try {
        return safeGetURL('');
    } catch (e) { }
    return '';
}

function appendScript(targetDoc, script) {
    (targetDoc.head || targetDoc.documentElement || targetDoc).appendChild(script);
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
            appendScript(targetDoc, s);
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
                appendScript(targetDoc, s);
            } catch (e) {
                // fallback
                const s = targetDoc.createElement('script');
                if (id) s.id = id;
                if (attrs) Object.keys(attrs).forEach(k => s.setAttribute(k, attrs[k]));
                try { s.setAttribute('src', safeGetURL(scriptPath)); } catch (e2) { s.src = safeGetURL(scriptPath) }
                appendScript(targetDoc, s);
            }
        }).catch(err => {
            const s = targetDoc.createElement('script');
            if (id) s.id = id;
            if (attrs) Object.keys(attrs).forEach(k => s.setAttribute(k, attrs[k]));
            try { s.setAttribute('src', safeGetURL(scriptPath)); } catch (e) { s.src = safeGetURL(scriptPath) }
            appendScript(targetDoc, s);
        });
    } catch (e) {
        try {
            const s = targetDoc.createElement('script');
            if (id) s.id = id;
            if (attrs) Object.keys(attrs).forEach(k => s.setAttribute(k, attrs[k]));
            try { s.setAttribute('src', safeGetURL(scriptPath)); } catch (e2) { s.src = safeGetURL(scriptPath) }
            appendScript(targetDoc, s);
        } catch (err) { logging(err) }
    }
}

// Inject init.js to the DOM: use extension URL for Google Docs/Slides (their CSP blocks blob:),
// otherwise use blob injection to avoid TrustedScriptURL enforcement on other pages.
if (!document.getElementById('CnP-init')) {
    const initJS = document.createElement('script');
    initJS.id = `CnP-init`;
    initJS.setAttribute('overlayhtml', safeGetURL('overlay.html'));
    initJS.setAttribute('cnpbaseurl', extensionBaseURL());

    try { initJS.setAttribute('src', safeGetURL('init.js')); } catch (e) { initJS.src = safeGetURL('init.js') }
    appendScript(document, initJS);
}

function afterDOMLoaded() {
    // Prep all input file elements
    if (!document.cnpClickListener) {
        document.cnpClickListener = true;
        document.addEventListener("click", event => {
            if (event.target.matches("input[type='file']"))
                setupcreateOverlay(event.target);
        }, true);
    }

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
                fetchAndInjectScript(element.contentDocument, 'init.js', `CnP-init-iframe-${index}`, { overlayhtml: safeGetURL('overlay.html'), cnpbaseurl: extensionBaseURL() });
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
                    else if (node.nodeType === Node.ELEMENT_NODE && node.matches("iframe"))
                        if (node.contentDocument) {
                            // Inject scripts into dynamically added iframe using blob URLs
                            node.classList.add(`CnP-mutatedIframe-${index}`);
                            fetchAndInjectScript(node.contentDocument, 'init.js', `CnP-init-iframe-${index}`, { overlayhtml: safeGetURL('overlay.html'), cnpbaseurl: extensionBaseURL() });
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

    document.documentElement.dataset.cnpPageHookLoaded = 'true';
}
