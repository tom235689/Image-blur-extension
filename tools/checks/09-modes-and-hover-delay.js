'use strict';

const STATE = `(() => ({
  html: document.documentElement.getAttribute('class') || '',
  delay: document.documentElement.style.getPropertyValue('--ibx-hover-delay'),
  photo: getComputedStyle(document.getElementById('photo')).filter,
  tile: getComputedStyle(document.getElementById('tile')).filter,
  photoDelay: getComputedStyle(document.getElementById('photo')).transitionDelay
}))()`;

/** The effect mode and the delay before hover reveals anything. */
module.exports = {
  name: 'effect mode and hover delay',

  async run(t) {
    await t.open('modes.html', 2500);

    let state = await t.evaluate(STATE);
    t.expect('blur is the default effect', [state.photo, state.tile], ['blur(12px)', 'blur(12px)']);
    t.expect('the delay reaches the page', state.delay, '300ms');

    await t.setSettings({ mode: 'blackout' });
    state = await t.evaluate(STATE);
    t.expect('blackout drops the image to black on top of the blur',
      [state.html.includes('ibx-blackout'), state.photo, state.tile],
      [true, 'blur(12px) brightness(0)', 'blur(12px) brightness(0)']);

    await t.setSettings({ blurAmount: 30 });
    state = await t.evaluate(STATE);
    t.expect('the strength slider still applies in blackout', state.photo, 'blur(30px) brightness(0)');

    await t.setSettings({ mode: 'blur', blurAmount: 12 });
    state = await t.evaluate(STATE);
    t.expect('switching back to blur', [state.html.includes('ibx-blackout'), state.photo], [false, 'blur(12px)']);

    // The reveal waits, the blur returns at once: the delay belongs to the
    // hovered state only.
    await t.setSettings({ hoverDelay: 1000 });
    await t.hoverElement('#photo');
    t.expect('still covered right after the pointer arrives',
      (await t.filters({ photo: '#photo' })).photo, 'blur(12px)');

    await t.sleep(1000);
    t.expect('revealed once the delay has passed',
      (await t.filters({ photo: '#photo' })).photo, 'none');

    await t.hover(600, 600);
    t.expect('covered again immediately when the pointer leaves',
      (await t.filters({ photo: '#photo' })).photo, 'blur(12px)');

    await t.setSettings({ hoverDelay: 0 });
    await t.hoverElement('#photo');
    t.expect('a zero delay reveals at once',
      (await t.filters({ photo: '#photo' })).photo, 'none');
  }
};
