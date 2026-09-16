'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SOURCE = path.join(__dirname, '..', '..', 'src', 'common', 'defaults.js');

/**
 * Runs src/common/defaults.js outside the browser so the settings contract can
 * be checked without launching anything. The file deliberately has no chrome
 * API calls at load time, so a bare sandbox is enough.
 */
function load() {
  const sandbox = { console };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(SOURCE, 'utf8'), sandbox);
  return sandbox.ImageBlur;
}

module.exports = { load };
