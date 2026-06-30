/* 
Initializes global variables and functions.
*/

// Global variables
var clientX = 0;
var clientY = 0;
var overlayID = null;
var originalInput = null;
var ctrlVdata = null;
var currentObjectURL = null;
var reader = null; //Paste event listener's
var isFirefox = typeof InstallTrigger !== 'undefined';
var isChrome = !!window.chrome && (!!window.chrome.webstore || !!window.chrome.runtime);
var cnpSuppressedFileInputs = new WeakSet();
var cnpObservedRoots = new WeakSet();
var cnpIgnoreOutsideClicksUntil = 0;
var cnpActivationUntil = 0;
var cnpActivationFileInputCount = 0;
var cnpActivationPoint = null;
var cnpOverlayOpening = false;
var cnpAssigningFilesUntil = 0;

const cnpClipboardExtensionByType = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'application/pdf': 'pdf',
    'video/mp4': 'mp4',
    'audio/mpeg': 'mp3',
    'audio/wav': 'wav'
};

const CNP_BRIDGE_CHANNEL = 'copy-n-paste:clipboard';
const CNP_PAGE_REQUEST = 'page-request';
const CNP_CONTENT_RESPONSE = 'content-response';

document.documentElement.dataset.cnpInitLoaded = 'true';

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

function isExtensionURL(url) {
    try {
        const parsed = new URL(url, location.href);
        return parsed.protocol === 'chrome-extension:' || parsed.protocol === 'moz-extension:';
    } catch (e) { }
    return false;
}

function getExtensionResourceURL(path) {
    try {
        const runtimeURL = safeGetURL(path);
        if (runtimeURL && runtimeURL !== path && isExtensionURL(runtimeURL))
            return runtimeURL;
    } catch (e) { }

    const script = document.querySelector('script#CnP-init[cnpbaseurl], script[id^="CnP-init-iframe"][cnpbaseurl], script[id^="CnP-iframe"][cnpbaseurl], script[id^="CnP-mutatedIframe"][cnpbaseurl]');
    if (script) {
        const baseURL = script.getAttribute('cnpbaseurl');
        if (baseURL && isExtensionURL(baseURL)) {
            try {
                return new URL(path, baseURL).href;
            } catch (e) { }
        }
    }

    return null;
}

