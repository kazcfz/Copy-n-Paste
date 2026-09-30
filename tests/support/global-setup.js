// Tests always run against a fresh build of dist/
const { execFileSync } = require('child_process');
const path = require('path');

module.exports = () => {
    execFileSync(process.execPath, ['build.js'], { cwd: path.resolve(__dirname, '../..'), stdio: 'inherit' });
};
