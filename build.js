const fs = require('fs');
const path = require('path');
const archiver = require('archiver');

// List exactly what to include
const includeFolders = ['icons', 'media'];
const includeFiles = ['background.js', 'content.js', 'init.js', 'overlay.html'];

function ensureDir(dir) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

function copyWhitelist(outDir) {
    // Copy specific folders
    includeFolders.forEach(folder => {
        if (fs.existsSync(folder)) {
            fs.cpSync(folder, path.join(outDir, folder), { recursive: true });
        }
    });
    // Copy specific files
    includeFiles.forEach(file => {
        if (fs.existsSync(file)) {
            fs.copyFileSync(file, path.join(outDir, file));
        }
    });
}

function build(target) {
    const outDir = path.join('dist', target);
    fs.rmSync(outDir, { recursive: true, force: true });
    ensureDir(outDir);

    // Copy whitelisted files/folders
    copyWhitelist(outDir);

    // Copy platform-specific manifest.json
    fs.copyFileSync(`platform/${target}/manifest.json`, path.join(outDir, 'manifest.json'));

    return outDir;
}

async function zipFolder(folder, outFile) {
    const output = fs.createWriteStream(outFile);
    const archive = archiver('zip');
    archive.pipe(output);
    archive.directory(folder, false);
    await archive.finalize();
}

(async () => {
    const chromiumDir = build('chromium');
    const firefoxDir = build('firefox');

    ensureDir('dist/zips');
    await zipFolder(chromiumDir, 'dist/zips/extension-chromium.zip');
    await zipFolder(firefoxDir, 'dist/zips/extension-firefox.zip');
})();
