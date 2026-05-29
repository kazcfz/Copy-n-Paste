/* 
Initializes global variables and functions.
*/

try {
    document.documentElement.dataset.cnpInitLoaded = 'true';
    if (!(typeof chrome !== 'undefined' && chrome.runtime))
        document.documentElement.dataset.cnpPageHookLoaded = 'true';
} catch (e) { }

var isPageWorld = !(typeof chrome !== 'undefined' && chrome.runtime);
var cnpNativeFunctionStrings = window.cnpNativeFunctionStrings || new WeakMap();
window.cnpNativeFunctionStrings = cnpNativeFunctionStrings;
var cnpOriginalFunctionToString = window.cnpOriginalFunctionToString || Function.prototype.toString;
window.cnpOriginalFunctionToString = cnpOriginalFunctionToString;

if (!Function.prototype.cnpMirrorsNativeFunctions) {
    const mirroredFunctionToString = {
        toString() {
            if (cnpNativeFunctionStrings.has(this))
                return cnpNativeFunctionStrings.get(this);

            return cnpOriginalFunctionToString.call(this);
        }
    }.toString;
    cnpNativeFunctionStrings.set(mirroredFunctionToString, cnpOriginalFunctionToString.call(cnpOriginalFunctionToString));
    Function.prototype.toString = mirrorNativeFunction(mirroredFunctionToString, cnpOriginalFunctionToString);
    Object.defineProperty(Function.prototype, 'cnpMirrorsNativeFunctions', {
        value: true,
        configurable: true
    });
}

function mirrorNativeFunction(wrapper, original) {
    try {
        Object.defineProperty(wrapper, 'name', {
            value: original.name,
            configurable: true
        });
        Object.defineProperty(wrapper, 'length', {
            value: original.length,
            configurable: true
        });
        cnpNativeFunctionStrings.set(wrapper, cnpOriginalFunctionToString.call(original));
    } catch (e) { }
    return wrapper;
}

function isCnPFileInput(element) {
    return element && element.matches && element.matches("input[type='file']") && !element.id.toLowerCase().startsWith('cnp');
}

function findActivatedFileInput(event) {
    const path = typeof event.composedPath === 'function' ? event.composedPath() : [event.target];
    const pathInput = path.find(node => isCnPFileInput(node));
    if (pathInput)
        return pathInput;

    const label = path.find(node => node && node.tagName === 'LABEL');
    if (!label)
        return null;

    if (isCnPFileInput(label.control))
        return label.control;

    if (label.querySelector) {
        const nestedInput = label.querySelector("input[type='file']");
        if (isCnPFileInput(nestedInput))
            return nestedInput;
    }

    return null;
}

function requestIsolatedOverlayForFileInput(input) {
    try {
        if (navigator.userActivation && !navigator.userActivation.isActive)
            return false;

        input.dataset.cnpPageActivation = String(Date.now());
        input.dispatchEvent(new CustomEvent('cnp-page-file-input-activated', { bubbles: true, composed: true }));
        return true;
    } catch (e) {
        logging(e);
        return false;
    }
}

function filePickerAcceptFromOptions(options) {
    if (!options || !Array.isArray(options.types))
        return '';

    const accept = new Set();
    options.types.forEach(type => {
        if (!type || !type.accept)
            return;

        Object.keys(type.accept).forEach(mimeType => {
            accept.add(mimeType);
            const extensions = Array.isArray(type.accept[mimeType]) ? type.accept[mimeType] : [];
            extensions.forEach(extension => accept.add(extension));
        });
    });
    return [...accept].join(',');
}

function fileSystemHandleForFile(file) {
    const handle = {
        kind: 'file',
        name: file.name,
        getFile: () => Promise.resolve(file),
        isSameEntry: other => Promise.resolve(other === handle)
    };
    return handle;
}

function visibleElement(element) {
    if (!element || !element.getBoundingClientRect)
        return false;

    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
}

function isCnPElement(element) {
    return !!(element && element.closest && element.closest('.cnp-overlay, .cnp-overlay-content'));
}

function dispatchFilesToDropTarget(target, files) {
    const dataTransfer = new DataTransfer();
    [...files].forEach(file => dataTransfer.items.add(file));

    ['dragenter', 'dragover', 'drop'].forEach(type => {
        target.dispatchEvent(new DragEvent(type, {
            bubbles: true,
            cancelable: true,
            dataTransfer
        }));
    });
}

