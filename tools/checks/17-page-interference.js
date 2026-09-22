'use strict';

const STATE = `(() => ({
  radius: document.documentElement.style.getPropertyValue('--ibx-blur-radius'),
  delay: document.documentElement.style.getPropertyValue('--ibx-hover-delay'),
  classes: document.documentElement.getAttribute('class') || '',
  photo: getComputedStyle(document.querySelector('#photo')).filter
}))()`;

const DECLARE_RADIUS = `(() => {
  const style = document.createElement('style');
  style.textContent = 'html { --ibx-blur-radius: 0px !important }';
  document.head.appendChild(style);
})()`;

/**
 * Everything this extension decides travels on one element: three classes and
 * two custom properties on <html>. A page is free to write to that same element
 * for its own reasons - assigning className is how most theme switchers are
 * written - and none of it may quietly switch the blur off, or on.
 */
module.exports = {
  name: 'a page writing over the extension',

  async run(t) {
    await t.open('media.html', 2500);
    await t.setSettings({ blurAmount: 24, hoverDelay: 500 });

    let state = await t.evaluate(STATE);
    t.expect('the settings are on the root element',
      [state.radius, state.delay, state.photo], ['24px', '500ms', 'blur(24px)']);

    await t.evaluate("document.documentElement.setAttribute('style', 'background: #fff')");
    await t.sleep(900);

    state = await t.evaluate(STATE);
    t.expect('they are put back after the page rewrites the style attribute',
      [state.radius, state.delay, state.photo], ['24px', '500ms', 'blur(24px)']);

    // A page may declare the same property for its own reasons, and a radius of
    // zero is a blur of nothing at all.
    await t.evaluate(DECLARE_RADIUS);
    await t.sleep(600);
    t.expect('and a page stylesheet cannot turn the radius down to nothing',
      (await t.filters({ photo: '#photo' })).photo, 'blur(24px)');

    // The classes sit on that same element, and a page rewriting the attribute
    // takes all of them with it.
    await t.setSettings({ mode: 'blackout' });
    await t.evaluate("document.documentElement.className = 'theme-dark'");
    await t.sleep(900);

    state = await t.evaluate(STATE);
    t.expect('the classes come back, and the page keeps the one it wanted',
      [state.classes.indexOf('theme-dark') !== -1, state.classes.indexOf('ibx-blackout') !== -1, state.photo],
      [true, true, 'blur(24px) brightness(0)']);

    // The case that matters most: nothing is being blurred here, so the
    // scanning observer is not even running. A page wiping the class attribute
    // would otherwise start blurring a site the user asked to be left alone.
    await t.setSettings({ mode: 'blur', excludedSites: ['127.0.0.1'] });
    t.expect('an excluded site is left alone',
      (await t.filters({ photo: '#photo' })).photo, 'none');

    await t.evaluate("document.documentElement.className = 'theme-dark'");
    await t.sleep(900);

    state = await t.evaluate(STATE);
    t.expect('and no page can start the blur on a site the user excluded',
      [state.classes.indexOf('ibx-off') !== -1, state.photo], [true, 'none']);
  }
};
