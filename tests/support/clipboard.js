// Seeds the real OS clipboard, the same way a user copying in Explorer or taking a screenshot would.
// Windows only. This overwrites whatever the clipboard held.
const { execFileSync } = require('child_process');
const path = require('path');

function powershell(script) {
    if (process.platform !== 'win32')
        throw new Error('Clipboard seeding is only implemented for Windows');
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-Command', script], { stdio: 'pipe' });
}

const quote = value => `'${String(value).replace(/'/g, "''")}'`;

// Like Ctrl+C on files in Explorer (CF_HDROP)
function copyFiles(...files) {
    powershell(`Set-Clipboard -LiteralPath ${files.map(file => quote(path.resolve(file))).join(',')}`);
}

// Like a screenshot (bitmap on the clipboard, no file name)
function copyImage(file) {
    powershell(`Add-Type -AssemblyName System.Windows.Forms, System.Drawing; [Windows.Forms.Clipboard]::SetImage([Drawing.Image]::FromFile(${quote(path.resolve(file))}))`);
}

function copyText(text) {
    powershell(`Set-Clipboard -Value ${quote(text)}`);
}

module.exports = { copyFiles, copyImage, copyText };