function filesToFileList(files) {
    const dataTransfer = new DataTransfer();
    [...files].forEach(file => dataTransfer.items.add(file));
    return dataTransfer.files;
}

var pendingPickerlessFiles = null;
var pendingPickerlessFallback = null;

function clearPendingPickerlessFiles() {
    if (pendingPickerlessFallback)
        clearTimeout(pendingPickerlessFallback);

    pendingPickerlessFallback = null;
    pendingPickerlessFiles = null;
}

function fulfillPendingPickerlessInput(input) {
    if (!pendingPickerlessFiles || !input || input.type !== 'file')
        return false;

    const files = pendingPickerlessFiles;
    clearPendingPickerlessFiles();
    input.files = filesToFileList(input.multiple ? files : files.slice(0, 1));
    triggerChangeEvent(input);
    return true;
}

function replayPickerlessUpload(control, dropTarget, files) {
    if (!control || files.length === 0)
        return false;

    pendingPickerlessFiles = files;
    pendingPickerlessFallback = setTimeout(() => {
        if (!pendingPickerlessFiles)
            return;

        const fallbackFiles = pendingPickerlessFiles;
        clearPendingPickerlessFiles();
        dispatchFilesToDropTarget(dropTarget, fallbackFiles);
    }, 1200);

    try {
        control.click();
    } catch (e) {
        clearPendingPickerlessFiles();
        dispatchFilesToDropTarget(dropTarget, files);
    }
    return true;
}

function findDropTarget(control) {
    const candidates = [...document.querySelectorAll('body *')]
        .filter(element => !isCnPElement(element) && visibleElement(element) && /\b(drag|drop)\b.+\b(file|photo|image|here)\b/i.test(element.innerText || element.textContent || ''));

    if (candidates.length > 0)
        return candidates.sort((a, b) => {
            const aRect = a.getBoundingClientRect();
            const bRect = b.getBoundingClientRect();
            return (aRect.width * aRect.height) - (bRect.width * bRect.height);
        })[0];

    return control.closest('[role="dialog"]') || document.body;
}

function isPickerlessUploadButton(element) {
    if (!element || !element.matches || !visibleElement(element) || isCnPElement(element))
        return false;
    if (!element.matches('button, a, label, [role="button"], .media-editor-file-selector__upload-media-button'))
        return false;
    if (element.matches('[role="dialog"], [role="tab"], [data-test-modal]'))
        return false;

    const text = `${element.getAttribute('aria-label') || ''} ${element.innerText || element.textContent || ''}`.trim();
    return /\b(upload from computer|choose file|select file|browse files?)\b/i.test(text);
}

function findPickerlessUploadControl(event) {
    const path = typeof event.composedPath === 'function' ? event.composedPath() : [event.target];
    if (path.some(node => isCnPElement(node)))
        return null;
    if (path.some(node => node && node.getAttribute && node.getAttribute('role') === 'tab'))
        return null;
    if (findActivatedFileInput(event))
        return null;

    return path.find(node => isPickerlessUploadButton(node));
}

function openOverlayForDropUpload(control) {
    const dropTarget = findDropTarget(control);
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = /\b(photo|picture|image)\b/i.test(document.body.innerText || '') ? 'image/*' : '';
    input.dataset.cnpPickerProxy = 'true';
    input.style.display = 'none';

    input.addEventListener('change', () => {
        const files = [...input.files];
        input.remove();
        if (files.length > 0)
            replayPickerlessUpload(control, dropTarget, files);
    }, { once: true });
    input.addEventListener('cnp-overlay-cancelled', () => input.remove(), { once: true });

    (document.body || document.documentElement).appendChild(input);
    if (!requestIsolatedOverlayForFileInput(input)) {
        input.remove();
        return false;
    }

    return true;
}

