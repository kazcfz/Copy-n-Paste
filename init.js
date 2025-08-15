/* 
Initializes global variables and functions.
*/

// Detect and override input elements that uses .click()
var oriClick = HTMLElement.prototype.click;
HTMLElement.prototype.click = function (...args) {
    if (this.matches("input[type='file']") && !this.id.toLowerCase().startsWith('cnp')) {
        setupcreateOverlay(this);
        oriClick.call(this, ...args);
    } else
        return oriClick.apply(this, arguments);
};

// Detect and override input elements that uses .showPicker()
var oriShowPicker = HTMLInputElement.prototype.showPicker;
HTMLInputElement.prototype.showPicker = function () {
    if (this.matches("input[type='file']"))
        this.click();
    else
        return oriShowPicker.apply(this, arguments);
};

// Global variables
var clientX = 0;
var clientY = 0;
var overlayID = null;
var ctrlVdata = null;
var currentObjectURL = null;
var reader = null; //Paste event listener's
var isFirefox = typeof InstallTrigger !== 'undefined';
var isChrome = !!window.chrome && (!!window.chrome.webstore || !!window.chrome.runtime);

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
        try {
            imagePreview.src = chrome.runtime.getURL(`media/${fileTypeIcon}.webp`);
        } catch {
            try {
                if (document.head.querySelector('script:is([id*="CnP-mutatedIframe"], [id*="CnP-iframe"])'))
                    window.top.postMessage({ 'Type': 'getURL', 'iframe': document.head.querySelector('script:is([id*="CnP-mutatedIframe"], [id*="CnP-iframe"])').getAttribute('id'), 'Path': `media/${fileTypeIcon}.webp` }, '*');
                else
                    window.top.postMessage({ 'Type': 'getURL', 'Path': `media/${fileTypeIcon}.webp` }, '*');

                window.onmessage = event => {
                    if (event.data.Type == 'getURL-response')
                        imagePreview.src = event.data.URL;
                }
            } catch (error) { logging(error) }
        }
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

