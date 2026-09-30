// Real, public websites (no login). Each test performs the user's real action on the site, confirms the
// overlay, and checks the site's own reaction to the file, not just the input's value.
// These depend on third-party pages and may need selector updates when a site changes.
const path = require('path');
const { test, expect, waitForOverlay, clickOverlay } = require('./support/fixtures');
const { copyFiles } = require('./support/clipboard');

const IMAGE = path.join(__dirname, 'assets', 'cnp-test.png');
const NAME = 'cnp-test.png';

test.setTimeout(120_000);

let ckeditorImages = 0;

// Frames load lazily on some sites; wait for the one that contains `selector`
async function frameWith(page, selector) {
    let found;
    await expect.poll(async () => {
        for (const frame of page.frames())
            if (await frame.locator(selector).count().catch(() => 0))
                return (found = frame), true;
        return false;
    }, { timeout: 30_000, message: `a frame containing ${selector}` }).toBe(true);
    return found;
}

const SITES = [
    {
        name: 'MDN live sample: cross-origin iframe, <label> for an invisible input',
        url: 'https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/input/file',
        async open(page) {
            await page.getByRole('heading', { name: 'Examples', exact: true }).scrollIntoViewIfNeeded();
            const frame = await frameWith(page, '#image_uploads');
            await frame.getByText('Choose images to upload').click();
            return frame;
        },
        attached: (page, frame) => expect(frame.locator('.preview')).toContainText(NAME),
    },
    {
        name: 'FilePond: <label> "Browse" for a hidden input',
        url: 'https://pqina.nl/filepond/',
        open: page => page.locator('.filepond--label-action').first().click(),
        attached: page => expect(page.locator('.filepond--file-info-main').first()).toHaveText(NAME),
    },
    {
        name: 'Dropzone.js: hidden input appended to <body>, opened with .click()',
        url: 'https://www.dropzone.dev/',
        open: page => page.getByText('Try it out!').click(),
        attached: page => expect(page.locator('.dz-filename').first()).toHaveText(NAME),
    },
    {
        name: 'Ant Design (React): display:none input opened with .click()',
        url: 'https://ant.design/components/upload',
        open: page => page.locator('#upload-demo-basic').getByRole('button', { name: 'Click to Upload' }).click(),
        attached: page => expect(page.locator('#upload-demo-basic .ant-upload-list-item-name')).toHaveText(NAME),
    },
    {
        name: 'MUI (React): input inside a <label> button',
        url: 'https://mui.com/material-ui/react-button/',
        open: page => page.locator('label', { hasText: 'Upload files' }).first().click(),
        attached: page => expect.poll(() => page.locator('label', { hasText: 'Upload files' }).first().locator('input').evaluate(input => [...input.files].map(file => file.name))).toEqual([NAME]),
    },
    {
        name: 'Vaadin Upload: web component with the input in its shadow root',
        url: 'https://vaadin.com/docs/latest/components/upload',
        open: page => page.locator('vaadin-upload').first().getByRole('button', { name: /upload/i }).click(),
        attached: page => expect(page.locator('vaadin-upload').first().locator('vaadin-upload-file').first()).toContainText(NAME),
    },
    {
        name: 'Summernote: input inside a Bootstrap modal',
        url: 'https://summernote.org/',
        async open(page) {
            await page.getByRole('button', { name: 'Picture' }).first().click();
            await page.locator('.note-image-input:visible').click();
        },
        attached: page => expect(page.locator(`.note-editable img[data-filename="${NAME}"]`)).toHaveCount(1),
    },
    {
        name: 'CKEditor 5: hidden input inside a toolbar button, opened with .click()',
        url: 'https://ckeditor.com/ckeditor-5/demo/feature-rich/',
        async open(page) {
            const editor = page.locator('.ck-editor__editable').first();
            await editor.click();
            ckeditorImages = await editor.locator('img').count();
            await page.getByRole('button', { name: 'Upload image from computer' }).first().click();
        },
        attached: page => expect.poll(() => page.locator('.ck-editor__editable').first().locator('img').count()).toBeGreaterThan(ckeditorImages),
    },
    {
        name: 'TinyPNG: drop zone opening a hidden input with .click()',
        url: 'https://tinypng.com/',
        open: page => page.locator('#upload-dropbox-zone').click(),
        attached: page => expect(page.getByText(NAME).first()).toBeVisible({ timeout: 30_000 }),
    },
];

for (const site of SITES)
    test(site.name, async ({ page, nativePicker }) => {
        copyFiles(IMAGE);
        await page.goto(site.url);
        // Clicks can land before the site's scripts are ready, so repeat the user's action until it works
        let frame;
        await expect(async () => {
            frame = (await site.open(page)) || page.mainFrame();
            await waitForOverlay(frame, 5_000);
        }).toPass({ timeout: 45_000 });
        expect(nativePicker, 'the native picker should not open').toHaveLength(0);
        await page.waitForTimeout(600); // the preview ignores clicks for 500 ms after opening
        await clickOverlay(page, frame, 'preview');
        await site.attached(page, frame);
    });

// Known limitation: document.open() wipes every content-script listener in that frame
test('w3schools Tryit (document.write() frame) keeps the native picker', async ({ page, nativePicker }) => {
    copyFiles(IMAGE);
    await page.goto('https://www.w3schools.com/tags/tryit.asp?filename=tryhtml5_input_type_file', { waitUntil: 'domcontentloaded' });
    const frame = await frameWith(page, '#myfile');
    await frame.locator('#myfile').first().click();
    await expect.poll(() => nativePicker.length).toBe(1);
});