function openOverlayForFilePicker(options, fallback) {
    if (pendingPickerlessFiles) {
        const files = pendingPickerlessFiles;
        clearPendingPickerlessFiles();
        return Promise.resolve(files.map(fileSystemHandleForFile));
    }

    if (navigator.userActivation && !navigator.userActivation.isActive)
        return fallback.call(window, options);

    return new Promise((resolve, reject) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = filePickerAcceptFromOptions(options);
        input.multiple = !!(options && options.multiple);
        input.dataset.cnpPickerProxy = 'true';
        input.style.display = 'none';

        const cleanup = () => input.remove();
        input.addEventListener('change', () => {
            const files = [...input.files];
            cleanup();
            resolve(files.map(fileSystemHandleForFile));
        }, { once: true });
        input.addEventListener('cnp-overlay-cancelled', () => {
            cleanup();
            reject(new DOMException('The user aborted a request.', 'AbortError'));
        }, { once: true });

        (document.body || document.documentElement).appendChild(input);
        if (!requestIsolatedOverlayForFileInput(input)) {
            cleanup();
            fallback.call(window, options).then(resolve, reject);
        }
    });
}

function preventNativeFileActivation(event) {
    if (!isPageWorld || !event.isTrusted)
        return;

    const fileInput = findActivatedFileInput(event);
    if (!fileInput || !requestIsolatedOverlayForFileInput(fileInput))
        return;

    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === 'function')
        event.stopImmediatePropagation();
}

function preventPickerlessUploadActivation(event) {
    if (!isPageWorld || !event.isTrusted)
        return;

    const control = findPickerlessUploadControl(event);
    if (!control || !openOverlayForDropUpload(control))
        return;

    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === 'function')
        event.stopImmediatePropagation();
}

if (isPageWorld && !document.cnpPageFileActivationListener) {
    document.cnpPageFileActivationListener = true;
    document.addEventListener('click', preventNativeFileActivation, true);
    document.addEventListener('click', preventPickerlessUploadActivation, true);
}

if (isPageWorld && typeof window.showOpenFilePicker === 'function' && !window.cnpShowOpenFilePicker) {
    window.cnpShowOpenFilePicker = true;
    var oriShowOpenFilePicker = window.showOpenFilePicker;
    window.showOpenFilePicker = mirrorNativeFunction({
        showOpenFilePicker(options) {
            return openOverlayForFilePicker(options, oriShowOpenFilePicker);
        }
    }.showOpenFilePicker, oriShowOpenFilePicker);
}

function openOverlayForFileInput(input) {
    setupcreateOverlay(input);
    createOverlay({
        target: input,
        preventDefault: () => { },
        stopPropagation: () => { }
    });
}

// Detect and override input elements that uses .click()
var oriClick = HTMLElement.prototype.click;
HTMLElement.prototype.click = mirrorNativeFunction({
    click(...args) {
        if (isCnPFileInput(this)) {
            if (isPageWorld) {
                if (fulfillPendingPickerlessInput(this))
                    return;

                if (requestIsolatedOverlayForFileInput(this))
                    return;

                return oriClick.apply(this, args);
            }

            openOverlayForFileInput(this);
            return;
        } else
            return oriClick.apply(this, args);
    }
}.click, oriClick);

var oriInputClick = HTMLInputElement.prototype.click;
HTMLInputElement.prototype.click = mirrorNativeFunction({
    click(...args) {
        if (isCnPFileInput(this)) {
            if (isPageWorld) {
                if (fulfillPendingPickerlessInput(this))
                    return;

                if (requestIsolatedOverlayForFileInput(this))
                    return;

                if (typeof oriInputClick === 'function')
                    return oriInputClick.apply(this, args);

                return oriClick.apply(this, args);
            }

            openOverlayForFileInput(this);
            return;
        } else if (typeof oriInputClick === 'function')
            return oriInputClick.apply(this, args);
        else
            return oriClick.apply(this, args);
    }
}.click, oriInputClick || oriClick);

// Detect and override input elements that uses .showPicker()
var oriShowPicker = HTMLInputElement.prototype.showPicker;
HTMLInputElement.prototype.showPicker = mirrorNativeFunction({
    showPicker(...args) {
        if (isCnPFileInput(this)) {
            if (isPageWorld) {
                if (fulfillPendingPickerlessInput(this))
                    return;

                if (requestIsolatedOverlayForFileInput(this))
                    return;

                if (typeof oriShowPicker === 'function')
                    return oriShowPicker.apply(this, args);

                return oriClick.apply(this, args);
            }

            openOverlayForFileInput(this);
        } else if (typeof oriShowPicker === 'function')
            return oriShowPicker.apply(this, args);
        else
            return oriClick.apply(this, args);
    }
}.showPicker, oriShowPicker || oriClick);

