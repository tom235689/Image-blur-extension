'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const cdp = require('./cdp');

const EXTENSION_ROOT = path.join(__dirname, '..', '..');

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  path.join(os.homedir(), 'AppData', 'Local', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium'
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function findChrome() {
  for (const candidate of CHROME_CANDIDATES) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error('Chrome not found. Set CHROME_PATH to the browser executable.');
}

/** Chrome writes the port it actually opened into the profile directory. */
async function readDebugPort(profile, timeoutMs) {
  const file = path.join(profile, 'DevToolsActivePort');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const port = Number(fs.readFileSync(file, 'utf8').split('\n')[0]);
      if (port > 0) {
        return port;
      }
    } catch (error) {
      /* not written yet */
    }
    await sleep(100);
  }
  throw new Error('Chrome did not open a debugging port');
}

async function waitForTarget(port, matches, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const list = await cdp.targets(port);
    const found = list.find(matches);
    if (found) {
      return found;
    }
    await sleep(200);
  }
  throw new Error('target never appeared');
}

/**
 * Launches a headless Chrome with a throwaway profile and loads the extension
 * through the DevTools protocol - stable channel Chrome ignores the
 * --load-extension flag, so this is the only way in.
 */
async function launch(options) {
  const chrome = findChrome();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'image-blur-test-'));

  const child = spawn(chrome, [
    '--headless',
    '--disable-gpu',
    '--hide-scrollbars',
    '--window-size=' + (options.windowSize || '1000,900'),
    '--remote-debugging-port=0',
    '--enable-unsafe-extension-debugging',
    '--user-data-dir=' + profile,
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank'
  ], { stdio: 'ignore' });

  const port = await readDebugPort(profile, 20000);

  const browserInfo = await cdp.browserTarget(port);
  const browser = await cdp.connect(browserInfo.webSocketDebuggerUrl);

  const loaded = await browser.send('Extensions.loadUnpacked', { path: EXTENSION_ROOT });
  const extensionId = loaded.id;

  // Installing the extension opens its options page once, so the tab the checks
  // drive has to be picked by more than "the first page target".
  const pageInfo = await waitForTarget(
    port,
    (target) => target.type === 'page' && !target.url.startsWith('chrome-extension://'),
    10000
  );
  const page = await cdp.connect(pageInfo.webSocketDebuggerUrl);
  await page.send('Page.enable');
  await page.send('Runtime.enable');

  const workerInfo = await waitForTarget(
    port,
    (target) => target.type === 'service_worker' && target.url.includes(extensionId),
    10000
  );
  const worker = await cdp.connect(workerInfo.webSocketDebuggerUrl);
  await worker.send('Runtime.enable');
  await worker.send('Log.enable');
  await page.send('Log.enable');

  // Anything the extension throws, or logs at error level, is a failure in its
  // own right: an unhandled rejection would otherwise pass quietly.
  const errors = [];
  const watch = (session, where) => {
    session.on('Runtime.exceptionThrown', (params) => {
      const details = params.exceptionDetails || {};
      const text = (details.exception && details.exception.description) || details.text;
      if (text) {
        errors.push(where + ': ' + text);
      }
    });
    session.on('Log.entryAdded', (params) => {
      const entry = params.entry || {};
      // A request a fixture failed to load is the fixture's business.
      if (entry.level === 'error' && entry.source !== 'network' && entry.text) {
        errors.push(where + ': ' + entry.text);
      }
    });
  };

  watch(page, 'page');
  watch(worker, 'service worker');

  // The service worker seeds the stored defaults when the extension installs;
  // wait for that write so it cannot land on top of a setting a check makes.
  await sleep(1500);

  return {
    extensionId,
    browser,
    page,
    worker,
    port,
    errors,
    async close() {
      page.close();
      worker.close();
      browser.close();
      child.kill();
      await sleep(300);
      try {
        fs.rmSync(profile, { recursive: true, force: true });
      } catch (error) {
        /* Windows sometimes holds the profile open; it is in the temp folder */
      }
    }
  };
}

module.exports = { launch, sleep, EXTENSION_ROOT };
