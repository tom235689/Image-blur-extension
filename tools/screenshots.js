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
      await open(session, 'chrome-extension://' + session.extensionId + '/src/popup/popup.html');

      // It has read the page it was asked about by now, so it can come to the
      // front to be photographed: capturing a background tab means waiting for
      // a frame that is in no hurry to arrive.
      await session.worker.evaluate(`(async () => {
        const tabs = await chrome.tabs.query({ url: 'chrome-extension://*/src/popup/popup.html' });
        if (tabs.length) {
          await chrome.tabs.update(tabs[0].id, { active: true });
        }
      })()`, { awaitPromise: true });
      await harness.sleep(600);
    },
    // The popup is 280 px wide; a full width shot of it would be mostly empty.
    metrics: { width: 320, height: 420 },
    trim: true
  },
  {
    file: '4-the-options-page.png',
    describe: 'every setting, on one page',
    async take(session) {
      await open(session, 'chrome-extension://' + session.extensionId + '/src/options/options.html');
    }
  }
];

async function open(session, url) {
  await session.page.send('Page.navigate', { url });
  await harness.sleep(2200);
}

/**
 * Centres a smaller rendering on the store's canvas rather than stretching it,
 * so the popup keeps the size it really has.
 */
function centre(image, width, height) {
  return {
    width: WIDTH,
    height: HEIGHT,
    left: Math.round((WIDTH - width) / 2),
    top: Math.round((HEIGHT - height) / 2),
    image
  };
}

async function capture(session, shot) {
  const metrics = shot.metrics || { width: WIDTH, height: HEIGHT };
  await session.page.send('Emulation.setDeviceMetricsOverride', {
    width: metrics.width,
    height: metrics.height,
    deviceScaleFactor: 1,
    mobile: false
  });

  await shot.take(session, session.site);

  // A popup is as tall as its contents, not as tall as the window it was
  // rendered in, so the empty remainder is cut off rather than photographed.
  var clip = null;
  if (shot.trim) {
    const size = await session.page.evaluate(`(() => {
      const body = document.body.getBoundingClientRect();
      return { width: Math.ceil(body.width), height: Math.ceil(body.height) };
    })()`);
    clip = { x: 0, y: 0, width: size.width, height: size.height, scale: 1 };
    shot.metrics = { width: size.width, height: size.height };
  }

  const result = await session.page.send('Page.captureScreenshot',
    clip ? { format: 'png', clip } : { format: 'png' });
  return Buffer.from(result.data, 'base64');
}

/**
 * Pads a screenshot out to the store's size with a flat surround, using the
 * page's own background colour so the join is not visible.
 */
async function pad(session, shot, image) {
  if (!shot.metrics) {
    return image;
  }
  const placed = centre(image, shot.metrics.width, shot.metrics.height);
  const dataUrl = 'data:image/png;base64,' + image.toString('base64');

  await session.page.send('Emulation.setDeviceMetricsOverride', {
    width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false
  });
  await session.page.send('Page.navigate', { url: 'about:blank' });
  await harness.sleep(300);
  await session.page.evaluate(`(() => {
    document.documentElement.style.cssText = 'margin:0;height:100%';
    document.body.style.cssText =
      'margin:0;height:100%;display:flex;align-items:center;justify-content:center;background:#eef0f4';
    const shadow = document.createElement('div');
    shadow.style.cssText = 'box-shadow:0 18px 60px rgba(20,24,40,.22);border-radius:12px;overflow:hidden;line-height:0';
    const picture = document.createElement('img');
    picture.src = ${JSON.stringify(dataUrl)};
    picture.width = ${placed.image ? shot.metrics.width : 0};
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
      const image = await pad(session, shot, raw);
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
