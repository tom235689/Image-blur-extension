'use strict';

const fs = require('fs');
const path = require('path');

const locales = require('../lib/locales');

/**
 * The catalogue and the code have to agree, and nothing says so at run time:
 * a missing key falls back silently to the English left in the markup, and an
 * unused one is dead weight a translator still has to work through.
 */
module.exports = {
  name: 'localisation catalogue',
  browser: false,

  run(t) {
    const manifest = JSON.parse(fs.readFileSync(path.join(locales.ROOT, 'manifest.json'), 'utf8'));
    t.expect('the manifest declares a default locale', manifest.default_locale, 'en');

    const report = locales.audit(manifest.default_locale);

    t.expect('the catalogue is not empty', report.defined.length > 0, true);
    t.expect('every key the code uses exists', report.missing, []);
    t.expect('every key in the catalogue is used', report.unused, []);
    t.expect('every entry has a message', report.withoutMessage, []);

    // Translators work from the description alone, so an entry without one is
    // an entry that gets translated by guesswork.
    t.expect('every entry has a description', report.withoutDescription, []);
    t.expect('every placeholder used in a message is declared', report.undeclaredPlaceholders, []);

    // The name and the description are what the store listing shows, so they
    // have to come from the catalogue rather than being frozen in English.
    t.expect('the store facing strings are localised',
      [manifest.name, manifest.description],
      ['__MSG_appName__', '__MSG_appDescription__']);
  }
};