// Global variables
var clientX = 0;
var clientY = 0;
var overlayID = null;
var ctrlVdata = null;
var currentObjectURL = null;
var reader = null; //Paste event listener's
var isFirefox = typeof InstallTrigger !== 'undefined';
var isChrome = !!window.chrome && (!!window.chrome.webstore || !!window.chrome.runtime);

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
        node.addEventListener("click", createOverlay);
        node.dataset.cnpCreateListener = "true";
    }
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

            originalInput.files = fileList.files;
            triggerChangeEvent(originalInput);
            closeOverlay();
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
        imagePreview.style.height = '50%';
        imagePreview.src = safeGetURL(`media/${fileTypeIcon}.webp`);
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

function usableClipboardFiles(files) {
    return [...files].filter(file => !(file.size === 0 && file.type === ''));
}

function clipboardFileName(file) {
    if (file.name && file.name !== 'image.png')
        return file.name;

    const extension = file.type && file.type.includes('/') ? file.type.split('/').pop() : 'bin';
    return 'CnP_' + new Date().toLocaleString('en-GB', { hour12: false }).replace(/, /g, '_').replace(/[\/: ]/g, '') + '.' + extension;
}

async function readClipboardFiles() {
    if (!navigator.clipboard || typeof navigator.clipboard.read !== 'function')
        return [];

    const clipboardItems = await navigator.clipboard.read();
    const files = [];
    for (const item of clipboardItems) {
        for (const type of item.types || []) {
            if (type === 'text/plain' || type === 'text/html')
                continue;

            const blob = await item.getType(type);
            if (blob && !(blob.size === 0 && blob.type === ''))
                files.push(new File([blob], clipboardFileName(blob), { type: blob.type, lastModified: Date.now() }));
        }
    }
    return files;
}

async function renderClipboardFiles(files, overlay, overlayFileInput) {
    const clipboardFiles = usableClipboardFiles(files);
    if (clipboardFiles.length == 0) {
        noImage();
        return false;
    }

    ctrlVdata = { files: clipboardFiles };

    const statusMap = new Map();
    statusMap.set('success', 0);
    statusMap.set('fail', 0);

    const processFiles = file => {
        return new Promise(resolve => {
            reader = new FileReader();
            reader.onload = readerEvent => {
                let webCopiedImgSrc = '';
                previewImage(webCopiedImgSrc, readerEvent, file, overlay.id);
                statusMap.set('success', statusMap.get('success') + 1);
                resolve();
            };
            reader.onerror = () => {
                statusMap.set('fail', statusMap.get('fail') + 1);
                resolve();
            };
            reader.onabort = () => { return };
            reader.readAsArrayBuffer(file);
        });
    };

    const fileList = new DataTransfer();
    [...originalInput.files].forEach(file => fileList.items.add(file));

    const badge = overlay.querySelector('.cnp-preview-badge');
    var isFirstFile = true;
    const readPromises = clipboardFiles.map(file => {
        const filename = clipboardFileName(file);

        badge.title += filename + '\n';
        badge.innerText = parseInt(badge.innerText) + 1;
        if (parseInt(badge.innerText) > 1)
            badge.style.display = 'inline-block';

        const renamedFile = new File([file], filename, { type: file.type, lastModified: file.lastModified });
        fileList.items.add(renamedFile);

        if (isFirstFile) {
            isFirstFile = false;
            return processFiles(renamedFile);
        }
    });
    await Promise.all(readPromises);

    if (statusMap.get('fail') >= 1 && statusMap.get('success') <= 0) {
        noImage();
        return false;
    }

    const imagePreviewContainer = overlay.querySelector('#cnp-preview-container');
    imagePreviewContainer.style.cursor = 'pointer';
    imagePreviewContainer.onclick = () => {
        originalInput.files = fileList.files;
        triggerChangeEvent(originalInput);
        closeOverlay();
    };
    return true;
}

