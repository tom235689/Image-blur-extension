'use strict';

/**
 * Takes the pictures the Chrome Web Store asks for, with the extension really
 * running, so they cannot drift away from what it does.
 *
 *   node tools/screenshots.js
 *
 * Writes store/screenshots/*.png at 1280x800, the size the dashboard wants.
 * The page they are taken on is tools/pages/showcase.html, and every picture on
 * it is drawn by tools/make-showcase-images.js, so nothing here is borrowed.
 */

const fs = require('fs');
const path = require('path');

const harness = require('./lib/harness');
const server = require('./lib/server');

const OUTPUT = path.join(harness.EXTENSION_ROOT, 'store', 'screenshots');

const WIDTH = 1280;
const HEIGHT = 800;

/**
 * Where the options page is cut in two. Named through the heading's message
 * key rather than by counting cards, so re-ordering the page moves the cut
 * with it instead of slicing a card down the middle.
 */
const CUT = 'section.card:has(h2[data-i18n="optionsHoverHeading"])';

/**
 * Each shot: where to point the browser, what to do once it is there, and what
 * the resulting file is meant to show.
 */
const SHOTS = [
  {
    file: '1-a-page-with-its-pictures-covered.png',
    describe: 'a normal page, blurred, with its text untouched',
    async take(session, site) {
      await open(session, site + '/showcase.html');
    }
  },
  {
    file: '2-hover-brings-one-picture-back.png',
    describe: 'the pointer resting on one picture, which is sharp again',
    async take(session, site) {
      await open(session, site + '/showcase.html');
      const box = await session.page.evaluate(`(() => {
        const r = document.querySelector('.card img').getBoundingClientRect();
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
      })()`);
      await session.page.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved', x: box.x, y: box.y, button: 'none'
      });
      await harness.sleep(900);
    }
  },
  {
    file: '3-the-toolbar-popup.png',
    describe: 'the popup as it opens over a page, with the controls for that site',
    async take(session, site) {
      // The popup asks about the active tab. Rendered as the active tab itself
      // it would find an extension page, report that it cannot run there, and
      // hide the very controls this picture is meant to show - so a real page
      // is opened in front of it first.
      await session.worker.evaluate(
        'chrome.tabs.create({ url: ' + JSON.stringify(site + '/showcase.html') + ', active: true })',
        { awaitPromise: true }
      );
      await harness.sleep(2000);
      // The popup reads that page from the background, and capture() brings it
      // back to the front before photographing it.
      await open(session, 'chrome-extension://' + session.extensionId + '/src/popup/popup.html');
    },
    // The popup is 280 px wide; a full width shot of it would be mostly empty.
    metrics: { width: 320, height: 420 },
    trim: true
  },
  // The options page is twice as tall as the store's canvas, and squeezed into
  // it whole nothing on it can be read. So it is photographed in two halves,
  // cut between two cards rather than through one.
  {
    file: '4-the-options-page.png',
    describe: 'the top of the options page: strength, effect, what gets blurred, size limits',
    async take(session) {
      await open(session, optionsUrl(session));
    },
    metrics: { width: 900, height: 1800 },
    cutAt: CUT,
    half: 'top'
  },
  {
    file: '5-the-rest-of-the-options.png',
    describe: 'the rest of it: the reveal, the site list, the settings file',
    async take(session) {
      await open(session, optionsUrl(session));
    },
    metrics: { width: 900, height: 1800 },
    cutAt: CUT,
    half: 'bottom'
  }
];

function optionsUrl(session) {
  return 'chrome-extension://' + session.extensionId + '/src/options/options.html';
}

async function open(session, url) {
  await session.page.send('Page.navigate', { url });
  await harness.sleep(2200);
}

/**
 * Takes one picture, and reports the size it came out at: what is asked for is
 * a viewport, what arrives can be a slice of a page taller than one.
 */
