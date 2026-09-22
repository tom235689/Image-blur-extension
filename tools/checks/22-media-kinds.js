'use strict';

const TARGETS = {
  photo: '#photo',
  clip: '#clip',
  painting: '#painting',
  tile: '#tile',
  artwork: '#artwork'
};

const BLUR = 'blur(12px)';

/** Everything blurred but the kind named, which keeps the filter the page gave it. */
function only(sharp) {
  const result = {};
  Object.keys(TARGETS).forEach((key) => {
    result[key] = key === sharp ? (key === 'photo' ? 'grayscale(1)' : 'none') : BLUR;
  });
  return result;
}

/**
 * Blurring every kind of media at once is right for a photograph and wrong for
 * everything a page draws itself: a chart, a map or an entire application lives
 * on a canvas, and a blurred video is an unwatchable one. So each kind can be
 * left alone on its own - and left alone has to mean left exactly as the page
 * drew it, on hover as much as at rest.
 */
module.exports = {
  name: 'one kind of media at a time',

  async run(t) {
    await t.open('kinds.html', 2500);

    t.expect('every kind is blurred to begin with',
      await t.filters(TARGETS),
      { photo: BLUR, clip: BLUR, painting: BLUR, tile: BLUR, artwork: BLUR });

    await t.setSettings({ blurTypes: { images: false } });
    t.expect('images off leaves the image, and nothing else, as the page drew it',
      await t.filters(TARGETS), only('photo'));

    // The reveal sets filter: none, which on an image that was never blurred
    // would take away the filter the page asked for.
    await t.hoverElement('#photo');
    t.expect('and hovering it does not take that filter away either',
      (await t.filters(TARGETS)).photo, 'grayscale(1)');
    await t.hover(4, 4);

    await t.setSettings({ blurTypes: { videos: false } });
    t.expect('videos off leaves the video watchable', await t.filters(TARGETS), only('clip'));

    await t.setSettings({ blurTypes: { canvases: false } });
    t.expect('canvases off leaves what the page paints itself',
      await t.filters(TARGETS), only('painting'));

    await t.setSettings({ blurTypes: { backgrounds: false } });
    t.expect('backgrounds off leaves the pictures the stylesheet puts behind things',
      await t.filters(TARGETS), only('tile'));

    await t.setSettings({ blurTypes: { vectors: false } });
    t.expect('vectors off leaves the inline drawing', await t.filters(TARGETS), only('artwork'));

    // Switching every kind off is another way of saying "blur nothing", so the
    // tab has to report itself the way it would if it had been switched off.
    await t.setSettings({
      blurTypes: { images: false, videos: false, canvases: false, backgrounds: false, vectors: false }
    });
    const off = await t.evaluate("document.documentElement.classList.contains('ibx-off')");
    t.expect('with every kind off the tab counts as blurring nothing at all',
      [off, await t.filters(TARGETS)],
      [true, { photo: 'grayscale(1)', clip: 'none', painting: 'none', tile: 'none', artwork: 'none' }]);
  }
};