// When prepped input elements are clicked
function createOverlay(event) {
    event.preventDefault();
    originalInput = event.target;

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
            var urlToFetch = null;
            if (document.head.querySelector('script[overlayhtml]')) {
                urlToFetch = document.head.querySelector('script[overlayhtml]').getAttribute('overlayhtml');
                resolve(urlToFetch);
            }
            else if (!urlToFetch && typeof chrome.runtime !== 'undefined')
                try {
                    urlToFetch = chrome.runtime.getURL('overlay.html');
                    resolve(urlToFetch);
                }
                catch {
                    if (document.head.querySelector('script:is([id*="CnP-mutatedIframe"], [id*="CnP-iframe"])'))
                        window.top.postMessage({ 'Type': 'getURL', 'iframe': document.head.querySelector('script:is([id*="CnP-mutatedIframe"], [id*="CnP-iframe"])').getAttribute('id'), 'Path': 'overlay.html' }, '*');
                    else
                        window.top.postMessage({ 'Type': 'getURL', 'Path': 'overlay.html' }, '*');
                    window.onmessage = event => {
                        if (event.data.Type == 'getURL-response') {
                            urlToFetch = event.data.URL;
                            resolve(urlToFetch);
                        }
                    }
                }
            else if (document.head.querySelector('copy-n-paste'))
                try {
                    urlToFetch = document.head.querySelector('copy-n-paste').getAttribute('overlay-html');
                    resolve(urlToFetch);
                } catch (error) { logging(error) }
            else
                resolve(urlToFetch);
        });
    }

    try {
        fetchURL().then(urlToFetch => {
            if (urlToFetch) {
                fetch(urlToFetch)
                    .then(response => response.text())
                    .then(html => {
                        // Prevents duplicate overlay setup
                        if (document.querySelector('.cnp-overlay'))
                            return;

                        // Checks browser type to either use trustedTypes or not (Google Slides requirement)
                        if (isFirefox)
                            overlay.innerHTML = html;
                        else
                            overlay.innerHTML = trustedTypes.createPolicy("forceInner", { createHTML: (to_escape) => to_escape }).createHTML(html);

                        // Fix: prevent Firefox from scrolling to the overlay
                        overlay.style.position = 'fixed';
                        overlay.style.top = 0;
                        overlay.style.left = 0;

                        document.body.appendChild(overlay);

                        // Position overlay to cursor coord
                        const overlayContent = overlay.querySelector('.cnp-overlay-content');
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

                        // Handle paste event
                        var isPasteListenerTriggered = false;
                        document.addEventListener('paste', async event => {
                            isPasteListenerTriggered = true;
                            event.stopPropagation();
                            event.preventDefault();

                            const statusMap = new Map();
                            statusMap.set('success', 0);
                            statusMap.set('fail', 0);
                            if (overlayFileInput) {
                                // Access clipboard to display latest copied files to overlay
                                const dataTransfer = event.clipboardData;
                                if (dataTransfer.files.length > 0) {
                                    ctrlVdata = cloneEvent(event.clipboardData); // Separate paste listener using Ctrl+V

                                    // Function to handle the FileReader asynchronously
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

                                    // Reattach previous files for multi-file (continues in imagePreviewContainer.onclick below)
                                    const fileList = new DataTransfer();
                                    [...originalInput.files].forEach(file => fileList.items.add(file));

                                    // Array of promises to process each file
                                    const excludedFolders = [...dataTransfer.files].filter(file => !(file.size === 0 && file.type === ''));
                                    if (excludedFolders.length == 0) {
                                        noImage();
                                        return;
                                    }
                                    else {
                                        const badge = document.querySelector('.cnp-preview-badge');
                                        var isFirstFile = true;
                                        const readPromises = [...dataTransfer.files]
                                            .filter(file => !(file.size === 0 && file.type === ''))
                                            .map(file => {
                                                let filename = file.name;
                                                if (!filename || filename == 'image.png')
                                                    filename = 'CnP_' + new Date().toLocaleString('en-GB', { hour12: false }).replace(/, /g, '_').replace(/[\/: ]/g, '') + '.' + file.type.split('/').pop();

                                                // Badge counter setup
                                                badge.title += filename + '\n';
                                                badge.innerText = parseInt(badge.innerText) + 1;
                                                if (parseInt(badge.innerText) > 1)
                                                    badge.style.display = 'inline-block';

                                                fileList.items.add(new File([file], filename, { type: file.type, lastModified: file.lastModified }));

                                                if (isFirstFile) {
                                                    isFirstFile = false;
                                                    return processFiles(file);
                                                }
                                            });
                                        await Promise.all(readPromises);
                                    }

                                    if (statusMap.get('fail') >= 1 && statusMap.get('success') <= 0)
                                        noImage();
                                    else {
                                        const imagePreviewContainer = document.querySelector('#cnp-preview-container');
                                        imagePreviewContainer.style.cursor = 'pointer';
                                        imagePreviewContainer.onclick = () => {
                                            originalInput.files = fileList.files;
                                            triggerChangeEvent(originalInput);
                                            closeOverlay();
                                        };
                                    }
                                } else
                                    noImage();
                            }
                        }, { once: true, capture: true });

                        // Trigger paste event
                        overlay.contentEditable = true;
                        overlay.focus();
                        document.execCommand('paste');
                        if (!isPasteListenerTriggered)
                            window.top.postMessage({ 'Type': 'paste' }, '*');
                        isPasteListenerTriggered = false;
                        overlay.contentEditable = false;

                        // Trigger paste event for iframe
                        if (document.head.querySelector('script:is([id*="CnP-mutatedIframe"], [id*="CnP-iframe"])'))
                            window.top.postMessage({ 'Type': 'paste', 'iframe': document.head.querySelector('script:is([id*="CnP-mutatedIframe"], [id*="CnP-iframe"])').getAttribute('id') }, '*');
                    });
            }
        });
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
    document.querySelectorAll('.cnp-overlay').forEach(overlay => overlay.remove());
    document.removeEventListener('keydown', ctrlV);
    URL.revokeObjectURL(currentObjectURL);
    if (reader != null)
        reader.abort();
}

// Console logging for errors and messages
function logging(message) {
    console.log('%c📋 Copy-n-Paste:\n', 'font-weight: bold; font-size: 1.3em;', message);
    window.top.postMessage(('%c📋 Copy-n-Paste:\n', 'font-weight: bold; font-size: 1.3em;', message), '*');
}