function ensureOverlayStyles() {
    if (document.getElementById('cnp-overlay-style'))
        return;

    const style = document.createElement('style');
    style.id = 'cnp-overlay-style';
    style.textContent = `
        .cnp-overlay-content {
            all: initial;
            font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", "Noto Sans", "Liberation Sans", Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji";
            font-size: medium;
            position: absolute;
            transform: translate(-50%, -50%);
            background-color: rgba(240, 240, 240, .75);
            backdrop-filter: blur(15px);
            border: 1px solid #bebebe;
            border-radius: 8px;
            box-shadow: 0px 10px 15px rgba(0, 0, 0, 0.35), 0 0 6px rgba(0, 0, 0, 0);
            text-align: center;
            color: #212529;
            -webkit-user-select: none;
            -moz-user-select: none;
            -ms-user-select: none;
            user-select: none;
            line-height: 1.25;
            z-index: 2147483647;
        }

        .cnp-overlay-content * {
            font-family: inherit !important;
            font-size: inherit !important;
            line-height: 1.25 !important;
        }

        .cnp-hr {
            width: 100%;
            height: 0px;
            margin: 7px 0;
            color: inherit;
            opacity: .25;
            border: 0;
            border-top: .5px solid;
            padding: 0;
        }

        #cnp-drop-text {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            font-weight: normal;
            background-color: rgb(100, 100, 100);
            color: white;
            display: none;
            justify-content: center;
            align-items: center;
            border: 2px dashed #ffffff;
            border-radius: 8px;
            pointer-events: none;
            box-sizing: border-box;
            z-index: 1;
        }

        #cnp-drop-text svg {
            margin-right: 7px;
        }

        .cnp-preview-badge {
            display: none;
            line-height: 0.85;
            word-break: normal;
            position: absolute;
            top: 4%;
            left: 98%;
            transform: translate(-50%, -50%);
            background-color: rgba(240, 240, 240);
            backdrop-filter: blur(15px);
            border: 1px solid #bebebe;
            color: #212529;
            font-size: 1.1em;
            font-weight: 400;
            padding: 0.3em 0.5em;
            text-align: center;
            border-radius: 8px;
        }

        #cnp-preview-container {
            width: 272px;
            height: 153px;
            margin-top: 7px;
            display: flex;
            align-items: center;
            justify-content: center;
            flex-direction: column;
        }

        #cnp-preview-container:hover {
            background-color: rgba(0, 0, 0, .1);
            filter: brightness(.9);
        }

        #cnp-image-preview {
            position: relative;
            max-width: 100%;
            max-height: 100%;
            object-fit: cover;
            pointer-events: none;
            border: 0;
            margin: 0;
        }

        #cnp-image-title {
            pointer-events: none;
            font-size: 14px;
            font-weight: normal;
        }

        #cnp-not-image {
            font-weight: lighter;
        }

        #cnp-overlay-file-input {
            display: none;
        }

        #cnp-upload {
            font-weight: normal;
        }

        #cnp-upload svg {
            display: inline;
        }

        .cnp-menu-item {
            cursor: default;
            margin-bottom: 7px;
            padding: 6px;
        }

        .cnp-menu-item:hover {
            background-color: rgba(0, 0, 0, .1);
        }

        .cnp-bi {
            vertical-align: -.125em;
        }

        .cnp-spinner {
            display: block;
            position: absolute;
            border: 8px solid #e0e0e0;
            border-radius: 100%;
            border-top: 8px solid #00000000;
            width: 60px;
            height: 60px;
            -webkit-animation: spin .85s linear infinite;
            animation: spin .85s linear infinite;
        }

        @-webkit-keyframes spin {
            0% { -webkit-transform: rotate(0deg); }
            100% { -webkit-transform: rotate(360deg); }
        }

        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }

        @media (prefers-color-scheme: dark) {
            .cnp-overlay-content {
                background-color: rgba(25, 25, 25, .85);
                border: 1px solid #444449;
                color: white;
                backdrop-filter: blur(50px);
            }

            #cnp-preview-container:hover {
                background-color: rgba(255, 255, 255, .1);
                filter: brightness(.9);
            }

            .cnp-menu-item:hover {
                background-color: rgba(255, 255, 255, .1);
            }

            .cnp-spinner {
                border-color: #505050;
                border-top-color: #00000000;
            }

            .cnp-preview-badge {
                background-color: rgb(57 57 57);
                backdrop-filter: blur(50px);
                border: 1px solid #444449;
                color: white;
            }
        }
    `;
    document.head.appendChild(style);
}

