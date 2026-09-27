// Where build output lives.
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const BUILD_ROOT = process.env.BUILD_ROOT || path.join(ROOT, 'build');

module.exports = { BUILD_ROOT };
