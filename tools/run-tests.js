'use strict';

/**
 * Runs every check in tools/checks against a real Chrome with the extension
 * loaded. Pass a substring to run only the checks whose file name matches:
 *
 *   node tools/run-tests.js            all checks
 *   node tools/run-tests.js shadow     only 05-shadow.js
 */

const fs = require('fs');
const path = require('path');

const harness = require('./lib/harness');
const server = require('./lib/server');
const settingsModule = require('./lib/settings-module');

const CHECKS = path.join(__dirname, 'checks');
const filter = process.argv[2] || '';

function createReporter() {
  const failures = [];
  let passed = 0;

  return {
    failures,
    passed: () => passed,
    context(name) {
      return {
        expect(label, actual, expected) {
          const actualText = JSON.stringify(actual);
          const expectedText = JSON.stringify(expected);
          if (actualText === expectedText) {
            passed += 1;
            console.log('    ok   ' + label + '  ' + actualText);
            return;
          }
          failures.push(name + ' / ' + label);
          console.log('    FAIL ' + label);
          console.log('         got      ' + actualText);
          console.log('         expected ' + expectedText);
        }
      };
    }
  };
}

/** Everything a check needs; keeps the checks themselves free of plumbing. */
function createContext(session, site, defaults, reporter, name) {
  const { expect } = reporter.context(name);

  const context = {
    expect,
    sleep: harness.sleep,
    page: session.page,
    worker: session.worker,
    settingsModule: settingsModule,

    async open(page, waitMs) {
      await session.page.send('Page.navigate', { url: site + '/' + page });
      await harness.sleep(waitMs === undefined ? 2500 : waitMs);
    },

    evaluate(expression, options) {
      return session.page.evaluate(expression, options);
    },

    async setSettings(patch) {
      await session.worker.evaluate(
        'chrome.storage.sync.set(' + JSON.stringify(patch) + ')',
        { awaitPromise: true }
      );
      await harness.sleep(900);
    },

    resetSettings() {
      return context.setSettings(defaults);
    },

    async hover(x, y) {
      await session.page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
      await harness.sleep(400);
    },

    /** Moves the pointer to the middle of the first element matching selector. */
    async hoverElement(selector) {
      const box = await context.evaluate(
        '(() => { const r = document.querySelector(' + JSON.stringify(selector) + ').getBoundingClientRect();' +
        ' return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()'
      );
      await context.hover(box.x, box.y);
    },

    /** Reads the computed filter of several elements at once: { name: selector }. */
    filters(map) {
      return context.evaluate(
        '(() => { const wanted = ' + JSON.stringify(map) + '; const out = {};' +
        ' for (const key of Object.keys(wanted)) {' +
        '   const el = document.querySelector(wanted[key]);' +
        '   out[key] = el ? getComputedStyle(el).filter : "MISSING";' +
        ' } return out; })()'
      );
    },

    classesOf(selector) {
      return context.evaluate(
        '(() => { const el = document.querySelector(' + JSON.stringify(selector) + ');' +
        ' return el ? (el.getAttribute("class") || "") : "MISSING"; })()'
      );
    }
  };

  return context;
}

async function main() {
  const files = fs.readdirSync(CHECKS).filter((name) => name.endsWith('.js') && name.includes(filter)).sort();
  if (!files.length) {
    console.log('no checks match "' + filter + '"');
    process.exit(1);
  }

  const api = settingsModule.load();
  const defaults = api.normalizeSettings(null);
  const reporter = createReporter();

  const needsBrowser = files.some((file) => require(path.join(CHECKS, file)).browser !== false);
  const site = needsBrowser ? await server.start() : null;
  const session = needsBrowser ? await harness.launch({}) : null;

  if (session) {
    console.log('extension ' + session.extensionId + ' loaded, pages on ' + site.origin);
  }

  try {
    for (const file of files) {
      const check = require(path.join(CHECKS, file));
      console.log('\n' + file + ' - ' + check.name);
      const context = session
        ? createContext(session, site.origin, defaults, reporter, check.name)
        : Object.assign({ settingsModule }, reporter.context(check.name));

      if (session) {
        await context.resetSettings();
      }

      try {
        await check.run(context);
      } catch (error) {
        reporter.failures.push(check.name + ' / threw');
        console.log('    FAIL threw: ' + error.message);
      }
    }
  } finally {
    if (session) {
      await session.close();
    }
    if (site) {
      await site.stop();
    }
  }

  console.log('\n' + reporter.passed() + ' passed, ' + reporter.failures.length + ' failed');
  if (reporter.failures.length) {
    reporter.failures.forEach((entry) => console.log('  - ' + entry));
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
