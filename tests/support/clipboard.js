// Seeds the real OS clipboard, the same way a user copying in their file manager or taking a
// screenshot would. This overwrites whatever the clipboard held.
//   Windows: PowerShell. macOS: osascript (JavaScript for Automation). Linux (X11): xclip.
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const quote = value => `'${String(value).replace(/'/g, "''")}'`;

function powershell(script) {
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-Command', script], { stdio: 'pipe' });
}

// Values are passed to the script as JSON, so no quoting issues
function jxa(script, values) {
    execFileSync('osascript', ['-l', 'JavaScript', '-e', `ObjC.import('AppKit'); const V = ${JSON.stringify(values)}; ${script}`], { stdio: 'pipe' });
}

// xclip forks a child that keeps serving the selection, so its output must not be piped
function xclip(target, input) {
    const result = spawnSync('xclip', ['-selection', 'clipboard', '-t', target], { input, stdio: ['pipe', 'ignore', 'ignore'] });
    if (result.error || result.status !== 0)
        throw new Error(`xclip failed (is it installed?): ${result.error?.message || result.status}`);
}

// Like copying files in Explorer / Finder / Files
function copyFiles(...files) {
    files = files.map(file => path.resolve(file));
    if (process.platform === 'win32')
        powershell(`Set-Clipboard -LiteralPath ${files.map(quote).join(',')}`);
    else if (process.platform === 'darwin')
        // Like Finder: one item per file with its URL, name and icon. Browsers must ignore the icon image
        jxa(`
            const items = $.NSMutableArray.array;
            for (const file of V) {
                const item = $.NSPasteboardItem.alloc.init;
                item.setStringForType($.NSURL.fileURLWithPath(file).absoluteString, 'public.file-url');
                item.setStringForType(file.split('/').pop(), 'public.utf8-plain-text');
                item.setDataForType($.NSWorkspace.sharedWorkspace.iconForFile(file).TIFFRepresentation, 'public.tiff');
                items.addObject(item);
            }
            const pasteboard = $.NSPasteboard.generalPasteboard;
            pasteboard.clearContents;
            if (!pasteboard.writeObjects(items))
                throw new Error('writeObjects failed');`, files);
    else
        xclip('text/uri-list', files.map(file => pathToFileURL(file).href).join('\r\n'));
}

// Like a screenshot (image data on the clipboard, no file name)
function copyImage(file) {
    file = path.resolve(file);
    if (process.platform === 'win32')
        powershell(`Add-Type -AssemblyName System.Windows.Forms, System.Drawing; [Windows.Forms.Clipboard]::SetImage([Drawing.Image]::FromFile(${quote(file)}))`);
    else if (process.platform === 'darwin')
        jxa(`
            const pasteboard = $.NSPasteboard.generalPasteboard;
            pasteboard.clearContents;
            if (!pasteboard.setDataForType($.NSData.dataWithContentsOfFile(V), 'public.png'))
                throw new Error('setData failed');`, file);
    else
        xclip('image/png', fs.readFileSync(file));
}

function copyText(text) {
    if (process.platform === 'win32')
        powershell(`Set-Clipboard -Value ${quote(text)}`);
    else if (process.platform === 'darwin')
        execFileSync('pbcopy', { input: text });
    else
        xclip('UTF8_STRING', text);
}

module.exports = { copyFiles, copyImage, copyText };