function appendPlusIcon(parent) {
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('xmlns', svgNS);
    svg.setAttribute('width', '16');
    svg.setAttribute('height', '16');
    svg.setAttribute('fill', 'currentColor');
    svg.setAttribute('class', 'cnp-bi bi-plus-lg');
    svg.setAttribute('viewBox', '0 0 16 16');

    const path = document.createElementNS(svgNS, 'path');
    path.setAttribute('fill-rule', 'evenodd');
    path.setAttribute('d', 'M8 2a.5.5 0 0 1 .5.5v5h5a.5.5 0 0 1 0 1h-5v5a.5.5 0 0 1-1 0v-5h-5a.5.5 0 0 1 0-1h5v-5A.5.5 0 0 1 8 2');

    svg.appendChild(path);
    parent.appendChild(svg);
}

function buildOverlayContent(overlay) {
    ensureOverlayStyles();

    const content = document.createElement('div');
    content.className = 'cnp-overlay-content';

    const dropText = document.createElement('span');
    dropText.id = 'cnp-drop-text';
    appendPlusIcon(dropText);
    dropText.appendChild(document.createTextNode('Drop files here'));
    content.appendChild(dropText);

    const previewContainer = document.createElement('div');
    previewContainer.id = 'cnp-preview-container';
    const spinner = document.createElement('div');
    spinner.className = 'cnp-spinner';
    previewContainer.appendChild(spinner);
    content.appendChild(previewContainer);

    const badge = document.createElement('span');
    badge.className = 'cnp-preview-badge';
    badge.textContent = '0';
    content.appendChild(badge);

    const divider = document.createElement('hr');
    divider.className = 'cnp-hr';
    content.appendChild(divider);

    const overlayFileInput = document.createElement('input');
    overlayFileInput.type = 'file';
    overlayFileInput.id = 'cnp-overlay-file-input';
    content.appendChild(overlayFileInput);

    const uploadBtn = document.createElement('div');
    uploadBtn.id = 'cnp-upload-btn';
    uploadBtn.className = 'cnp-menu-item';

    const upload = document.createElement('span');
    upload.id = 'cnp-upload';
    appendPlusIcon(upload);
    upload.appendChild(document.createTextNode(' '));

    const uploadText = document.createElement('span');
    uploadText.id = 'cnp-upload-text';
    uploadText.textContent = 'Upload File';
    upload.appendChild(uploadText);
    uploadBtn.appendChild(upload);
    content.appendChild(uploadBtn);

    overlay.appendChild(content);
    return content;
}