// Feature detection helpers (same logic as content.js)
function docRequiresTrustedHTML() {
    try {
        try { document.createElement('div'); } catch (e) { }
        try {
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

function docAllowsBlobScripts() {
    try {
        try {
            const meta = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
            if (meta && meta.content) {
                const content = meta.content;
                const hasScriptSrc = /script-src/i.test(content);
                const hasBlob = /\bblob:\b/.test(content);
                if (hasScriptSrc && !hasBlob)
                    return false;
                return true;
            }
        } catch (e) { }
        return true;
    } catch (e) { return true }
}

function isFileInputElement(node) {
    return !!(node && node.tagName === 'INPUT' && node.type === 'file');
}

function isCnPFileInput(node) {
    return isFileInputElement(node) && node.id && node.id.toLowerCase().startsWith('cnp');
}

function fileInputFromEvent(event) {
    const path = event && event.composedPath ? event.composedPath() : [];
    const pathInput = path.find(node => isFileInputElement(node));
    if (pathInput)
        return pathInput;

    if (isFileInputElement(event && event.target))
        return event.target;

    return null;
}

function stopPageFileInputEvent(event) {
    try { event.stopImmediatePropagation() } catch (e) { }
}

function suppressFollowUpFilePicker(input) {
    if (!input)
        return;

    cnpSuppressedFileInputs.add(input);
    setTimeout(() => cnpSuppressedFileInputs.delete(input), 1000);
}

function restoreFileInputDisabledState(input) {
    if (!input || !input.cnpTemporarilyDisabled)
        return;

    input.disabled = !!input.cnpOriginalDisabled;
    input.cnpTemporarilyDisabled = false;
}

function isWithinCnPOverlay(node) {
    try {
        return !!(node && node.closest && node.closest('.cnp-overlay'));
    } catch (e) { }
    return false;
}

function markTrustedActivation(event) {
    const path = event && event.composedPath ? event.composedPath() : [event && event.target];
    if (!event || !event.isTrusted || path.some(isWithinCnPOverlay))
        return;

    cnpActivationUntil = Date.now() + 500;
    cnpActivationFileInputCount = document.querySelectorAll("input[type='file']").length;
    cnpActivationPoint = typeof event.clientX === 'number' && typeof event.clientY === 'number'
        ? { x: event.clientX, y: event.clientY }
        : null;
}

function activationCanClaimNewFileInput() {
    return Date.now() < cnpActivationUntil
        && Date.now() >= cnpAssigningFilesUntil
        && cnpActivationFileInputCount === 0;
}

function preparePendingFileInput(input) {
    if (!isFileInputElement(input) || isCnPFileInput(input) || !activationCanClaimNewFileInput())
        return;

    cnpActivationUntil = 0;
    setupcreateOverlay(input);
    input.cnpActivationPoint = cnpActivationPoint;

    if (input.cnpPendingActivationGuard)
        return;

    input.cnpPendingActivationGuard = true;
    if (!input.cnpTemporarilyDisabled) {
        input.cnpOriginalDisabled = !!input.disabled;
        input.cnpTemporarilyDisabled = true;
    }
    input.disabled = true;
    setTimeout(() => {
        const shouldOpenOverlay = input.isConnected
            && !document.querySelector('.cnp-overlay')
            && !cnpOverlayOpening
            && Date.now() >= cnpAssigningFilesUntil;

        restoreFileInputDisabledState(input);
        input.cnpPendingActivationGuard = false;

        if (shouldOpenOverlay)
            openOverlayForInput(input, { preventDefault() { } });
    }, 75);
}

function handleFileInputActivation(input, event) {
    if (!isFileInputElement(input) || isCnPFileInput(input))
        return false;

    if (Date.now() < cnpAssigningFilesUntil && !(event && event.isTrusted)) {
        if (event && event.preventDefault)
            event.preventDefault();
        if (event)
            stopPageFileInputEvent(event);
        return true;
    }

    if (cnpSuppressedFileInputs.has(input)) {
        if (event && event.preventDefault)
            event.preventDefault();
        if (event)
            stopPageFileInputEvent(event);
        return true;
    }

    setupcreateOverlay(input);
    openOverlayForInput(input, event);
    if (event)
        stopPageFileInputEvent(event);
    return true;
}

function scanUploadRoot(root) {
    try {
        if (isFileInputElement(root)) {
            setupcreateOverlay(root);
            preparePendingFileInput(root);
        }
        if (root && root.querySelectorAll)
            root.querySelectorAll("input[type='file']").forEach(fileInput => {
                setupcreateOverlay(fileInput);
                preparePendingFileInput(fileInput);
            });
    } catch (e) { logging(e) }
}

function observeUploadRoot(root) {
    if (!root || cnpObservedRoots.has(root))
        return;

    cnpObservedRoots.add(root);
    scanUploadRoot(root);

    try {
        const observer = new MutationObserver(mutations => {
            mutations.forEach(mutation => {
                mutation.addedNodes.forEach(node => scanUploadRoot(node));
            });
        });
        observer.observe(root, { childList: true, subtree: true });
    } catch (e) { logging(e) }
}

function acceptFromPickerOptions(options) {
    const accept = [];
    try {
        (options && options.types || []).forEach(type => {
            Object.keys(type.accept || {}).forEach(mimeType => {
                accept.push(mimeType);
                (type.accept[mimeType] || []).forEach(extension => accept.push(extension));
            });
        });
    } catch (e) { }
    return [...new Set(accept)].join(',');
}

function fileToHandle(file) {
    const handle = {
        kind: 'file',
        name: file.name,
        getFile: () => Promise.resolve(file),
        isSameEntry: other => Promise.resolve(other === handle)
    };
    return handle;
}

function cnpTimestampedFileName(type) {
    const extension = cnpClipboardExtensionByType[type] || (type && type.includes('/') ? type.split('/').pop() : 'bin');
    return 'CnP_' + new Date().toLocaleString('en-GB', { hour12: false }).replace(/, /g, '_').replace(/[\/: ]/g, '') + '.' + extension;
}

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

function normalizeClipboardFile(file) {
    if (file.name && file.name !== 'image.png')
        return file;

    return new File([file], cnpTimestampedFileName(file.type), { type: file.type, lastModified: file.lastModified });
}

function uniqueFiles(files) {
    const seen = new Set();
    return [...files].filter(file => {
        const key = [file.name, file.type, file.size].join('|');
        if (seen.has(key))
            return false;

        seen.add(key);
        return true;
    });
}

function requestClipboardFilesForOverlay(requestedOverlayID) {
    const requestId = crypto.randomUUID();

    const timeout = setTimeout(() => {
        window.removeEventListener('message', onMessage);
        noImage(requestedOverlayID);
    }, 1000);

    function onMessage(event) {
        if (!isSameWindowMessage(event))
            return;

        const data = event.data;
        if (!data
            || data.channel !== CNP_BRIDGE_CHANNEL
            || data.direction !== CNP_CONTENT_RESPONSE
            || data.type !== 'clipboard-files'
            || data.requestId !== requestId
            || data.overlayId !== requestedOverlayID)
            return;

        clearTimeout(timeout);
        window.removeEventListener('message', onMessage);
        renderClipboardFiles(data.files || [], requestedOverlayID);
    }

    window.addEventListener('message', onMessage);
    window.postMessage({
        channel: CNP_BRIDGE_CHANNEL,
        direction: CNP_PAGE_REQUEST,
        type: 'read-clipboard-files',
        requestId,
        overlayId: requestedOverlayID
    }, cnpMessageTargetOrigin());
}

async function renderClipboardFiles(files, requestedOverlayID) {
    if (overlayID !== requestedOverlayID)
        return;

    const overlay = document.getElementById(requestedOverlayID);
    if (!overlay)
        return;

    const excludedFolders = uniqueFiles(files)
        .filter(file => !(file.size === 0 && file.type === ''))
        .map(normalizeClipboardFile);
    if (excludedFolders.length === 0) {
        noImage(requestedOverlayID);
        return;
    }

    if (overlay.dataset.cnpPreviewRendered === 'true')
        return;
    overlay.dataset.cnpPreviewRendered = 'true';

    const badge = overlay.querySelector('.cnp-preview-badge');
    const fileList = new DataTransfer();
    [...originalInput.files].forEach(file => fileList.items.add(file));

    excludedFolders.forEach(file => {
        badge.title += file.name + '\n';
        badge.innerText = parseInt(badge.innerText) + 1;
        if (parseInt(badge.innerText) > 1)
            badge.style.display = 'inline-block';
        fileList.items.add(file);
    });

    const firstFile = excludedFolders[0];
    await new Promise(resolve => {
        reader = new FileReader();
        reader.onload = readerEvent => {
            previewImage('', readerEvent, firstFile, requestedOverlayID);
            resolve();
        };
        reader.onerror = () => resolve();
        reader.onabort = () => resolve();
        reader.readAsArrayBuffer(firstFile);
    });

    const imagePreviewContainer = overlay.querySelector('#cnp-preview-container');
    if (imagePreviewContainer.querySelector('#cnp-image-preview')) {
        ctrlVdata = fileList;
        imagePreviewContainer.style.cursor = 'pointer';
        imagePreviewContainer.onclick = () => assignFilesToOriginalInput(fileList.files);
    } else
        noImage(requestedOverlayID);
}

function openOverlayFilePicker(options) {
    return new Promise((resolve, reject) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.id = 'cnp-virtual-picker-input';
        input.accept = acceptFromPickerOptions(options);
        input.multiple = !!(options && options.multiple);
        input.style.display = 'none';
        input.cnpPickerSettled = false;
        input.cnpPickerReject = reject;
        input.addEventListener('change', () => {
            input.cnpPickerSettled = true;
            resolve([...input.files].map(fileToHandle));
            input.remove();
        }, { once: true });

        (document.body || document.documentElement).appendChild(input);
        openOverlayForInput(input, { preventDefault() { } });
    });
}

function installPageUploadHooks() {
    if (window.cnpPageUploadHooksInstalled)
        return;
    window.cnpPageUploadHooksInstalled = true;

    ['pointerdown', 'mousedown', 'click', 'keydown'].forEach(type => document.addEventListener(type, markTrustedActivation, true));

    document.addEventListener('click', event => {
        const input = fileInputFromEvent(event);
        if (!input)
            return;

        if (isCnPFileInput(input)) {
            stopPageFileInputEvent(event);
            return;
        }

        handleFileInputActivation(input, event);
    }, true);

    const originalClick = HTMLElement.prototype.click;
    HTMLElement.prototype.click = function (...args) {
        if (handleFileInputActivation(this, null))
            return undefined;
        return originalClick.apply(this, args);
    };

    const originalShowPicker = HTMLInputElement.prototype.showPicker;
    if (typeof originalShowPicker === 'function')
        HTMLInputElement.prototype.showPicker = function (...args) {
            if (handleFileInputActivation(this, null))
                return undefined;
            return originalShowPicker.apply(this, args);
        };

    const originalShowOpenFilePicker = window.showOpenFilePicker;
    if (typeof originalShowOpenFilePicker === 'function')
        window.showOpenFilePicker = function (options) {
            return openOverlayFilePicker(options);
        };

    const originalCreateElement = Document.prototype.createElement;
    Document.prototype.createElement = function (...args) {
        const element = originalCreateElement.apply(this, args);
        if (String(args[0]).toLowerCase() === 'input')
            queueMicrotask(() => {
                if (isFileInputElement(element)) {
                    setupcreateOverlay(element);
                    preparePendingFileInput(element);
                }
            });
        return element;
    };

    const originalAppendChild = Node.prototype.appendChild;
    Node.prototype.appendChild = function (...args) {
        const node = originalAppendChild.apply(this, args);
        scanUploadRoot(node);
        return node;
    };

    const originalInsertBefore = Node.prototype.insertBefore;
    Node.prototype.insertBefore = function (...args) {
        const node = originalInsertBefore.apply(this, args);
        scanUploadRoot(node);
        return node;
    };

    const originalReplaceChild = Node.prototype.replaceChild;
    Node.prototype.replaceChild = function (...args) {
        const node = originalReplaceChild.apply(this, args);
        scanUploadRoot(args[0]);
        return node;
    };

    const inputTypeDescriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'type');
    if (inputTypeDescriptor && inputTypeDescriptor.get && inputTypeDescriptor.set)
        Object.defineProperty(HTMLInputElement.prototype, 'type', {
            configurable: inputTypeDescriptor.configurable,
            enumerable: inputTypeDescriptor.enumerable,
            get() { return inputTypeDescriptor.get.call(this); },
            set(value) {
                inputTypeDescriptor.set.call(this, value);
                if (String(value).toLowerCase() === 'file') {
                    setupcreateOverlay(this);
                    preparePendingFileInput(this);
                }
            }
        });

    const originalSetAttribute = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function (...args) {
        const result = originalSetAttribute.apply(this, args);
        if (this.tagName === 'INPUT' && String(args[0]).toLowerCase() === 'type' && String(args[1]).toLowerCase() === 'file') {
            setupcreateOverlay(this);
            preparePendingFileInput(this);
        }
        return result;
    };

    const originalAttachShadow = Element.prototype.attachShadow;
    if (typeof originalAttachShadow === 'function')
        Element.prototype.attachShadow = function (...args) {
            const root = originalAttachShadow.apply(this, args);
            observeUploadRoot(root);
            return root;
        };

    observeUploadRoot(document);
}

// Capture cursor coords for overlay position
if (!document.cnpCoordListener)
    document.addEventListener('mousemove', event => {
        document.cnpCoordListener = true;
        clientX = event.clientX;
        clientY = event.clientY;
    });

// Sets a node up for CnP Overlay
function setupcreateOverlay(node) {
    if (node.id != "cnp-overlay-file-input" && !node.dataset.cnpCreateListener) {
        node.addEventListener("click", createOverlay, true);
        node.dataset.cnpCreateListener = "true";
    }
}

installPageUploadHooks();

function assignFilesToOriginalInput(files) {
    if (!originalInput)
        return;

    cnpAssigningFilesUntil = Date.now() + 75;
    try {
        restoreFileInputDisabledState(originalInput);
        const fileList = new DataTransfer();
        [...files].forEach(file => fileList.items.add(file));
        suppressFollowUpFilePicker(originalInput);
        originalInput.files = fileList.files;
        triggerChangeEvent(originalInput);
    } finally {
        closeOverlay();
        setTimeout(() => {
            if (Date.now() >= cnpAssigningFilesUntil)
                cnpAssigningFilesUntil = 0;
        }, 75);
    }
}

function appendFilesToOriginalInput(files) {
    const fileList = new DataTransfer();
    [...originalInput.files, ...files].forEach(file => fileList.items.add(file));
    assignFilesToOriginalInput(fileList.files);
}

// Ctrl V listener
async function ctrlV(event) {
    const overlayContent = document.querySelector('.cnp-overlay-content');
    if (overlayContent && event.ctrlKey && (event.key === 'v' || event.key === 'V')) {
        event.preventDefault();
        if (ctrlVdata && ctrlVdata.files) {
            const fileList = new DataTransfer();
            // Include previously selected files for multi-file
            [...originalInput.files].forEach(file => fileList.items.add(file));

            // Append pasted files
            const readPromise = [...ctrlVdata.files]
                .filter(blob => !(blob.size === 0 && blob.type === ''))
                .map(blob => {
                    return new Promise(resolve => {
                        const reader = new FileReader();
                        let fileName = blob.name;
                        if (blob.name == 'image.png' || !blob.name)
                            fileName = 'CnP_' + new Date().toLocaleString('en-GB', { hour12: false }).replace(/, /g, '_').replace(/[\/: ]/g, '') + '.' + blob.type.split('/').pop();
                        reader.onload = () => {
                            const file = new File([blob], fileName, { type: blob.type, lastModified: blob.lastModified });
                            fileList.items.add(file);
                            resolve();
                        };
                        reader.readAsArrayBuffer(blob);
                    });
                });
            await Promise.all(readPromise);

            assignFilesToOriginalInput(fileList.files);
        }
    }
}

// Preview copied image in overlay
function previewImage(webCopiedImgSrc, readerEvent, blob, requestedOverlayID) {
    if (overlayID !== requestedOverlayID)
        return;

    let imagePreview = document.querySelector('#cnp-image-preview');
    const imagePreviewContainer = document.querySelector('#cnp-preview-container');
    const spinner = document.querySelector('.cnp-spinner');

    if (!imagePreview) {
        // Preview image types
        if (blob.type.split('/')[0] == 'image') {
            imagePreview = document.createElement('img');
            imagePreview.id = 'cnp-image-preview';
            stylePreviewElement(imagePreview);
            currentObjectURL = window.URL.createObjectURL(new Blob([readerEvent.target.result], { type: blob.type }));
            imagePreview.src = currentObjectURL;
            try { imagePreviewContainer.appendChild(imagePreview) } catch (error) { logging(error) }
            imagePreview.onload = () => {
                // Enlarge preview of smaller images
                if ((imagePreview.naturalWidth < 272 && imagePreview.naturalHeight < 153) || imagePreview.naturalHeight < 153 && imagePreview.naturalWidth <= imagePreview.naturalHeight) {
                    imagePreview.style.width = "auto";
                    imagePreview.style.height = "100%";
                } else if (imagePreview.naturalWidth < 272 && imagePreview.naturalWidth > imagePreview.naturalHeight) {
                    imagePreview.style.width = "100%";
                    imagePreview.style.height = "auto";
                }
                spinner.style.display = 'none';
            }
        }
        // Preview PDF type
        else if (blob.type.split('/').pop() == 'pdf') {
            spinner.style.display = 'none';
            imagePreview = document.createElement('iframe');
            imagePreview.id = 'cnp-image-preview';
            stylePreviewElement(imagePreview);
            imagePreview.type = blob.type;
            currentObjectURL = window.URL.createObjectURL(new Blob([readerEvent.target.result], { type: blob.type })) + '#scrollbar=0&view=FitH,top&page=1&toolbar=0&statusbar=0&navpanes=0';
            imagePreview.src = currentObjectURL;
            try { imagePreviewContainer.appendChild(imagePreview) } catch (error) { logging(error) }
            spinner.style.display = 'none';
        }
        // Preview video types
        else if (blob.type.split('/')[0] == 'video') {
            spinner.style.display = 'none';
            imagePreview = document.createElement('video');
            imagePreview.id = 'cnp-image-preview';
            stylePreviewElement(imagePreview);
            imagePreview.preload = "metadata";
            imagePreview.type = blob.type;
            currentObjectURL = window.URL.createObjectURL(new Blob([readerEvent.target.result], { type: blob.type }));
            imagePreview.src = currentObjectURL;
            imagePreview.onloadedmetadata = () => {
                if (imagePreview.videoWidth == 0 || imagePreview.videoHeight == 0)
                    previewGenericFile('audio_file');
                else
                    try { imagePreviewContainer.appendChild(imagePreview) } catch (error) { logging(error) }
            }
            spinner.style.display = 'none';
        }
        // Preview audio type
        else if (blob.type.split('/')[0] == 'audio')
            previewGenericFile('audio_file');
        else if (blob.type.split('/')[0] == 'text')
            previewGenericFile('text_file');
        // Preview other file types
        else
            previewGenericFile('blank_file');
    }

    function previewGenericFile(fileTypeIcon) {
        imagePreview = document.createElement('img');
        imagePreview.id = 'cnp-image-preview';
        stylePreviewElement(imagePreview);
        imagePreview.style.height = '50%';
        imagePreview.src = getExtensionResourceURL(`media/${fileTypeIcon}.webp`) || `media/${fileTypeIcon}.webp`;
        try { imagePreviewContainer.appendChild(imagePreview) } catch (error) { logging(error) }

        let title = document.createElement('span');
        const extension = blob.name.split('.').pop();
        let baseName = blob.name.slice(0, -extension.length - 1);
        if (blob.name.length > 25) {
            baseName = baseName.slice(0, 25);
            // Remove last character if it's a whitespace
            while (baseName[baseName.length - 1] === ' ')
                baseName = baseName.slice(0, -1);
            baseName += '..';
        }

        title.textContent = `${baseName}.${extension}`;
        title.id = 'cnp-image-title';
        imagePreviewContainer.appendChild(title);
        spinner.style.display = 'none';
    }

    // Preview GIF images (copied from web)
    // if (webCopiedImgSrc.endsWith('.gif')) {
    //   img.src = webCopiedImgSrc;
    // }

    // if (webCopiedImgSrc.endsWith('.gif'))
    //   fileName = fileName.replace('.png', '.gif');
}

function stylePreviewElement(element) {
    Object.assign(element.style, {
        border: '0',
        margin: '0',
        maxHeight: '100%',
        maxWidth: '100%',
        objectFit: 'cover',
        pointerEvents: 'none',
        position: 'relative'
    });
}

function createOverlay(event) {
    return openOverlayForInput(event.currentTarget || event.target, event);
}

function overlayAnchorPoint(input, event, overlayContent) {
    const margin = 12;
    const overlayWidth = overlayContent.offsetWidth || 272;
    const overlayHeight = overlayContent.offsetHeight || 210;
    let point = null;

    if (event && typeof event.clientX === 'number' && typeof event.clientY === 'number')
        point = { x: event.clientX, y: event.clientY, pointer: true };
    else if (input && input.cnpActivationPoint)
        point = { x: input.cnpActivationPoint.x, y: input.cnpActivationPoint.y, pointer: true };
    else if (input && input.getBoundingClientRect) {
        const rect = input.getBoundingClientRect();
        if (rect.width > 0 || rect.height > 0)
            point = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, pointer: false };
    }

    if (!point && (clientX || clientY))
        point = { x: clientX, y: clientY, pointer: true };

    if (!point)
        point = { x: innerWidth / 2, y: innerHeight / 2, pointer: false };

    let centerX = point.x;
    let centerY = point.y;

    if (point.pointer) {
        centerY = point.y - overlayHeight / 2 - margin;
        if (centerY - overlayHeight / 2 < margin)
            centerY = point.y + overlayHeight / 2 + margin;
    }

    centerX = Math.min(Math.max(centerX, overlayWidth / 2 + margin), innerWidth - overlayWidth / 2 - margin);
    centerY = Math.min(Math.max(centerY, overlayHeight / 2 + margin), innerHeight - overlayHeight / 2 - margin);

    return {
        left: centerX + window.scrollX,
        top: centerY + window.scrollY
    };
}

