'use strict';

const RADIUS = `(() => ({
  radius: document.documentElement.style.getPropertyValue('--ibx-blur-radius'),
  delay: document.documentElement.style.getPropertyValue('--ibx-hover-delay'),
  photo: getComputedStyle(document.querySelector('#photo')).filter
}))()`;

/**
 * The settings that vary per element - the radius and the hover delay - travel
 * as inline custom properties on <html>. A page is free to write that same
 * attribute for its own reasons, and doing so must not quietly drop the blur
 * back to whatever the stylesheet happens to default to.
 */
module.exports = {
  name: 'a page writing over the extension',

  async run(t) {
    await t.open('media.html', 2500);
    await t.setSettings({ blurAmount: 24, hoverDelay: 500 });

    let state = await t.evaluate(RADIUS);
    t.expect('the settings are on the root element',
      [state.radius, state.delay, state.photo], ['24px', '500ms', 'blur(24px)']);

    await t.evaluate("document.documentElement.setAttribute('style', 'background: #fff')");
    await t.sleep(900);

    state = await t.evaluate(RADIUS);
    t.expect('they are put back after the page rewrites the style attribute',
      [state.radius, state.delay, state.photo], ['24px', '500ms', 'blur(24px)']);
  }
};
