const { test, expect, chromium } = require('@playwright/test');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

async function writeClipboardImage(page) {
    await page.evaluate(async () => {
        const canvas = document.createElement('canvas');
        canvas.width = 1;
        canvas.height = 1;
        const context = canvas.getContext('2d');
        context.fillStyle = '#f00';
        context.fillRect(0, 0, 1, 1);
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    });
}

function startServer() {
    const pages = {
        '/': `<!doctype html>
            <html>
                <body>
                    <input id="plain" type="file">
                    <label id="label-upload" for="labeled">Label upload</label>
                    <input id="labeled" type="file" style="display:none">
                    <button id="proxy-upload">Proxy upload</button>
                    <button id="show-picker-upload">Show picker upload</button>
                    <button id="fs-picker-upload">File System Access upload</button>
                    <button id="drop-upload">Upload from computer</button>
                    <button id="display-mode" aria-label="Display Mode">Display Mode</button>
                    <button id="device-upload-button" type="button">Upload</button>
                    <button id="upload-from-desktop" type="button">Upload from desktop</button>
                    <button id="reddit-add-media" rpl="" class="add-media action invisible group-hover:visible">Add</button>
                    <button id="add-image" aria-label="Add image">Add image</button>
                    <button id="business-add-photo" aria-label="Add Photo">Add Photo</button>
                    <button id="add-photo-video">Add photo/video</button>
                    <button id="add-video-dropdown" aria-haspopup="menu" aria-expanded="false">Add Video</button>
                    <div id="video-dropdown-menu" role="menu" hidden>
                        <div id="upload-desktop-menuitem" role="menuitem" tabindex="0">Upload from desktop</div>
                        <div id="upload-video-edit-menuitem" role="menuitem" tabindex="0">Upload video and edit</div>
                            <div id="upload-menuitem-early-close" role="menuitem" tabindex="0">Upload images and files</div>
                    </div>
                    <button id="attach-file-icon" aria-label="Attach a file" title="Attach a file"></button>
                    <button id="meta-ai-assistant" aria-label="Meta AI business assistant">Meta AI business assistant</button>
                    <aside id="meta-ai-sidebar" aria-label="Meta AI business assistant sidebar" hidden>
                        <button id="meta-ai-add-image">Add image</button>
                    </aside>
                    <simplified-input-menu id="gemini-menu" data-open="true">
                        <button id="gemini-upload-files">Upload files</button>
                    </simplified-input-menu>
                    <button id="generic-upload-files" type="button">Upload Files</button>
                    <a id="issue-title-add-image" href="#issue-add-image">Add image fails in editor</a>
                    <div id="drop-zone">Drag file here</div>
                    <div id="upload-modal" data-test-modal role="dialog">
                        <button id="modal-dismiss" aria-label="Dismiss">Dismiss</button>
                        <button id="modal-menu" class="MmwNPb" aria-label="Menu">Menu</button>
                        <button id="modal-close" class="UTNHae" aria-label="Close">Close</button>
                        <button id="modal-reload">Reload</button>
                        <button id="modal-camera">Take a picture</button>
                        <div id="modal-body">Upload from computer</div>
                    </div>
                    <button id="add-dynamic">Add dynamic input</button>
                    <div id="dynamic-host"></div>
                    <iframe id="upload-frame" src="/frame"></iframe>
                    <output id="changed"></output>
                    <script>
                        const plain = document.getElementById('plain');
                        const labeled = document.getElementById('labeled');
                        const proxyUpload = document.getElementById('proxy-upload');
                        const showPickerUpload = document.getElementById('show-picker-upload');
                        const fsPickerUpload = document.getElementById('fs-picker-upload');
                        const dropUpload = document.getElementById('drop-upload');
                        const displayMode = document.getElementById('display-mode');
                        const deviceUpload = document.getElementById('device-upload-button');
                        const uploadFromDesktop = document.getElementById('upload-from-desktop');
                        const redditAddMedia = document.getElementById('reddit-add-media');
                        const addImage = document.getElementById('add-image');
                        const businessAddPhoto = document.getElementById('business-add-photo');
                        const addPhotoVideo = document.getElementById('add-photo-video');
                        const addVideoDropdown = document.getElementById('add-video-dropdown');
                        const videoDropdownMenu = document.getElementById('video-dropdown-menu');
                        const uploadDesktopMenuitem = document.getElementById('upload-desktop-menuitem');
                        const uploadVideoEditMenuitem = document.getElementById('upload-video-edit-menuitem');
                        const uploadMenuitemEarlyClose = document.getElementById('upload-menuitem-early-close');
                        const attachFileIcon = document.getElementById('attach-file-icon');
                        const metaAiAssistant = document.getElementById('meta-ai-assistant');
                        const metaAiSidebar = document.getElementById('meta-ai-sidebar');
                        const metaAiAddImage = document.getElementById('meta-ai-add-image');
                        const geminiMenu = document.getElementById('gemini-menu');
                        const geminiUploadFiles = document.getElementById('gemini-upload-files');
                        const genericUploadFiles = document.getElementById('generic-upload-files');
                        const issueTitleAddImage = document.getElementById('issue-title-add-image');
                        const dropZone = document.getElementById('drop-zone');
                        const addDynamic = document.getElementById('add-dynamic');
                        const dynamicHost = document.getElementById('dynamic-host');
                        const changed = document.getElementById('changed');
                        const cachedInputClick = HTMLInputElement.prototype.click;
                        window.pasteSeen = false;
                        window.hostOverlayUploadPrevented = false;
                        document.addEventListener('paste', () => window.pasteSeen = true);
                        document.addEventListener('click', event => {
                            const path = event.composedPath ? event.composedPath() : [];
                            if (path.some(node => node && node.id === 'cnp-overlay-file-input')) {
                                window.hostOverlayUploadPrevented = true;
                                event.preventDefault();
                            }
                        }, true);
                        let displayModeOpen = false;
                        let geminiMenuOpen = true;
                        let removeEarlyCloseUploadOnOutsidePointerUp = false;
                        let businessPointerdownInput = null;
                        window.openGeminiMenu = () => {
                            geminiMenuOpen = true;
                            geminiMenu.dataset.open = 'true';
                        };
                        function dynamicUpload(prefix, options = {}) {
                            const input = document.createElement('input');
                            input.id = prefix;
                            input.type = 'file';
                            input.accept = options.accept || '';
                            input.multiple = !!options.multiple;
                            input.style.display = 'none';
                            document.body.appendChild(input);
                            input.addEventListener('change', () => {
                                changed.textContent = prefix + ':' + input.files[0].name;
                                if (options.reclickAfterChange)
                                    (options.cachedClick ? cachedInputClick : HTMLInputElement.prototype.click).call(input);
                            });
                            (options.cachedClick ? cachedInputClick : HTMLInputElement.prototype.click).call(input);
                        }
                        plain.addEventListener('change', () => changed.textContent = 'plain:' + plain.files[0].name);
                        labeled.addEventListener('change', () => changed.textContent = 'labeled:' + labeled.files[0].name);
                        proxyUpload.addEventListener('click', () => {
                            const proxyInput = document.createElement('input');
                            proxyInput.id = 'proxy';
                            proxyInput.type = 'file';
                            proxyInput.style.display = 'none';
                            document.body.appendChild(proxyInput);
                            proxyInput.addEventListener('change', () => changed.textContent = 'proxy:' + proxyInput.files[0].name);
                            proxyInput.click();
                        });
                        showPickerUpload.addEventListener('click', () => {
                            const pickerInput = document.createElement('input');
                            pickerInput.id = 'picker';
                            pickerInput.type = 'file';
                            pickerInput.style.display = 'none';
                            document.body.appendChild(pickerInput);
                            pickerInput.addEventListener('change', () => changed.textContent = 'picker:' + pickerInput.files[0].name);
                            pickerInput.showPicker();
                        });
                        fsPickerUpload.addEventListener('click', async () => {
                            const [handle] = await showOpenFilePicker({ types: [{ accept: { 'text/plain': ['.txt'] } }] });
                            const file = await handle.getFile();
                            changed.textContent = 'fs:' + file.name;
                        });
                        dropUpload.addEventListener('click', event => {
                            event.preventDefault();
                            changed.textContent = 'drop-upload:clicked';
                        });
                        displayMode.addEventListener('click', () => {
                            displayModeOpen = !displayModeOpen;
                            changed.textContent = 'display:' + displayModeOpen;
                        });
                        deviceUpload.addEventListener('click', () => dynamicUpload('reddit-device', { accept: 'image/*' }));
                        uploadFromDesktop.addEventListener('click', () => dynamicUpload('upload-desktop'));
                        redditAddMedia.addEventListener('click', () => dynamicUpload('reddit-add-media', { accept: 'image/*' }));
                        addImage.addEventListener('click', () => {
                            const input = document.createElement('input');
                            input.id = 'bsky-image';
                            input.type = 'file';
                            input.accept = 'image/*';
                            input.style.display = 'none';
                            document.body.appendChild(input);
                            input.addEventListener('change', () => {
                                changed.textContent = 'bsky-image:' + input.files[0].name;
                                cachedInputClick.call(input);
                            });
                            setTimeout(() => cachedInputClick.call(input), 0);
                        });
                        businessAddPhoto.addEventListener('pointerdown', () => {
                            businessPointerdownInput = document.createElement('input');
                            businessPointerdownInput.id = 'business-add-photo';
                            businessPointerdownInput.type = 'file';
                            businessPointerdownInput.accept = 'image/*';
                            businessPointerdownInput.style.display = 'none';
                            document.body.appendChild(businessPointerdownInput);
                            businessPointerdownInput.addEventListener('change', () => changed.textContent = 'business-add-photo:' + businessPointerdownInput.files[0].name);
                        });
                        businessAddPhoto.addEventListener('click', () => setTimeout(() => cachedInputClick.call(businessPointerdownInput), 0));
                        addPhotoVideo.addEventListener('click', () => dynamicUpload('facebook-photo-video', { accept: 'image/*,video/*' }));
                        addVideoDropdown.addEventListener('click', () => {
                            const expanded = addVideoDropdown.getAttribute('aria-expanded') === 'true';
                            addVideoDropdown.setAttribute('aria-expanded', String(!expanded));
                            videoDropdownMenu.hidden = expanded;
                            changed.textContent = 'video-menu:' + !expanded;
                        });
                        uploadDesktopMenuitem.addEventListener('click', () => dynamicUpload('upload-desktop-menuitem'));
                        uploadVideoEditMenuitem.addEventListener('click', () => dynamicUpload('upload-video-edit-menuitem', { accept: 'video/*' }));
                        uploadMenuitemEarlyClose.addEventListener('pointerdown', () => removeEarlyCloseUploadOnOutsidePointerUp = true);
                        uploadMenuitemEarlyClose.addEventListener('click', () => dynamicUpload('upload-menuitem-early-close', { accept: 'image/*' }));
                        attachFileIcon.addEventListener('click', () => dynamicUpload('attach-file-icon'));
                        metaAiAssistant.addEventListener('click', () => {
                            metaAiSidebar.hidden = false;
                            changed.textContent = 'meta-ai-sidebar:true';
                        });
                        metaAiAddImage.addEventListener('click', () => dynamicUpload('meta-ai-add-image', { accept: 'image/*' }));
                        geminiUploadFiles.addEventListener('click', () => {
                            if (geminiMenuOpen)
                                dynamicUpload('gemini-upload-files', { multiple: true });
                        });
                        genericUploadFiles.addEventListener('click', () => changed.textContent = 'generic-upload-files:clicked');
                        issueTitleAddImage.addEventListener('click', event => {
                            event.preventDefault();
                            changed.textContent = 'issue-title-add-image:clicked';
                        });
                        document.addEventListener('click', event => {
                            if (geminiMenuOpen && !geminiMenu.contains(event.target)) {
                                geminiMenuOpen = false;
                                geminiMenu.dataset.open = 'false';
                            }
                        });
                        document.addEventListener('pointerup', event => {
                            if (removeEarlyCloseUploadOnOutsidePointerUp && !videoDropdownMenu.hidden && !videoDropdownMenu.contains(event.target) && !addVideoDropdown.contains(event.target))
                                uploadMenuitemEarlyClose.remove();
                        });
                        dropZone.addEventListener('dragover', event => event.preventDefault());
                        dropZone.addEventListener('drop', event => {
                            event.preventDefault();
                            changed.textContent = 'drop:' + event.dataTransfer.files[0].name;
                        });
                        addDynamic.addEventListener('click', () => {
                            const dynamic = document.createElement('input');
                            dynamic.id = 'dynamic';
                            dynamic.type = 'file';
                            dynamicHost.appendChild(dynamic);
                            dynamic.addEventListener('change', () => changed.textContent = 'dynamic:' + dynamic.files[0].name);
                        });
                    </script>
                </body>
            </html>`,
        '/frame': `<!doctype html>
            <html>
                <body>
                    <input id="framed" type="file">
                    <output id="frame-changed"></output>
                    <script>
                        const framed = document.getElementById('framed');
                        const frameChanged = document.getElementById('frame-changed');
                        framed.addEventListener('change', () => frameChanged.textContent = 'frame:' + framed.files[0].name);
                    </script>
                </body>
            </html>`
    };

    const server = http.createServer((request, response) => {
        response.setHeader('Content-Type', 'text/html; charset=utf-8');
        response.end(pages[request.url] || pages['/']);
    });

    return new Promise(resolve => {
        server.listen(0, '127.0.0.1', () => resolve({
            server,
            url: `http://127.0.0.1:${server.address().port}/`
        }));
    });
}

