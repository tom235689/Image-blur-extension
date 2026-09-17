'use strict';

/**
 * Reads the message catalogue and works out which of its keys the extension
 * actually names, so both the build and the test suite can ask the same
 * question and get the same answer.
 *
 * Nothing checks any of this at run time: a key the code asks for and the
 * catalogue does not have falls back silently to the English left in the
 * markup, and a key the catalogue has and nothing asks for is dead weight a
 * translator still has to work through.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const SOURCE = path.join(ROOT, 'src');

/** Keys the browser provides itself, such as @@bidi_dir; never in a catalogue. */
const BUILT_IN = /^@@/;

/** Every place a key can be named, and how to pick it out of that kind of file. */
const REFERENCES = [
  { extension: '.json', root: ROOT, shallow: true, pattern: /__MSG_([A-Za-z0-9_]+)__/g },
  { extension: '.html', root: SOURCE, pattern: /data-i18n(?:-[a-z]+)?="([^"]+)"/g },
  { extension: '.js', root: SOURCE, pattern: /\b(?:label|message)\(\s*'([^']+)'/g }
];

function catalogueFile(locale) {
  return path.join(ROOT, '_locales', locale, 'messages.json');
}

function walk(directory, extension, shallow, found) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!shallow) {
        walk(full, extension, shallow, found);
      }
    } else if (entry.name.endsWith(extension)) {
      found.push(full);
    }
  }
  return found;
}

function referencedKeys() {
  const keys = new Set();
  let namesPixels = false;

  for (const reference of REFERENCES) {
    for (const file of walk(reference.root, reference.extension, !!reference.shallow, [])) {
      const source = fs.readFileSync(file, 'utf8');
      if (source.includes('.pixels(')) {
        namesPixels = true;
      }
      let match;
      // The patterns are global, so lastIndex has to start clean for each file.
      reference.pattern.lastIndex = 0;
      while ((match = reference.pattern.exec(source)) !== null) {
        if (!BUILT_IN.test(match[1])) {
          keys.add(match[1]);
        }
      }
    }
  }

  // pixels() names its key inside the helper rather than taking it from callers.
  if (namesPixels) {
    keys.add('unitPixels');
  }
  return keys;
}

function load(locale) {
  return JSON.parse(fs.readFileSync(catalogueFile(locale), 'utf8'));
}

/** Placeholders written into a message but never declared alongside it. */
function undeclaredPlaceholders(entry) {
  const used = (String(entry.message || '').match(/\$([A-Za-z0-9_]+)\$/g) || [])
    .map((token) => token.slice(1, -1).toLowerCase());
  const declared = Object.keys(entry.placeholders || {}).map((name) => name.toLowerCase());
  return used.filter((name) => declared.indexOf(name) === -1);
}

/** Everything that can be wrong between the code and one locale's catalogue. */
function audit(locale) {
  const catalogue = load(locale);
  const defined = Object.keys(catalogue);
  const referenced = referencedKeys();

  return {
    defined,
    referenced: [...referenced].sort(),
    missing: [...referenced].filter((key) => !catalogue[key]).sort(),
    unused: defined.filter((key) => !referenced.has(key)).sort(),
    withoutMessage: defined.filter((key) => !catalogue[key].message).sort(),
    withoutDescription: defined.filter((key) => !catalogue[key].description).sort(),
    undeclaredPlaceholders: defined.filter((key) => undeclaredPlaceholders(catalogue[key]).length).sort()
  };
}

module.exports = { ROOT, audit, load, referencedKeys, catalogueFile };
