'use strict';

/**
 * Packages the extension for the Chrome Web Store, and refuses to do so while
 * anything about the package is wrong.
 *
 *   node tools/build.js            check, then write dist/image-blur-<version>.zip
 *   node tools/build.js --check    check only
 *
 * The checks are the ones that are cheap here and expensive later: the store
 * rejects an upload whose manifest points at a file that is not in the archive,
 * and it accepts one whose name renders as the literal text __MSG_appName__.
 */

const fs = require('fs');
const path = require('path');

const locales = require('./lib/locales');
const zip = require('./lib/zip');

const ROOT = locales.ROOT;
const OUTPUT_DIRECTORY = path.join(ROOT, 'dist');

/** Everything that ships. Anything outside this list is development only. */
const SHIPPED = ['manifest.json', 'icons', 'src', '_locales'];

const problems = [];

function fail(message) {
  problems.push(message);
}

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

function exists(relative) {
  return fs.existsSync(path.join(ROOT, relative));
}

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

/**
 * The size a PNG declares in its header, or null if the file is not one. The
 * first chunk of a PNG is always IHDR, and its first eight bytes are the width
 * and the height, so this needs to read 24 bytes and no library.
 */
function pngSize(relative) {
  const data = fs.readFileSync(path.join(ROOT, relative));
  if (data.length < 24 || !data.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return null;
  }
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}

/**
 * An icon declared under one size and drawn at another is accepted here and
 * refused, or silently rescaled, later. Both sets are checked: the store reads
 * manifest.icons, and the toolbar reads action.default_icon.
 */
function checkIcons(manifest) {
  const sets = [manifest.icons, manifest.action && manifest.action.default_icon];
  const declared = new Map();
  for (const set of sets) {
    // The two sets normally name the same files at the same sizes, so they are
    // gathered before being judged: one file drawn wrong is one problem.
    for (const size of Object.keys(set || {})) {
      declared.set(set[size] + ' @ ' + size, { file: set[size], size: Number(size) });
    }
  }

  for (const { file, size } of declared.values()) {
    if (!exists(file)) {
      continue;
    }
    const png = pngSize(file);
    if (!png) {
      fail(file + ' is declared as an icon but is not a PNG');
    } else if (png.width !== size || png.height !== size) {
      fail(file + ' is declared as ' + size + ' square but is ' + png.width + 'x' + png.height);
    }
  }
}

/** Every path the manifest promises will be in the package. */
function referencedFiles(manifest) {
  const files = [];

  const icons = (set) => Object.keys(set || {}).forEach((size) => files.push(set[size]));
  icons(manifest.icons);
  icons(manifest.action && manifest.action.default_icon);

  if (manifest.action && manifest.action.default_popup) {
    files.push(manifest.action.default_popup);
  }
  if (manifest.options_ui && manifest.options_ui.page) {
    files.push(manifest.options_ui.page);
  }
  if (manifest.background && manifest.background.service_worker) {
    files.push(manifest.background.service_worker);
  }
  for (const script of manifest.content_scripts || []) {
    files.push(...(script.js || []), ...(script.css || []));
  }
  return [...new Set(files)];
}

/** Scripts a page pulls in with a relative src, which the manifest never names. */
function pageScripts(page) {
  const directory = path.dirname(page);
  const markup = read(page);
  const found = [];
  const pattern = /<script[^>]+src="([^"]+)"/g;
  let match;
  while ((match = pattern.exec(markup)) !== null) {
    found.push(path.posix.normalize(path.posix.join(directory.split(path.sep).join('/'), match[1])));
  }
  return found;
}

function checkManifest(manifest) {
  const packageVersion = JSON.parse(read('package.json')).version;
  if (manifest.version !== packageVersion) {
    fail('manifest version ' + manifest.version + ' does not match package.json ' + packageVersion);
  }
  if (!/^\d+(\.\d+){0,3}$/.test(manifest.version)) {
    fail('version ' + manifest.version + ' is not the dotted integers the store accepts');
  }
  if (!manifest.default_locale) {
    fail('no default_locale, so every __MSG_ name would be shown literally');
  }
  if (!manifest.minimum_chrome_version) {
    fail('no minimum_chrome_version, so the extension can install where it cannot work');
  }

  for (const file of referencedFiles(manifest)) {
    if (!exists(file)) {
      fail('the manifest points at ' + file + ', which is not there');
    }
  }

  const pages = [
    manifest.action && manifest.action.default_popup,
    manifest.options_ui && manifest.options_ui.page
  ].filter(Boolean);

  for (const page of pages) {
    if (!exists(page)) {
      continue;
    }
    for (const script of pageScripts(page)) {
      if (!exists(script)) {
        fail(page + ' loads ' + script + ', which is not there');
      }
    }
  }
}

function checkLocales(manifest) {
  if (!manifest.default_locale) {
    return;
  }
  if (!exists(path.join('_locales', manifest.default_locale, 'messages.json'))) {
    fail('the default locale ' + manifest.default_locale + ' has no messages.json');
    return;
  }

  const report = locales.audit(manifest.default_locale);
  for (const key of report.missing) {
    fail('the code asks for the message "' + key + '", which the catalogue does not have');
  }
  for (const key of report.withoutMessage) {
    fail('the catalogue entry "' + key + '" has no message');
  }
  for (const key of report.undeclaredPlaceholders) {
    fail('the message "' + key + '" uses a placeholder it does not declare');
  }
}

/** Files under one shipped path, relative to the root and in a stable order. */
function collect(relative, found) {
  const full = path.join(ROOT, relative);
  if (!fs.existsSync(full)) {
    return found;
  }
  if (fs.statSync(full).isFile()) {
    found.push(relative);
    return found;
  }
  for (const entry of fs.readdirSync(full).sort()) {
    collect(path.join(relative, entry), found);
  }
  return found;
}

function main() {
  const checkOnly = process.argv.includes('--check');

  let manifest;
  try {
    manifest = JSON.parse(read('manifest.json'));
  } catch (error) {
    console.error('manifest.json does not parse: ' + error.message);
    process.exit(1);
  }

  checkManifest(manifest);
  checkIcons(manifest);
  checkLocales(manifest);

  if (problems.length) {
    console.error('cannot package:');
    problems.forEach((problem) => console.error('  - ' + problem));
    process.exit(1);
  }

  const files = SHIPPED.reduce((found, entry) => collect(entry, found), []);
  console.log('checked ' + files.length + ' files, version ' + manifest.version);

  if (checkOnly) {
    return;
  }

  // One fixed timestamp for every entry, so the same source always produces a
  // byte for byte identical archive.
  const date = new Date(Date.UTC(1980, 0, 1, 0, 0, 0));
  const archive = zip.create(files.map((file) => ({
    name: file.split(path.sep).join('/'),
    data: fs.readFileSync(path.join(ROOT, file)),
    date
  })));

  fs.mkdirSync(OUTPUT_DIRECTORY, { recursive: true });
  const output = path.join(OUTPUT_DIRECTORY, 'image-blur-' + manifest.version + '.zip');
  fs.writeFileSync(output, archive);

  console.log('wrote ' + path.relative(ROOT, output) + ' (' + Math.round(archive.length / 1024) + ' kB)');
}

main();