async function capture(session, shot) {
  var metrics = shot.metrics || { width: WIDTH, height: HEIGHT };
  await session.page.send('Emulation.setDeviceMetricsOverride', {
    width: metrics.width,
    height: metrics.height,
    deviceScaleFactor: 1,
    mobile: false
  });

  await shot.take(session, session.site);

  // A page is as tall as its contents, not as tall as the window it was
  // rendered in, so the remainder is cut off rather than photographed, and a
  // page taller than the canvas is taken in halves. The viewport is then grown
  // to the measured height: a clip reaching past the bottom of the viewport
  // waits for a frame that never comes.
  var clip = null;
  if (shot.trim || shot.half) {
    const size = await session.page.evaluate(`(() => {
      const body = document.body.getBoundingClientRect();
      const cut = ${JSON.stringify(shot.cutAt || null)};
      const at = cut ? document.querySelector(cut) : null;
      return {
        width: Math.ceil(body.width),
        height: Math.ceil(body.height),
        cut: at ? Math.round(at.getBoundingClientRect().top + window.scrollY) : 0
      };
    })()`);

    await session.page.send('Emulation.setDeviceMetricsOverride', {
      width: size.width, height: size.height, deviceScaleFactor: 1, mobile: false
    });
    await harness.sleep(500);

    const top = shot.half === 'bottom' ? size.cut : 0;
    const height = (shot.half === 'bottom' ? size.height : size.cut || size.height) - top;
    clip = { x: 0, y: top, width: size.width, height, scale: 1 };
    metrics = { width: size.width, height };
  }

  // The popup shot leaves an extension page in front of this tab, and a tab in
  // the background is not painting: asking it for a picture waits for a frame
  // nothing is in any hurry to produce.
  await session.page.send('Page.bringToFront');

  const result = await session.page.send('Page.captureScreenshot',
    clip ? { format: 'png', clip } : { format: 'png' });
  return { image: Buffer.from(result.data, 'base64'), metrics: shot.metrics ? metrics : null };
}

/**
 * Puts a smaller rendering on the store's canvas rather than stretching it, so
 * the popup keeps the size it really has. Anything larger than the canvas -
 * the options page is taller than any window - is scaled down to fit whole
 * rather than cropped.
 */
async function pad(session, metrics, image) {
  if (!metrics) {
    return image;
  }
  const margin = 56;
  const scale = Math.min(
    1,
    (WIDTH - margin) / metrics.width,
    (HEIGHT - margin) / metrics.height
  );
  const width = Math.round(metrics.width * scale);
  const dataUrl = 'data:image/png;base64,' + image.toString('base64');

  await session.page.send('Emulation.setDeviceMetricsOverride', {
    width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false
  });
  await session.page.send('Page.navigate', { url: 'about:blank' });
  await session.page.send('Page.bringToFront');
  await harness.sleep(300);
  await session.page.evaluate(`(() => {
    document.documentElement.style.cssText = 'margin:0;height:100%';
    document.body.style.cssText =
      'margin:0;height:100%;display:flex;align-items:center;justify-content:center;background:#eef0f4';
    const shadow = document.createElement('div');
    shadow.style.cssText = 'box-shadow:0 18px 60px rgba(20,24,40,.22);border-radius:12px;overflow:hidden;line-height:0';
    const picture = document.createElement('img');
    picture.src = ${JSON.stringify(dataUrl)};
    picture.width = ${width};
    shadow.appendChild(picture);
    document.body.appendChild(shadow);
  })()`);
  await harness.sleep(500);

  const result = await session.page.send('Page.captureScreenshot', { format: 'png' });
  return Buffer.from(result.data, 'base64');
}

async function main() {
  const site = await server.start();
  const session = await harness.launch({ windowSize: WIDTH + ',' + HEIGHT });
  session.site = site.origin;

  fs.mkdirSync(OUTPUT, { recursive: true });

  try {
    for (const shot of SHOTS) {
      const raw = await capture(session, shot);
      const image = await pad(session, raw.metrics, raw.image);
      fs.writeFileSync(path.join(OUTPUT, shot.file), image);
      console.log('store/screenshots/' + shot.file + ' - ' + shot.describe);
    }

    if (session.errors.length) {
      console.error('\nthe extension logged an error while posing:');
      session.errors.forEach((entry) => console.error('  - ' + entry));
      process.exitCode = 1;
    }
  } finally {
    await session.close();
    await site.stop();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
