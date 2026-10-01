/*
Isolated world, document_start, every frame. Runs before any page script, so the listeners below
are always first in line.

1. Detect: a native file picker only opens from a click on <input type=file> (seen here through
   composedPath(), including closed shadow roots) or from .click()/.showPicker() on an input that
   never fires a visible event (forwarded by page.js). Inputs don't need to exist beforehand.
2. Read: execCommand('paste') after a real user activation. The paste event is swallowed before
   the page can see it, and the page never sees focus move, so popups that close on blur stay open.
3. Show: the preview lives in a closed shadow root in the top layer; the page can't read or restyle it.
4. Attach: files reach the page only when the user clicks the preview, presses Ctrl+V or drops files.
*/
(() => {
    'use strict';

    const ARM_DELAY = 500; // ms before confirming is allowed; stops double-clicks and click-jacking races
    const OVERLAY_SIZE = { width: 274, height: 216 };
    const MIN_SCALE = 0.5; // the overlay shrinks to fit small frames; below half size the native picker is kept

    const CSS = `
        :host {
            all: initial !important;
            display: block !important;
            position: fixed !important;
            inset: 0 !important;
            width: auto !important;
            height: auto !important;
            max-width: none !important;
            max-height: none !important;
            margin: 0 !important;
            padding: 0 !important;
            border: 0 !important;
            background: none !important;
            overflow: visible !important;
            opacity: 1 !important;
            visibility: visible !important;
            transform: none !important;
            filter: none !important;
            clip-path: none !important;
            mask: none !important;
            pointer-events: none !important;
            z-index: 2147483647 !important;
        }
        :host::before, :host::after { content: none !important; display: none !important; }

        .cnp-overlay-content {
            font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", "Noto Sans", "Liberation Sans", Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji";
            font-size: medium;
            position: absolute;
            pointer-events: auto;
            background-color: rgba(240, 240, 240, .75);
            backdrop-filter: blur(15px);
            border: 1px solid #bebebe;
            border-radius: 8px;
            box-shadow: 0px 10px 15px rgba(0, 0, 0, 0.35), 0 0 6px rgba(0, 0, 0, 0);
            text-align: center;
            color: #212529;
            user-select: none;
            line-height: 1.25;
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
        #cnp-drop-text.cnp-visible { display: flex; }
        #cnp-drop-text svg { margin-right: 7px; }

        .cnp-preview-badge {
            display: none;
            line-height: 0.85;
            position: absolute;
            top: 4%;
            left: 98%;
            transform: translate(-50%, -50%);
            background-color: rgba(240, 240, 240);
            backdrop-filter: blur(15px);
            border: 1px solid #bebebe;
            color: #212529;
            padding: 0.3em 0.5em;
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
        #cnp-preview-container.cnp-has-files:hover {
            background-color: rgba(0, 0, 0, .1);
            filter: brightness(.9);
        }

        #cnp-image-preview {
            position: relative;
            max-width: 100%;
            max-height: 100%;
            object-fit: cover;
            pointer-events: none;
        }

        .cnp-file-icon {
            height: 50%;
            color: #8a8a8a;
            pointer-events: none;
        }

        #cnp-image-title { pointer-events: none; }

        #cnp-not-image { font-weight: lighter; }

        #cnp-paste-target {
            position: absolute;
            top: 0;
            left: 0;
            width: 1px;
            height: 1px;
            overflow: hidden;
            opacity: 0;
            pointer-events: none;
        }

        .cnp-menu-item {
            cursor: default;
            margin-bottom: 7px;
            padding: 6px;
        }
        .cnp-menu-item:hover { background-color: rgba(0, 0, 0, .1); }

        .cnp-bi { vertical-align: -.125em; }

        .cnp-spinner {
            display: block;
            position: absolute;
            border: 8px solid #e0e0e0;
            border-radius: 100%;
            border-top: 8px solid #00000000;
            width: 60px;
            height: 60px;
            animation: cnp-spin .85s linear infinite;
        }
        @keyframes cnp-spin {
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
            #cnp-preview-container.cnp-has-files:hover {
                background-color: rgba(255, 255, 255, .1);
                filter: brightness(.9);
            }
            .cnp-menu-item:hover { background-color: rgba(255, 255, 255, .1); }
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
            .cnp-file-icon { color: #bdbdbd; }
        }
    `;

    // 16x16 icons: plus is filled, file icons are stroked
    const PLUS_ICON = ['M8 2a.5.5 0 0 1 .5.5v5h5a.5.5 0 0 1 0 1h-5v5a.5.5 0 0 1-1 0v-5h-5a.5.5 0 0 1 0-1h5v-5A.5.5 0 0 1 8 2'];
    const FILE_OUTLINE = ['M4 .5h5.8l3.7 3.7V14a1.5 1.5 0 0 1-1.5 1.5H4A1.5 1.5 0 0 1 2.5 14V2A1.5 1.5 0 0 1 4 .5z', 'M9.8.5v2.7a1 1 0 0 0 1 1h2.7'];
    const FILE_ICONS = {
        blank_file: FILE_OUTLINE,
        text_file: [...FILE_OUTLINE, 'M5 7.5h6', 'M5 9.5h6', 'M5 11.5h3.5'],
        audio_file: [...FILE_OUTLINE, 'M9.5 11.6V6.6l2-.6v1.6l-2 .6', 'M9.5 11.6a1.4 1.1 0 1 1-2.8 0a1.4 1.1 0 1 1 2.8 0z'],
    };

    let ui = null;          // the open overlay, see openOverlay()
    let pasteSink = null;   // receives clipboardData while we read the clipboard
    let hidingFocus = false; // while true, the page doesn't see focus moving to our paste target
    let bypass = null;      // input whose next click must reach the native picker
    const pointer = { x: -1, y: -1 };

    const openOrClosedShadowRoot = globalThis.chrome?.dom?.openOrClosedShadowRoot
        ? el => chrome.dom.openOrClosedShadowRoot(el)
        : el => el.openOrClosedShadowRoot;
    const isFileInput = el => el?.localName === 'input' && el.type === 'file';

    // Events on the overlay never reach the page, so "click outside" / blur handlers of the page's own
    // popups don't fire and tear down the input we're about to fill
    const FIREWALLED = ['pointerdown', 'pointerup', 'pointermove', 'pointerover', 'pointerout', 'pointerenter', 'pointerleave', 'pointercancel',
        'mousedown', 'mouseup', 'mousemove', 'mouseover', 'mouseout', 'mouseenter', 'mouseleave', 'click', 'dblclick', 'auxclick', 'contextmenu',
        'touchstart', 'touchmove', 'touchend', 'touchcancel', 'wheel', 'dragstart', 'dragenter', 'dragover', 'dragleave', 'drop', 'beforetoggle', 'toggle'];

    addEventListener('paste', onPaste, true);
    for (const type of ['focus', 'blur', 'focusin', 'focusout'])
        addEventListener(type, event => hidingFocus && event.stopImmediatePropagation(), true);
    for (const type of FIREWALLED)
        addEventListener(type, onOverlayEvent, true);
    addEventListener('click', onActivation, true);
    addEventListener('cnp-picker', onActivation, true);
    addEventListener('keydown', onKeyDown, true);
    addEventListener('pointerdown', trackPointer, true);
    addEventListener('pointermove', trackPointer, true);

    function trackPointer(event) {
        if (event.isTrusted) {
            pointer.x = event.clientX;
            pointer.y = event.clientY;
        }
    }

    // A click on (or picker request for) a file input
    function onActivation(event) {
        if (ui) {
            // Clicking anywhere else closes the overlay; clicking a file input again opens the native picker
            closeOverlay();
            return;
        }
        const input = fileInputFrom(event);
        if (!input || input === bypass || input.disabled || input.webkitdirectory || event.defaultPrevented)
            return;
        // Same rule the browser applies to the native picker
        if (!navigator.userActivation.isActive)
            return;
        if (innerWidth < OVERLAY_SIZE.width * MIN_SCALE || innerHeight < OVERLAY_SIZE.height * MIN_SCALE)
            return;
        event.preventDefault();
        openOverlay(input);
    }

    function fileInputFrom(event) {
        // page.js passes detached inputs as relatedTarget
        if (isFileInput(event.relatedTarget))
            return event.relatedTarget;
        const target = event.composedPath()[0];
        if (isFileInput(target))
            return target;
        // A closed shadow root hides the real target from window; look again when the event reaches that root
        const root = target instanceof HTMLElement && !target.shadowRoot && openOrClosedShadowRoot(target);
        if (root)
            root.addEventListener(event.type, onActivation, { capture: true, once: true });
        return null;
    }

    function onPaste(event) {
        if (!pasteSink)
            return;
        event.stopImmediatePropagation();
        event.preventDefault();
        pasteSink(event.clipboardData);
    }

    // Synchronous: execCommand dispatches the paste event before returning
    function readClipboardFiles() {
        let files = null;
        pasteSink = data => { files = usableFiles(data); };
        try {
            document.execCommand('paste');
            // Firefox refuses while focus is outside an editable element on pages that have one (rich-text editors)
            if (!files)
                pasteWithOwnFocus();
        } finally {
            pasteSink = null;
        }
        return files || [];
    }

    // Focus our hidden editable for the duration of the paste, then put focus and selection back.
    // All synchronous, and the page's focus listeners are skipped, so the page can't notice.
    function pasteWithOwnFocus() {
        let previous = document.activeElement;
        while (previous instanceof HTMLElement && openOrClosedShadowRoot(previous)?.activeElement)
            previous = openOrClosedShadowRoot(previous).activeElement;
        const selection = getSelection();
        const ranges = [...Array(selection.rangeCount)].map((_, index) => selection.getRangeAt(index));
        hidingFocus = true;
        try {
            ui.pasteTarget.focus({ preventScroll: true });
            document.execCommand('paste');
        } finally {
            if (previous && previous !== document.body)
                previous.focus({ preventScroll: true });
            else
                ui.pasteTarget.blur();
            selection.removeAllRanges();
            ranges.forEach(range => selection.addRange(range));
            hidingFocus = false;
        }
    }

    // Only readable during the paste/drop event that provided `data`
    function usableFiles(data) {
        return [...data.items]
            .filter(item => item.kind === 'file')
            // Folders can't be uploaded. Chromium reports their size on disk on macOS/Linux, so size 0 only catches Windows
            .filter(item => !item.webkitGetAsEntry()?.isDirectory)
            .map(item => item.getAsFile())
            .filter(file => file && !(file.size === 0 && file.type === ''))
            .map(file => file.name && file.name !== 'image.png' ? file :
                new File([file], `CnP_${timestamp()}.${file.type.split('/').pop()}`, { type: file.type, lastModified: file.lastModified }));
    }

    function timestamp() {
        return new Date().toLocaleString('en-GB', { hour12: false }).replace(/, /g, '_').replace(/[\/: ]/g, '');
    }

    function onKeyDown(event) {
        if (!ui || !event.isTrusted || !armed())
            return;
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v') {
            // Fresh read, so a screenshot taken while the overlay is open is used
            const files = readClipboardFiles();
            // Without files, let the keystroke paste normally into the page
            if (files.length) {
                event.preventDefault();
                event.stopImmediatePropagation();
                attach(files);
            }
        }
    }

    function onOverlayEvent(event) {
        if (!ui)
            return;
        const onOverlay = event.target === ui.host;
        const leavingToOverlay = event.relatedTarget === ui.host && /^(pointer|mouse)(out|leave)$/.test(event.type);
        if (!onOverlay && !leavingToOverlay)
            return;
        event.stopImmediatePropagation();
        if (!onOverlay || !event.isTrusted)
            return;

        switch (event.type) {
            case 'mousedown': // keeps focus (and any popup that depends on it) where it is
            case 'dragstart':
                event.preventDefault();
                break;
            case 'click':
                if (isInside(ui.uploadButton, event))
                    openNativePicker();
                else if (isInside(ui.preview, event) && ui.files.length && armed())
                    attach(ui.files);
                break;
            case 'dragenter':
            case 'dragover':
                event.preventDefault();
                ui.dropText.classList.add('cnp-visible');
                break;
            case 'dragleave':
                if (event.relatedTarget !== ui.host)
                    ui.dropText.classList.remove('cnp-visible');
                break;
            case 'drop': {
                event.preventDefault();
                ui.dropText.classList.remove('cnp-visible');
                const files = usableFiles(event.dataTransfer);
                if (files.length)
                    attach(files);
                break;
            }
        }
    }

    // Our shadow root is closed, so events only tell us the host; locate the part by coordinates
    function isInside(element, event) {
        const rect = element.getBoundingClientRect();
        return event.clientX >= rect.left && event.clientX < rect.right && event.clientY >= rect.top && event.clientY < rect.bottom;
    }

    function armed() {
        return performance.now() - ui.openedAt >= ARM_DELAY;
    }

    function openOverlay(input) {
        const host = document.createElement('div');
        const root = host.attachShadow({ mode: 'closed' });
        const preview = el('div', { id: 'cnp-preview-container' }, el('div', { class: 'cnp-spinner' }));
        const badge = el('span', { class: 'cnp-preview-badge' });
        const dropText = el('span', { id: 'cnp-drop-text' }, icon(PLUS_ICON, 'cnp-bi'), 'Drop files here');
        const uploadButton = el('div', { id: 'cnp-upload-btn', class: 'cnp-menu-item' },
            el('span', { id: 'cnp-upload' }, icon(PLUS_ICON, 'cnp-bi'), ' ', el('span', { id: 'cnp-upload-text' }, input.multiple ? 'Upload Files' : 'Upload File')));
        const pasteTarget = el('div', { id: 'cnp-paste-target', contenteditable: 'true', tabindex: '-1' });
        const content = el('div', { class: 'cnp-overlay-content' }, dropText, preview, badge, el('hr', { class: 'cnp-hr' }), uploadButton, pasteTarget);
        root.append(el('style', {}, CSS), content);

        ui = { input, host, preview, dropText, uploadButton, pasteTarget, files: [], urls: [], openedAt: performance.now() };

        overlayContainer(input).append(host);
        // Top layer: above modal dialogs, fullscreen elements and any z-index
        try {
            host.popover = 'manual';
            host.showPopover();
        } catch { /* stays a max z-index fixed element */ }

        let { width, height } = content.getBoundingClientRect();
        const scale = Math.min(1, innerWidth / width, innerHeight / height);
        if (scale < 1) {
            content.style.transformOrigin = '0 0';
            content.style.transform = `scale(${scale})`;
            width *= scale;
            height *= scale;
        }
        let x = pointer.x, y = pointer.y;
        if (x < 0) {
            x = (innerWidth - width) / 2;
            y = (innerHeight - height) / 2;
        }
        if (x + width > innerWidth)
            x -= width;
        if (y + height > innerHeight)
            y -= height;
        content.style.left = Math.max(0, Math.min(x, innerWidth - width)) + 'px';
        content.style.top = Math.max(0, Math.min(y, innerHeight - height)) + 'px';

        const files = ui.files = readClipboardFiles();
        if (files.length) {
            badge.textContent = files.length;
            badge.title = files.map(file => file.name).join('\n');
            if (files.length > 1)
                badge.style.display = 'inline-block';
            preview.classList.add('cnp-has-files');
            showPreview(ui, files[0]);
        } else
            preview.replaceChildren(el('span', { id: 'cnp-not-image' }, 'Screenshot / Copy / Drop files'));
    }

    // Inside a modal dialog everything else is inert, so the overlay has to live in it
    function overlayContainer(input) {
        for (let node = input; node; node = node.parentNode || node.host)
            if (node.localName === 'dialog' && node.matches(':modal'))
                return node;
        const modals = document.querySelectorAll('dialog:modal');
        return modals[modals.length - 1] || document.documentElement;
    }

    // view: the overlay this preview belongs to; callbacks may fire after it was replaced
    function showPreview(view, file) {
        const [type, subtype] = file.type.split('/');
        if (type === 'image') {
            const img = el('img', { id: 'cnp-image-preview', draggable: 'false' });
            img.onload = () => {
                // Enlarge preview of smaller images
                if ((img.naturalWidth < 272 && img.naturalHeight < 153) || img.naturalHeight < 153 && img.naturalWidth <= img.naturalHeight) {
                    img.style.width = 'auto';
                    img.style.height = '100%';
                } else if (img.naturalWidth < 272 && img.naturalWidth > img.naturalHeight) {
                    img.style.width = '100%';
                    img.style.height = 'auto';
                }
                view.preview.querySelector('.cnp-spinner')?.remove();
            };
            img.onerror = () => showFileIcon(view, file, 'blank_file');
            img.src = objectURL(view, file);
            view.preview.append(img);
        } else if (type === 'video') {
            const video = el('video', { id: 'cnp-image-preview', preload: 'metadata' });
            video.onloadedmetadata = () => {
                if (video.videoWidth === 0 || video.videoHeight === 0)
                    return showFileIcon(view, file, 'audio_file');
                view.preview.replaceChildren(video);
            };
            video.onerror = () => showFileIcon(view, file, 'blank_file');
            video.src = objectURL(view, file);
        } else if (type === 'audio')
            showFileIcon(view, file, 'audio_file');
        else if (type === 'text')
            showFileIcon(view, file, 'text_file');
        // PDFs are no longer rendered in an iframe: the page can reach frames and read blob: URLs
        else
            showFileIcon(view, file, subtype === 'pdf' ? 'text_file' : 'blank_file');
    }

    function showFileIcon(view, file, iconName) {
        const dot = file.name.lastIndexOf('.');
        const extension = dot > 0 ? file.name.slice(dot) : '';
        let baseName = dot > 0 ? file.name.slice(0, dot) : file.name;
        if (file.name.length > 25)
            baseName = baseName.slice(0, 25).trimEnd() + '..';
        view.preview.replaceChildren(icon(FILE_ICONS[iconName], 'cnp-file-icon', true), el('span', { id: 'cnp-image-title' }, baseName + extension));
    }

    function objectURL(view, file) {
        const url = URL.createObjectURL(file);
        view.urls.push(url);
        return url;
    }

    function openNativePicker() {
        const { input } = ui;
        closeOverlay();
        bypass = input;
        try {
            input.click();
        } finally {
            bypass = null;
        }
    }

    function attach(files) {
        const { input } = ui;
        closeOverlay();
        const fileList = new DataTransfer();
        // Multi-file inputs keep what was already chosen, like picking more files would
        if (input.multiple)
            for (const file of input.files)
                fileList.items.add(file);
        for (const file of input.multiple ? files : files.slice(0, 1))
            fileList.items.add(file);
        input.files = fileList.files;
        input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function closeOverlay() {
        if (!ui)
            return;
        ui.host.remove();
        ui.urls.forEach(url => URL.revokeObjectURL(url));
        ui = null;
    }

    function el(tag, attributes, ...children) {
        const element = document.createElement(tag);
        for (const [name, value] of Object.entries(attributes))
            element.setAttribute(name, value);
        element.append(...children);
        return element;
    }

    function icon(paths, className, stroked) {
        const ns = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(ns, 'svg');
        svg.setAttribute('viewBox', '0 0 16 16');
        svg.setAttribute('class', className);
        if (stroked) {
            svg.setAttribute('fill', 'none');
            svg.setAttribute('stroke', 'currentColor');
            svg.setAttribute('stroke-width', '.6');
            svg.setAttribute('stroke-linecap', 'round');
            svg.setAttribute('stroke-linejoin', 'round');
        } else {
            svg.setAttribute('width', '16');
            svg.setAttribute('height', '16');
            svg.setAttribute('fill', 'currentColor');
        }
        for (const d of paths) {
            const path = document.createElementNS(ns, 'path');
            path.setAttribute('d', d);
            svg.append(path);
        }
        return svg;
    }
})();