// When prepped input elements are clicked
function createOverlay(event) {
    // Check if overlay is already visible for this input
    const existingOverlay = document.querySelector('.cnp-overlay');

    // If overlay exists, this is a second click - bypass extension and allow native behavior
    if (existingOverlay) {
        // Remove the overlay
        closeOverlay();
        // Don't prevent default - let the native file picker open
        return;
    }

    // First click - prevent default and show overlay
    event.preventDefault();
    event.stopPropagation();
    originalInput = event.target;

    // Create overlay
    const overlay = document.createElement('div');
    overlay.classList.add('cnp-overlay');
    overlay.dataset.cnpIgnoreCloseUntil = String(Date.now() + 250);

    // Unique ID for each created overlay
    const hexArray = Array.from(crypto.getRandomValues(new Uint8Array(16))).map(byte => byte.toString(16).padStart(2, '0'));
    const uuid = [hexArray.slice(0, 4).join(''), hexArray.slice(4, 6).join(''), '4' + hexArray.slice(6, 7).join(''), (parseInt(hexArray[8], 16) & 0x3 | 0x8).toString(16) + hexArray.slice(9, 11).join(''), hexArray.slice(11, 16).join('')].join('-');
    overlay.id = overlayID = uuid;

    try {
        // Prevents duplicate overlay setup
        if (document.querySelector('.cnp-overlay'))
            return;

        buildOverlayContent(overlay);

                        document.body.appendChild(overlay);
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

                        let overlayLeftPos = clientX + window.scrollX + (overlayContent.offsetWidth / 2);
                        let overlayBottomPos = clientY + window.scrollY + (overlayContent.offsetHeight / 2);

                        // Flip if overlay overshoots
                        const tooMuchRight = overlayLeftPos + (overlayContent.offsetWidth / 2);
                        const tooMuchBottom = overlayBottomPos + (overlayContent.offsetHeight / 2);

                        if (tooMuchRight >= innerWidth)
                            overlayLeftPos -= overlayContent.offsetWidth;
                        if (tooMuchBottom >= innerHeight)
                            overlayBottomPos -= overlayContent.offsetHeight;

                        overlayContent.style.left = overlayLeftPos + 'px';
                        overlayContent.style.top = overlayBottomPos + 'px';

                        // Follow attributes of original input element
                        const overlayFileInput = overlay.querySelector('#cnp-overlay-file-input');
                        overlayFileInput.multiple = originalInput.multiple;
                        overlayFileInput.webkitdirectory = originalInput.webkitdirectory;

                        if (overlayFileInput.multiple)
                            overlay.querySelector('#cnp-upload-text').textContent = "Upload Files";

                        // Overlay handle file input
                        overlayFileInput.setAttribute('accept', originalInput.getAttribute('accept'));
                        overlayFileInput.oncancel = () => closeOverlay();
                        overlayFileInput.onchange = event => {
                            const fileList = new DataTransfer();
                            // Reattach previous files and append new ones
                            [...originalInput.files, ...event.target.files].forEach(file => fileList.items.add(file));
                            originalInput.files = fileList.files;
                            triggerChangeEvent(originalInput);
                            closeOverlay();
                        }

                        // Overlay upload click listener
                        const uploadBtn = overlay.querySelector('#cnp-upload-btn');
                        overlayFileInput.focus({ preventScroll: true });
                        uploadBtn.onclick = () => overlayFileInput.click();

                        // Close overlay when clicked outside
                        if (!document.cnpRemoveListener)
                            document.addEventListener('click', event => {
                                document.cnpRemoveListener = true;
                                document.querySelectorAll('.cnp-overlay-content').forEach(overlayContent => {
                                    const overlay = overlayContent.closest('.cnp-overlay');
                                    if (overlay && Date.now() < Number(overlay.dataset.cnpIgnoreCloseUntil || 0))
                                        return;

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
                            const fileList = new DataTransfer();
                            // Reattach previous files and append new ones
                            const excludedFolders = [...event.dataTransfer.files].filter(file => !(file.size === 0 && file.type === ''));
                            [...originalInput.files, ...excludedFolders].forEach(file => fileList.items.add(file));
                            originalInput.files = fileList.files;
                            triggerChangeEvent(originalInput);
                            closeOverlay();
                        };

                        // Handle Ctrl+V action
                        document.addEventListener('keydown', ctrlV);

                        var isClipboardPreviewResolved = false;
                        const finishClipboardPreview = () => isClipboardPreviewResolved = true;
                        const fallbackNoImageTimer = setTimeout(() => {
                            if (!isClipboardPreviewResolved && document.getElementById(overlay.id)) {
                                finishClipboardPreview();
                                noImage();
                            }
                        }, 800);

                        // Handle paste event
                        document.addEventListener('paste', async event => {
                            event.stopPropagation();
                            event.preventDefault();

                            if (isClipboardPreviewResolved || !overlayFileInput)
                                return;

                            const dataTransfer = event.clipboardData;
                            ctrlVdata = cloneEvent(event.clipboardData);
                            finishClipboardPreview();
                            clearTimeout(fallbackNoImageTimer);
                            await renderClipboardFiles(dataTransfer.files, overlay, overlayFileInput);
                        }, { once: true, capture: true });

                        // Trigger paste event
                        overlay.contentEditable = true;
                        overlay.focus({ preventScroll: true });
                        document.execCommand('paste');
                        overlay.contentEditable = false;

                        setTimeout(async () => {
                            const files = await readClipboardFiles().catch(() => []);
                            if (isClipboardPreviewResolved || files.length == 0)
                                return;

                            finishClipboardPreview();
                            clearTimeout(fallbackNoImageTimer);
                            await renderClipboardFiles(files, overlay, overlayFileInput);
                        }, 50);
    } catch (error) { logging(error) }
}


// Preview 'No image' message
function noImage() {
    const CNP_notImage = document.createElement('span');
    CNP_notImage.id = 'cnp-not-image';
    CNP_notImage.textContent = 'Screenshot / Copy / Drop files';

    const overlay = document.querySelector('.cnp-overlay');
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
    if (originalInput && originalInput.dataset && originalInput.dataset.cnpPickerProxy === 'true' && originalInput.files.length === 0)
        originalInput.dispatchEvent(new CustomEvent('cnp-overlay-cancelled'));

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