// When prepped input elements are clicked
function openOverlayForInput(input, event) {
    // Check if overlay is already visible for this input
    const existingOverlay = document.querySelector('.cnp-overlay');

    if (existingOverlay || cnpOverlayOpening) {
        if (event && event.preventDefault)
            event.preventDefault();
        if (Date.now() < cnpIgnoreOutsideClicksUntil)
            return true;
        if (existingOverlay)
            closeOverlay();
        return true;
    }

    if (event && event.preventDefault)
        event.preventDefault();
    originalInput = input;
    cnpIgnoreOutsideClicksUntil = Date.now() + 250;
    cnpOverlayOpening = true;

    // Create overlay
    const overlay = document.createElement('div');
    overlay.classList.add('cnp-overlay');

    // Unique ID for each created overlay
    const hexArray = Array.from(crypto.getRandomValues(new Uint8Array(16))).map(byte => byte.toString(16).padStart(2, '0'));
    const uuid = [hexArray.slice(0, 4).join(''), hexArray.slice(4, 6).join(''), '4' + hexArray.slice(6, 7).join(''), (parseInt(hexArray[8], 16) & 0x3 | 0x8).toString(16) + hexArray.slice(9, 11).join(''), hexArray.slice(11, 16).join('')].join('-');
    overlay.id = overlayID = uuid;

    // Fetch overlay.html
    function fetchURL() {
        return new Promise(resolve => {
            resolve(getExtensionResourceURL('overlay.html'));
        });
    }

    try {
        fetchURL().then(urlToFetch => {
            if (urlToFetch) {
                fetch(urlToFetch)
                    .then(response => response.text())
                    .then(html => {
                        // Prevents duplicate overlay setup
                        if (document.querySelector('.cnp-overlay')) {
                            cnpOverlayOpening = false;
                            return;
                        }

                        // Insert overlay HTML safely: parse the packaged overlay in an inert document and append nodes.
                        function insertOverlayHtml(overlayElem, htmlString) {
                            try {
                                let parsed;
                                try {
                                    parsed = new DOMParser().parseFromString(htmlString, 'text/html');
                                } catch (parseErr) {
                                    // Some hosts require TrustedHTML; DOMParser will throw. Treat as parse failure silently
                                    // to avoid noisy console logs; the DOM-built fallback below avoids HTML string sinks.
                                    parsed = null;
                                    // Only log non-TrustedHTML parse errors
                                    if (parseErr && !(parseErr.message && parseErr.message.includes('TrustedHTML')))
                                        logging(parseErr);
                                }
                                // Prefer the main overlay content element from the parsed document, if parsing succeeded
                                if (parsed) {
                                    const content = parsed.querySelector('.cnp-overlay-content');
                                    if (content) {
                                        // Preserve the wrapper element so later queries for .cnp-overlay-content work
                                        // Also copy any <style> or <link rel="stylesheet"> into the top-level document head
                                        const styles = parsed.querySelectorAll('style, link[rel="stylesheet"]');
                                        styles.forEach(s => {
                                            try {
                                                document.head.appendChild(s.cloneNode(true));
                                            } catch (e) { logging(e) }
                                        });

                                        overlayElem.appendChild(content.cloneNode(true));
                                        return true;
                                    }

                                    const sourceContainer = parsed.body;
                                    if (sourceContainer) {
                                        // No wrapper found; append body children only
                                        Array.from(sourceContainer.children).forEach(child => overlayElem.appendChild(child.cloneNode(true)));
                                        return true;
                                    }
                                }
                            } catch (e) { logging(e) }

                            return buildOverlayFallback(overlayElem);
                        }

                        function buildOverlayFallback(overlayElem) {
                            const overlayContent = document.createElement('div');
                            overlayContent.className = 'cnp-overlay-content';
                            Object.assign(overlayContent.style, {
                                all: 'initial',
                                backdropFilter: 'blur(15px)',
                                position: 'absolute',
                                transform: 'translate(-50%, -50%)',
                                backgroundColor: 'rgba(240, 240, 240, .75)',
                                border: '1px solid #bebebe',
                                borderRadius: '8px',
                                boxShadow: '0px 10px 15px rgba(0, 0, 0, 0.35), 0 0 6px rgba(0, 0, 0, 0)',
                                color: '#212529',
                                fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", "Noto Sans", "Liberation Sans", Arial, sans-serif',
                                fontSize: 'medium',
                                lineHeight: '1.25',
                                padding: '0',
                                textAlign: 'center',
                                userSelect: 'none',
                                WebkitBackdropFilter: 'blur(15px)',
                                WebkitUserSelect: 'none',
                                zIndex: '2147483647'
                            });

                            const dropText = document.createElement('span');
                            dropText.id = 'cnp-drop-text';
                            dropText.textContent = 'Drop files here';
                            Object.assign(dropText.style, {
                                alignItems: 'center',
                                backgroundColor: 'rgb(100, 100, 100)',
                                border: '2px dashed #ffffff',
                                borderRadius: '8px',
                                boxSizing: 'border-box',
                                color: 'white',
                                display: 'none',
                                fontWeight: 'normal',
                                height: '100%',
                                justifyContent: 'center',
                                left: '0',
                                pointerEvents: 'none',
                                position: 'absolute',
                                top: '0',
                                width: '100%',
                                zIndex: '1'
                            });

                            const previewContainer = document.createElement('div');
                            previewContainer.id = 'cnp-preview-container';
                            Object.assign(previewContainer.style, {
                                alignItems: 'center',
                                display: 'flex',
                                flexDirection: 'column',
                                height: '153px',
                                justifyContent: 'center',
                                marginTop: '7px',
                                width: '272px'
                            });

                            const spinner = document.createElement('div');
                            spinner.className = 'cnp-spinner';
                            previewContainer.appendChild(spinner);

                            const badge = document.createElement('span');
                            badge.className = 'cnp-preview-badge';
                            badge.textContent = '0';
                            Object.assign(badge.style, {
                                backgroundColor: 'rgba(240, 240, 240)',
                                backdropFilter: 'blur(15px)',
                                border: '1px solid #bebebe',
                                borderRadius: '8px',
                                color: '#212529',
                                display: 'none',
                                fontSize: '1.1em',
                                fontWeight: '400',
                                left: '98%',
                                lineHeight: '0.85',
                                padding: '0.3em 0.5em',
                                position: 'absolute',
                                textAlign: 'center',
                                top: '4%',
                                transform: 'translate(-50%, -50%)',
                                WebkitBackdropFilter: 'blur(15px)',
                                wordBreak: 'normal'
                            });

                            const separator = document.createElement('hr');
                            separator.className = 'cnp-hr';
                            Object.assign(separator.style, {
                                border: '0',
                                borderTop: '.5px solid',
                                color: 'inherit',
                                height: '0px',
                                margin: '7px 0',
                                opacity: '.25',
                                padding: '0',
                                width: '100%'
                            });

                            const fileInput = document.createElement('input');
                            fileInput.type = 'file';
                            fileInput.id = 'cnp-overlay-file-input';
                            fileInput.style.display = 'none';

                            const uploadButton = document.createElement('div');
                            uploadButton.id = 'cnp-upload-btn';
                            uploadButton.className = 'cnp-menu-item';
                            Object.assign(uploadButton.style, {
                                cursor: 'default',
                                marginBottom: '7px',
                                padding: '6px'
                            });

                            const upload = document.createElement('span');
                            upload.id = 'cnp-upload';
                            upload.style.fontWeight = 'normal';
                            upload.appendChild(document.createTextNode('+ '));

                            const uploadText = document.createElement('span');
                            uploadText.id = 'cnp-upload-text';
                            uploadText.textContent = 'Upload File';
                            upload.appendChild(uploadText);
                            uploadButton.appendChild(upload);

                            overlayContent.append(dropText, previewContainer, badge, separator, fileInput, uploadButton);
                            overlayElem.appendChild(overlayContent);
                            return true;
                        }

                        insertOverlayHtml(overlay, html);

                            (document.body || document.documentElement).appendChild(overlay);
                        cnpOverlayOpening = false;
                        // Ensure overlay floats above page content even if page CSS wasn't copied
                        try {
                            overlay.style.left = overlay.style.left || '0px';
                            overlay.style.top = overlay.style.top || '0px';
                            overlay.style.zIndex = overlay.style.zIndex || '2147483647';
                        } catch (e) { logging(e) }

                        // Position overlay to cursor coord
                        const overlayContent = overlay.querySelector('.cnp-overlay-content');
                        if (!overlayContent) {
                            logging('overlay content missing after insertion');
                            return;
                        }

                        const anchor = overlayAnchorPoint(originalInput, event, overlayContent);
                        overlayContent.style.left = anchor.left + 'px';
                        overlayContent.style.top = anchor.top + 'px';

                        // Follow attributes of original input element
                        const overlayFileInput = overlay.querySelector('#cnp-overlay-file-input');
                        overlayFileInput.multiple = originalInput.multiple;
                        overlayFileInput.webkitdirectory = originalInput.webkitdirectory;

                        if (overlayFileInput.multiple)
                            overlay.querySelector('#cnp-upload-text').textContent = "Upload Files";

                        // Overlay handle file input
                        overlayFileInput.setAttribute('accept', originalInput.getAttribute('accept') || '');
                        overlayFileInput.oncancel = () => closeOverlay();
                        overlayFileInput.onchange = event => {
                            appendFilesToOriginalInput(event.target.files);
                        }

                        // Overlay upload click listener
                        const uploadBtn = overlay.querySelector('#cnp-upload-btn');
                        function positionOverlayFileInput() {
                            const buttonRect = uploadBtn.getBoundingClientRect();
                            const contentRect = overlayContent.getBoundingClientRect();
                            Object.assign(overlayFileInput.style, {
                                cursor: 'pointer',
                                display: 'block',
                                height: buttonRect.height + 'px',
                                left: (buttonRect.left - contentRect.left) + 'px',
                                opacity: '0',
                                pointerEvents: 'none',
                                position: 'absolute',
                                top: (buttonRect.top - contentRect.top) + 'px',
                                width: buttonRect.width + 'px',
                                zIndex: '2'
                            });
                        }
                        positionOverlayFileInput();
                        overlayFileInput.focus({ preventScroll: true });
                        uploadBtn.onclick = event => {
                            event.stopPropagation();
                            overlayFileInput.click();
                        };

                        // Close overlay when clicked outside
                        if (!document.cnpRemoveListener)
                            document.addEventListener('click', event => {
                                document.cnpRemoveListener = true;
                                if (Date.now() < cnpIgnoreOutsideClicksUntil)
                                    return;

                                document.querySelectorAll('.cnp-overlay-content').forEach(overlayContent => {
                                    if (!overlayContent.contains(event.target))
                                        closeOverlay();
                                })
                            })

                        // Handle dragover event
                        const CNP_dropText = overlay.querySelector('#cnp-drop-text');
                        overlay.ondragover = event => {
                            event.stopPropagation();
                            event.preventDefault();
                            CNP_dropText.style.display = 'flex';
                        };

                        // Handle dragleave event
                        overlay.ondragleave = event => {
                            if (!overlay.contains(event.relatedTarget))
                                CNP_dropText.style.display = 'none';
                        };

                        // Handle drop event
                        overlay.ondrop = event => {
                            event.preventDefault();
                            CNP_dropText.style.display = 'none';
                            const excludedFolders = [...event.dataTransfer.files].filter(file => !(file.size === 0 && file.type === ''));
                            appendFilesToOriginalInput(excludedFolders);
                        };

                        // Handle Ctrl+V action
                        document.addEventListener('keydown', ctrlV);

                        // Handle explicit user paste as a fallback when automatic extension paste is unavailable.
                        document.addEventListener('paste', async event => {
                            if (!event.isTrusted)
                                return;

                            event.stopPropagation();
                            event.preventDefault();
                            renderClipboardFiles(event.clipboardData.files, overlay.id);
                        }, { once: true, capture: true });

                        requestClipboardFilesForOverlay(overlay.id);
                    }).catch(error => {
                        cnpOverlayOpening = false;
                        logging(error);
                    });
            }
        });
    } catch (error) { logging(error) }
    return true;
}