test('extension overlay supports upload targets without exposing paste message bridge', async () => {
    const extensionPath = path.resolve(__dirname, '..', 'dist', 'chromium');
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cnp-smoke-'));
    const uploadFile = path.join(os.tmpdir(), 'cnp-smoke-upload.txt');
    fs.writeFileSync(uploadFile, 'copy-n-paste smoke upload');

    const { server, url } = await startServer();
    const context = await chromium.launchPersistentContext(userDataDir, {
        headless: false,
        viewport: null,
        args: [
            `--disable-extensions-except=${extensionPath}`,
            `--load-extension=${extensionPath}`
        ]
    });
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(url).origin });

    try {
        const page = await context.newPage();
        await page.goto(url);
        await page.waitForFunction(() => document.querySelector('#plain')?.dataset.cnpCreateListener === 'true');
        await page.waitForFunction(() => document.documentElement.dataset.cnpInitLoaded === 'true');
        await page.waitForFunction(() => document.documentElement.dataset.cnpPageHookLoaded === 'true');
        await writeClipboardImage(page);

        await page.evaluate(() => window.postMessage({ Type: 'paste' }, '*'));
        await page.waitForTimeout(250);
        await expect.poll(() => page.evaluate(() => window.pasteSeen)).toBe(false);

        await page.locator('#plain').click();
        await expect(page.locator('.cnp-overlay-content')).toBeVisible();
        await expect(page.locator('#cnp-image-preview')).toBeVisible();
        await page.locator('#cnp-preview-container').click();
        await expect(page.locator('#changed')).toContainText('plain:CnP_');

        await page.locator('#label-upload').click();
        await expect(page.locator('.cnp-overlay-content')).toBeVisible();
        await expect(page.locator('#cnp-upload-btn')).toBeVisible();
        await page.locator('#cnp-overlay-file-input').setInputFiles(uploadFile);
        await expect(page.locator('#changed')).toHaveText('labeled:cnp-smoke-upload.txt');

        await page.locator('#proxy-upload').click();
        await expect(page.locator('.cnp-overlay-content')).toBeVisible();
        await expect(page.locator('#cnp-upload-btn')).toBeVisible();
        await page.locator('#cnp-overlay-file-input').setInputFiles(uploadFile);
        await expect(page.locator('#changed')).toHaveText('proxy:cnp-smoke-upload.txt');

        await page.locator('#show-picker-upload').click();
        await expect(page.locator('.cnp-overlay-content')).toBeVisible();
        await expect(page.locator('#cnp-upload-btn')).toBeVisible();
        await page.locator('#cnp-overlay-file-input').setInputFiles(uploadFile);
        await expect(page.locator('#changed')).toHaveText('picker:cnp-smoke-upload.txt');

        await page.locator('#fs-picker-upload').click();
        await expect(page.locator('.cnp-overlay-content')).toBeVisible();
        await expect(page.locator('#cnp-upload-btn')).toBeVisible();
        await page.locator('#cnp-overlay-file-input').setInputFiles(uploadFile);
        await expect(page.locator('#changed')).toHaveText('fs:cnp-smoke-upload.txt');

        for (const selector of ['#modal-dismiss', '#modal-menu', '#modal-close', '#modal-reload', '#modal-camera', '#modal-body', '#upload-modal']) {
            await page.locator(selector).click();
            await expect(page.locator('.cnp-overlay-content')).toHaveCount(0);
        }

        await page.locator('#display-mode').click();
        await expect(page.locator('.cnp-overlay-content')).toHaveCount(0);
        await expect(page.locator('#changed')).toHaveText('display:true');

        await page.locator('#generic-upload-files').click();
        await expect(page.locator('.cnp-overlay-content')).toHaveCount(0);
        await expect(page.locator('#changed')).toHaveText('generic-upload-files:clicked');

        await page.locator('#issue-title-add-image').click();
        await expect(page.locator('.cnp-overlay-content')).toHaveCount(0);
        await expect(page.locator('#changed')).toHaveText('issue-title-add-image:clicked');

        await page.locator('#add-video-dropdown').click();
        await expect(page.locator('.cnp-overlay-content')).toHaveCount(0);
        await expect(page.locator('#video-dropdown-menu')).toBeVisible();

        for (const target of [
            { selector: '#device-upload-button', output: 'reddit-device' },
            { selector: '#upload-from-desktop', output: 'upload-desktop' },
            { selector: '#reddit-add-media', output: 'reddit-add-media' },
            { selector: '#business-add-photo', output: 'business-add-photo' },
            { selector: '#add-photo-video', output: 'facebook-photo-video' },
            { selector: '#upload-desktop-menuitem', output: 'upload-desktop-menuitem' },
            { selector: '#upload-video-edit-menuitem', output: 'upload-video-edit-menuitem' },
            { selector: '#upload-menuitem-early-close', output: 'upload-menuitem-early-close' },
            { selector: '#attach-file-icon', output: 'attach-file-icon' }
        ]) {
            await writeClipboardImage(page);
            await page.locator(target.selector).click();
            await expect(page.locator('.cnp-overlay-content'), `${target.selector} should show overlay`).toBeVisible();
            await expect(page.locator('#cnp-image-preview'), `${target.selector} should show preview`).toBeVisible();
            await page.locator('#cnp-preview-container').click();
            await expect(page.locator('#changed'), `${target.selector} should receive preview file`).toContainText(`${target.output}:CnP_`);
            await expect(page.locator('.cnp-overlay-content'), `${target.selector} should close overlay`).toHaveCount(0);
        }

        await page.locator('#meta-ai-assistant').click();
        await expect(page.locator('.cnp-overlay-content')).toHaveCount(0);
        await expect(page.locator('#meta-ai-sidebar')).toBeVisible();

        await writeClipboardImage(page);
        await page.locator('#meta-ai-add-image').click();
        await expect(page.locator('.cnp-overlay-content')).toBeVisible();
        await expect(page.locator('#cnp-image-preview')).toBeVisible();
        await page.locator('#cnp-preview-container').click();
        await expect(page.locator('#changed')).toContainText('meta-ai-add-image:CnP_');
        await expect(page.locator('.cnp-overlay-content')).toHaveCount(0);

        await writeClipboardImage(page);
        await page.locator('#add-image').click();
        await expect(page.locator('.cnp-overlay-content')).toBeVisible();
        await expect(page.locator('#cnp-image-preview')).toBeVisible();
        const unexpectedBskyChooser = page.waitForEvent('filechooser', { timeout: 1000 }).then(() => 'filechooser').catch(() => null);
        await page.locator('#cnp-preview-container').click();
        await expect(page.locator('#changed')).toContainText('bsky-image:CnP_');
        await expect(page.locator('.cnp-overlay-content')).toHaveCount(0);
        await expect.poll(() => unexpectedBskyChooser).toBe(null);

        const previousBskyAttachment = await page.locator('#changed').innerText();
        await page.locator('#add-image').click();
        await expect(page.locator('.cnp-overlay-content')).toBeVisible();
        await expect(page.locator('#changed')).toHaveText(previousBskyAttachment);
        await expect(page.locator('#cnp-overlay-file-input')).toBeVisible();
        await expect.poll(() => page.locator('#cnp-upload-btn').evaluate(uploadButton => {
            const rect = uploadButton.getBoundingClientRect();
            const hitTarget = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
            return !!(hitTarget && hitTarget.id === 'cnp-overlay-file-input' && hitTarget.type === 'file');
        })).toBe(true);
        const bskyChooserPromise = page.waitForEvent('filechooser');
        await page.locator('#cnp-upload-btn').click();
        const bskyChooser = await bskyChooserPromise;
        await bskyChooser.setFiles(uploadFile);
        await expect.poll(() => page.evaluate(() => window.hostOverlayUploadPrevented)).toBe(false);
        await expect(page.locator('#changed')).toHaveText('bsky-image:cnp-smoke-upload.txt');
        await expect(page.locator('.cnp-overlay-content')).toHaveCount(0);

        for (const target of [
            { selector: '#add-photo-video', output: 'facebook-photo-video' }
        ]) {
            await page.locator(target.selector).click();
            await expect(page.locator('.cnp-overlay-content')).toBeVisible();
            const nativeChooserPromise = page.waitForEvent('filechooser');
            await page.locator('#cnp-upload-btn').click();
            const nativeChooser = await nativeChooserPromise;
            await nativeChooser.setFiles(uploadFile);
            await expect(page.locator('#changed')).toHaveText(`${target.output}:cnp-smoke-upload.txt`);
            await expect(page.locator('.cnp-overlay-content')).toHaveCount(0);
        }

        await page.evaluate(() => window.openGeminiMenu());
        await page.locator('#gemini-upload-files').click();
        await expect(page.locator('.cnp-overlay-content')).toBeVisible();
        await expect(page.locator('#cnp-overlay-file-input')).toBeVisible();
        await expect.poll(() => page.locator('#cnp-upload-btn').evaluate(uploadButton => {
            const rect = uploadButton.getBoundingClientRect();
            const hitTarget = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
            return !!(hitTarget && hitTarget.id === 'cnp-overlay-file-input' && hitTarget.type === 'file');
        })).toBe(true);
        const overlayFileChooserPromise = page.waitForEvent('filechooser');
        await page.locator('#cnp-upload-btn').click();
        const overlayFileChooser = await overlayFileChooserPromise;
        await overlayFileChooser.setFiles(uploadFile);
        await expect.poll(() => page.evaluate(() => window.hostOverlayUploadPrevented)).toBe(false);
        await expect(page.locator('#changed')).toHaveText('gemini-upload-files:cnp-smoke-upload.txt');
        await expect(page.locator('#gemini-menu')).toHaveAttribute('data-open', 'true');

        await page.locator('#drop-upload').click();
        await expect(page.locator('.cnp-overlay-content')).toHaveCount(0);
        await expect(page.locator('#changed')).toHaveText('drop-upload:clicked');

        await page.locator('#add-dynamic').dispatchEvent('click');
        await page.waitForFunction(() => document.querySelector('#dynamic')?.dataset.cnpCreateListener === 'true');
        await page.locator('#dynamic').click();
        await expect(page.locator('.cnp-overlay-content')).toBeVisible();
        await expect(page.locator('#cnp-upload-btn')).toBeVisible();
        await page.locator('#cnp-overlay-file-input').setInputFiles(uploadFile);
        await expect(page.locator('#changed')).toHaveText('dynamic:cnp-smoke-upload.txt');

        const frame = page.frameLocator('#upload-frame');
        await frame.locator('#framed').click();
        await expect(frame.locator('.cnp-overlay-content')).toBeVisible();
        await expect(frame.locator('#cnp-upload-btn')).toBeVisible();
        await frame.locator('#cnp-overlay-file-input').setInputFiles(uploadFile);
        await expect(frame.locator('#frame-changed')).toHaveText('frame:cnp-smoke-upload.txt');
    } finally {
        await context.close();
        server.close();
        fs.rmSync(userDataDir, { recursive: true, force: true });
        fs.rmSync(uploadFile, { force: true });
    }
});