// Preview 'No image' message
function noImage(requestedOverlayID) {
    const overlay = requestedOverlayID ? document.getElementById(requestedOverlayID) : document.querySelector('.cnp-overlay');
    if (!overlay || overlay.querySelector('#cnp-not-image') || overlay.querySelector('#cnp-image-preview'))
        return;

    const CNP_notImage = document.createElement('span');
    CNP_notImage.id = 'cnp-not-image';
    CNP_notImage.textContent = 'Screenshot / Copy / Drop files';

    const imagePreviewContainer = overlay.querySelector('#cnp-preview-container');
    imagePreviewContainer.style.pointerEvents = 'none';
    imagePreviewContainer.appendChild(CNP_notImage);

    const spinner = document.querySelector('.cnp-spinner');
    spinner.style.display = 'none';

    const badge = document.querySelector('.cnp-preview-badge');
    badge.style.display = 'none';
}

// Clones event objects
function cloneEvent(e) {
    if (e === undefined || e === null)
        return undefined;

    function ClonedEvent() { };
    let clone = new ClonedEvent();
    for (let p in e) {
        let d = Object.getOwnPropertyDescriptor(e, p);
        if (d && (d.get || d.set))
            Object.defineProperty(clone, p, d);
        else
            clone[p] = e[p];
    }
    Object.setPrototypeOf(clone, e);
    return clone;
}

// Trigger change event on original input to update value (like disabled buttons)
function triggerChangeEvent(originalInput) {
    originalInput.dispatchEvent(new Event('change', { bubbles: true }));
    originalInput.dispatchEvent(new Event('input', { bubbles: true }));
}

// Close overlay immediate
function closeOverlay() {
    cnpOverlayOpening = false;
    overlayID = null;
    document.querySelectorAll('.cnp-overlay').forEach(overlay => overlay.remove());
    document.removeEventListener('keydown', ctrlV);
    URL.revokeObjectURL(currentObjectURL);
    if (reader != null)
        reader.abort();
}

// Console logging for errors and messages
function logging(message) {
    console.log('%c📋 Copy-n-Paste:\n', 'font-weight: bold; font-size: 1.3em;', message);
}
